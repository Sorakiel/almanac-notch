// Now-playing helper. Since macOS 15.4 MediaRemote answers only Apple-signed clients, so the app
// runs this library inside /usr/bin/perl (com.apple.perl), like mediaremote-adapter / Boring Notch.
// Perl installs `almanac_media_stream` as an XSUB and calls it once; it never returns.
//
// stdout: one JSON object per line on every change ({"none":true} when nothing plays).
//         "art" (base64 JPEG, <=160 px) is sent only when the artwork changed.
// stdin:  "toggle" | "next" | "prev" | "seek <sec>" | "shuffle <mode>" | "repeat <mode>".
//         EOF (the app quit or died) ends the process.
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#include <dlfcn.h>
#include <stdio.h>

typedef void (*MRGetInfo)(dispatch_queue_t, void (^)(NSDictionary *));
typedef void (*MRGetPlaying)(dispatch_queue_t, void (^)(BOOL));
typedef void (*MRGetClient)(dispatch_queue_t, void (^)(id));
typedef NSString * (*MRClientBundle)(id);
typedef void (*MRRegister)(dispatch_queue_t);
typedef BOOL (*MRSend)(int, NSDictionary *);
typedef void (*MRSetDouble)(double);
typedef void (*MRSetInt)(int);

static MRGetInfo getInfo;
static MRGetPlaying getPlaying;
static MRGetClient getClient;
static MRClientBundle clientBundle, clientParent;
static MRSend sendCommand;
static MRSetDouble setElapsed;
static MRSetInt setShuffle, setRepeat;

static dispatch_queue_t q;
static NSUInteger lastArt = 0;
static BOOL pending = NO;
/** Browsers attach the cover a moment after the title: re-read a few times while it is missing. */
static NSString *artWaitTitle = nil;
static int artRetries = 0;
static void schedule(void);

// MRMediaRemoteCommand
enum { kTogglePlayPause = 2, kNext = 4, kPrev = 5 };

static id sym(void *h, const char *name) {
  void *p = dlsym(h, name);
  return p ? (__bridge id) * (CFStringRef *)p : nil;
}

static NSString *lastIconBundle = nil;

/** The player's app icon as a 128 px PNG: the island's fallback cover, like Boring Notch. */
static NSString *appIcon(NSString *bundle) {
  NSRunningApplication *ra = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundle].firstObject;
  NSImage *icon = ra.icon;
  if (!icon && ra.bundleURL) icon = [NSWorkspace.sharedWorkspace iconForFile:ra.bundleURL.path];
  if (!icon) return nil;
  NSRect r = NSMakeRect(0, 0, 128, 128);
  CGImageRef img = [icon CGImageForProposedRect:&r context:nil hints:nil];
  if (!img) return nil;
  NSMutableData *out = [NSMutableData data];
  CGImageDestinationRef dst = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out, CFSTR("public.png"), 1, NULL);
  if (!dst) return nil;
  CGImageDestinationAddImage(dst, img, NULL);
  CGImageDestinationFinalize(dst);
  CFRelease(dst);
  return out.length ? [out base64EncodedStringWithOptions:0] : nil;
}

static NSString *jpegThumb(NSData *data) {
  CGImageSourceRef src = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
  if (!src) return nil;
  NSDictionary *opt = @{
    (id)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (id)kCGImageSourceThumbnailMaxPixelSize : @160,
    (id)kCGImageSourceCreateThumbnailWithTransform : @YES,
  };
  CGImageRef img = CGImageSourceCreateThumbnailAtIndex(src, 0, (__bridge CFDictionaryRef)opt);
  CFRelease(src);
  if (!img) return nil;
  NSMutableData *out = [NSMutableData data];
  CGImageDestinationRef dst = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out, CFSTR("public.jpeg"), 1, NULL);
  if (dst) {
    CGImageDestinationAddImage(dst, img, (__bridge CFDictionaryRef) @{(id)kCGImageDestinationLossyCompressionQuality : @0.85});
    CGImageDestinationFinalize(dst);
    CFRelease(dst);
  }
  CGImageRelease(img);
  return out.length ? [out base64EncodedStringWithOptions:0] : nil;
}

static void emit(NSDictionary *d) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:d options:0 error:nil];
  if (!json) return;
  fwrite(json.bytes, 1, json.length, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static NSString *str(id v) { return [v isKindOfClass:[NSString class]] ? v : @""; }
static NSNumber *num(id v) { return [v isKindOfClass:[NSNumber class]] ? v : @0; }

static void publish(void) {
  getInfo(q, ^(NSDictionary *info) {
    getPlaying(q, ^(BOOL playing) {
      getClient(q, ^(id client) {
        NSString *bundle = nil;
        if (client) {
          if (clientParent) bundle = clientParent(client);
          if (!bundle.length && clientBundle) bundle = clientBundle(client);
        }
        NSString *title = str(info[@"kMRMediaRemoteNowPlayingInfoTitle"]);
        if (!info.count || !title.length) {
          lastArt = 0;
          lastIconBundle = nil;
          emit(@{@"none" : @YES});
          return;
        }
        NSString *app = @"";
        if (bundle.length) {
          NSRunningApplication *ra = [NSRunningApplication runningApplicationsWithBundleIdentifier:bundle].firstObject;
          if (ra.localizedName) app = ra.localizedName;
        }
        NSDate *ts = info[@"kMRMediaRemoteNowPlayingInfoTimestamp"];
        NSMutableDictionary *d = [@{
          @"title" : title,
          @"artist" : str(info[@"kMRMediaRemoteNowPlayingInfoArtist"]),
          @"album" : str(info[@"kMRMediaRemoteNowPlayingInfoAlbum"]),
          @"duration" : num(info[@"kMRMediaRemoteNowPlayingInfoDuration"]),
          @"elapsed" : num(info[@"kMRMediaRemoteNowPlayingInfoElapsedTime"]),
          @"ts" : @([ts isKindOfClass:[NSDate class]] ? ts.timeIntervalSince1970 * 1000.0 : NSDate.date.timeIntervalSince1970 * 1000.0),
          @"rate" : num(info[@"kMRMediaRemoteNowPlayingInfoPlaybackRate"]),
          @"playing" : @(playing),
          @"app" : app,
          @"bundle" : bundle ?: @"",
          @"shuffle" : num(info[@"kMRMediaRemoteNowPlayingInfoShuffleMode"]),
          @"repeat" : num(info[@"kMRMediaRemoteNowPlayingInfoRepeatMode"]),
        } mutableCopy];
        NSData *art = info[@"kMRMediaRemoteNowPlayingInfoArtworkData"];
        NSUInteger artId = [art isKindOfClass:[NSData class]] && art.length ? art.hash ^ art.length : 0;
        d[@"artId"] = @(artId);
        if (![title isEqual:artWaitTitle]) {
          artWaitTitle = title;
          artRetries = 0;
        }
        if (!artId && artRetries < 3) {
          int64_t delay = (int64_t)(1.5 * (1 << artRetries) * NSEC_PER_SEC);
          artRetries++;
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, delay), q, ^{ schedule(); });
        }
        if (artId != lastArt) {
          lastArt = artId;
          NSString *b64 = artId ? jpegThumb(art) : nil;
          d[@"art"] = b64 ?: @"";
        }
        // the icon goes once per player; the frontend shows it when a track brings no cover
        if (bundle.length && ![bundle isEqual:lastIconBundle]) {
          lastIconBundle = bundle;
          d[@"icon"] = appIcon(bundle) ?: @"";
        }
        emit(d);
      });
    });
  });
}

/** Notifications come in bursts (info, playing, app); one read 80 ms after the first. */
static void schedule(void) {
  if (pending) return;
  pending = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), q, ^{
    pending = NO;
    publish();
  });
}

static void command(NSString *line) {
  NSArray *p = [line componentsSeparatedByString:@" "];
  NSString *c = p.firstObject;
  double v = p.count > 1 ? [p[1] doubleValue] : 0;
  if ([c isEqual:@"toggle"]) sendCommand(kTogglePlayPause, nil);
  else if ([c isEqual:@"next"]) sendCommand(kNext, nil);
  else if ([c isEqual:@"prev"]) sendCommand(kPrev, nil);
  else if ([c isEqual:@"seek"] && setElapsed) setElapsed(v);
  else if ([c isEqual:@"shuffle"] && setShuffle) setShuffle((int)v);
  else if ([c isEqual:@"repeat"] && setRepeat) setRepeat((int)v);
  else if ([c isEqual:@"get"]) schedule();
}

void almanac_media_stream(void *perl, void *cv) {
  (void)perl;
  (void)cv;
  void *h = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW);
  getInfo = (MRGetInfo)dlsym(h, "MRMediaRemoteGetNowPlayingInfo");
  getPlaying = (MRGetPlaying)dlsym(h, "MRMediaRemoteGetNowPlayingApplicationIsPlaying");
  getClient = (MRGetClient)dlsym(h, "MRMediaRemoteGetNowPlayingClient");
  clientBundle = (MRClientBundle)dlsym(h, "MRNowPlayingClientGetBundleIdentifier");
  clientParent = (MRClientBundle)dlsym(h, "MRNowPlayingClientGetParentAppBundleIdentifier");
  sendCommand = (MRSend)dlsym(h, "MRMediaRemoteSendCommand");
  setElapsed = (MRSetDouble)dlsym(h, "MRMediaRemoteSetElapsedTime");
  setShuffle = (MRSetInt)dlsym(h, "MRMediaRemoteSetShuffleMode");
  setRepeat = (MRSetInt)dlsym(h, "MRMediaRemoteSetRepeatMode");
  MRRegister reg = (MRRegister)dlsym(h, "MRMediaRemoteRegisterForNowPlayingNotifications");
  if (!getInfo || !getPlaying || !getClient || !sendCommand || !reg) {
    emit(@{@"error" : @"MediaRemote API missing"});
    exit(2);
  }
  q = dispatch_queue_create("almanac.media", DISPATCH_QUEUE_SERIAL);
  reg(q);
  NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
  for (NSString *name in @[
         sym(h, "kMRMediaRemoteNowPlayingInfoDidChangeNotification") ?: @"kMRMediaRemoteNowPlayingInfoDidChangeNotification",
         sym(h, "kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification")
             ?: @"kMRMediaRemoteNowPlayingApplicationIsPlayingDidChangeNotification",
         sym(h, "kMRMediaRemoteNowPlayingApplicationDidChangeNotification")
             ?: @"kMRMediaRemoteNowPlayingApplicationDidChangeNotification",
       ])
    [nc addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *n) {
      (void)n;
      dispatch_async(q, ^{ schedule(); });
    }];
  dispatch_async(q, ^{ schedule(); });

  [NSThread detachNewThreadWithBlock:^{
    char buf[256];
    while (fgets(buf, sizeof buf, stdin)) {
      NSString *line = [[NSString stringWithUTF8String:buf]
          stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
      if (line.length) dispatch_async(q, ^{ command(line); });
    }
    exit(0);
  }];
  // MediaRemote posts its notifications through the main run loop.
  CFRunLoopRun();
}
