//! Windows: now playing from the system media session (SMTC), volume from the default
//! render endpoint. Messages are the same JSON the Mac helper sends, so `MediaDriver` in
//! the frontend does not know which OS it runs on.
//!
//! One thread polls the current session twice a second (event handlers would need COM
//! callbacks on threads we do not own; a poll is cheap) and takes commands between polls.

use super::{Emit, Media};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Media::MediaPlaybackAutoRepeatMode as Repeat;
use windows::Storage::Streams::DataReader;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const POLL: Duration = Duration::from_millis(500);
/// Browsers often attach the cover a moment after the title (as on Mac).
const ART_RETRIES: [Duration; 3] = [
    Duration::from_millis(1500),
    Duration::from_secs(3),
    Duration::from_secs(6),
];
/// A bigger thumbnail is not worth the IPC; the card draws it at 52 px.
const ART_MAX_BYTES: u64 = 1 << 20;
/// 100 ns ticks between 1601-01-01 (WinRT DateTime) and 1970-01-01.
const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
const TICKS_PER_SEC: f64 = 10_000_000.0;

fn com_init() {
    // SAFETY: per-thread COM init; "already initialised" is fine.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

pub fn start(emit: Emit) -> Arc<Media> {
    let (tx, rx) = channel::<String>();
    let media = Arc::new(Media { tx: Mutex::new(tx) });
    let emit2 = emit.clone();
    thread::spawn(move || {
        com_init();
        session_loop(&emit2, &rx);
    });
    thread::spawn(move || {
        com_init();
        let mut last: Option<f32> = None;
        loop {
            let v = volume();
            if v.map(|x| (x * 1000.0).round()) != last.map(|x| (x * 1000.0).round()) {
                last = v;
                emit("island://volume", json!(v));
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
    media
}

#[derive(Default)]
struct Seen {
    /// Everything except the cover and the clock; a change = a new message.
    body: Option<Value>,
    /// WinRT DateTime of the last timeline report; a change = a seek, play or pause.
    stamp: i64,
    /// title|artist|app; a change = a new track, the cover is read again.
    track: String,
    art_hash: u64,
    art_id: u64,
    art_due: Vec<Instant>,
    none_sent: bool,
}

fn session_loop(emit: &Emit, rx: &Receiver<String>) {
    let manager = match Manager::RequestAsync().and_then(|op| op.get()) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[media] SMTC: {e}");
            emit("island://media", json!({ "off": true }));
            return;
        }
    };
    let mut seen = Seen::default();
    loop {
        let session = manager.GetCurrentSession().ok();
        match &session {
            Some(s) => {
                if let Err(e) = report(emit, s, &mut seen) {
                    eprintln!("[media] read: {e}");
                }
            }
            None => {
                if !seen.none_sent {
                    seen = Seen {
                        none_sent: true,
                        ..Seen::default()
                    };
                    emit("island://media", json!({ "none": true }));
                }
            }
        }
        // Commands until the next poll; after one, read again right away.
        match rx.recv_timeout(POLL) {
            Ok(cmd) => {
                if let Some(s) = &session {
                    if let Err(e) = command(s, &cmd) {
                        eprintln!("[media] {cmd}: {e}");
                    }
                }
                thread::sleep(Duration::from_millis(120));
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn hs(r: windows::core::Result<windows::core::HSTRING>) -> String {
    r.map(|h| h.to_string_lossy()).unwrap_or_default()
}

/// "Spotify.exe" -> "Spotify", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify",
/// "MSEdge" -> "Edge". Only shown when the track has no album.
fn app_name(aumid: &str) -> String {
    let tail = aumid.rsplit('!').next().unwrap_or(aumid);
    let tail = tail.strip_suffix(".exe").unwrap_or(tail);
    let tail = tail.rsplit(['\\', '/']).next().unwrap_or(tail);
    match tail.to_ascii_lowercase().as_str() {
        "chrome" => "Chrome".into(),
        "msedge" => "Edge".into(),
        "firefox" | "308046b0af4a39cb" => "Firefox".into(),
        "spotify" => "Spotify".into(),
        "app" => aumid.split('.').next().unwrap_or("").into(),
        _ => tail.into(),
    }
}

fn report(emit: &Emit, s: &Session, seen: &mut Seen) -> windows::core::Result<()> {
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let title = hs(props.Title());
    if title.is_empty() {
        if !seen.none_sent {
            *seen = Seen {
                none_sent: true,
                ..Seen::default()
            };
            emit("island://media", json!({ "none": true }));
        }
        return Ok(());
    }
    let info = s.GetPlaybackInfo()?;
    let tl = s.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let end = tl.EndTime()?.Duration;
    let pos = tl.Position()?.Duration;
    let stamp = tl.LastUpdatedTime()?.UniversalTime;
    let playing = info.PlaybackStatus()? == Status::Playing;
    let shuffle = info
        .IsShuffleActive()
        .and_then(|r| r.Value())
        .unwrap_or(false);
    let repeat = info
        .AutoRepeatMode()
        .and_then(|r| r.Value())
        .unwrap_or(Repeat::None);
    let rate = info.PlaybackRate().and_then(|r| r.Value()).unwrap_or(1.0);
    let artist = hs(props.Artist());
    let album = hs(props.AlbumTitle());
    let app = app_name(&hs(s.SourceAppUserModelId()));
    let body = json!({
        "title": title,
        "artist": artist,
        "album": album,
        "app": app,
        "duration": ((end - start).max(0)) as f64 / TICKS_PER_SEC,
        "playing": playing,
        // MediaRemote numbering, which the frontend speaks: 1 off, 3 on / 1 off, 2 one, 3 all
        "shuffle": if shuffle { 3 } else { 1 },
        "repeat": match repeat { Repeat::Track => 2, Repeat::List => 3, _ => 1 },
        "rate": rate,
    });

    let track = format!("{title}|{artist}|{app}");
    let now = Instant::now();
    let mut art: Option<String> = None;
    if track != seen.track {
        seen.track = track;
        seen.art_due = ART_RETRIES.iter().map(|d| now + *d).collect();
        art = Some(read_art(&props, seen));
    } else if seen.art_due.first().is_some_and(|t| now >= *t) {
        seen.art_due.remove(0);
        let before = seen.art_hash;
        let a = read_art(&props, seen);
        if seen.art_hash != before {
            art = Some(a);
        }
    }

    if art.is_none() && seen.body.as_ref() == Some(&body) && seen.stamp == stamp {
        return Ok(());
    }
    seen.none_sent = false;
    seen.body = Some(body.clone());
    seen.stamp = stamp;
    let mut msg = body;
    let o = msg.as_object_mut().expect("object");
    o.insert(
        "elapsed".into(),
        json!(((pos - start).max(0)) as f64 / TICKS_PER_SEC),
    );
    o.insert("ts".into(), json!(((stamp - EPOCH_DIFF) / 10_000) as f64));
    o.insert("artId".into(), json!(seen.art_id));
    if let Some(a) = art {
        o.insert("art".into(), json!(a));
    }
    emit("island://media", msg);
    Ok(())
}

/// Base64 of the session's thumbnail, "" when there is none. Updates the cover identity.
fn read_art(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
    seen: &mut Seen,
) -> String {
    let bytes = (|| -> windows::core::Result<Vec<u8>> {
        let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
        let size = stream.Size()?;
        if size == 0 || size > ART_MAX_BYTES {
            return Ok(Vec::new());
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        let n = reader.LoadAsync(size as u32)?.get()?;
        let mut buf = vec![0u8; n as usize];
        reader.ReadBytes(&mut buf)?;
        Ok(buf)
    })()
    .unwrap_or_default();
    if bytes.is_empty() {
        seen.art_hash = 0;
        seen.art_id = 0;
        return String::new();
    }
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    let hash = h.finish().max(1);
    if hash != seen.art_hash {
        seen.art_hash = hash;
        seen.art_id = seen.art_id.wrapping_add(1).max(1);
    }
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

/// `cmd` is already checked by `parse` in media.rs.
fn command(s: &Session, cmd: &str) -> windows::core::Result<()> {
    let (name, arg) = match cmd.split_once(' ') {
        Some((n, a)) => (n, a.parse::<f64>().unwrap_or(0.0)),
        None => (cmd, 0.0),
    };
    let op = match name {
        "toggle" => s.TryTogglePlayPauseAsync()?,
        "next" => s.TrySkipNextAsync()?,
        "prev" => s.TrySkipPreviousAsync()?,
        "seek" => {
            let start = s.GetTimelineProperties()?.StartTime()?.Duration;
            s.TryChangePlaybackPositionAsync(start + (arg * TICKS_PER_SEC) as i64)?
        }
        "shuffle" => s.TryChangeShuffleActiveAsync(arg > 1.0)?,
        "repeat" => s.TryChangeAutoRepeatModeAsync(match arg as i32 {
            2 => Repeat::Track,
            3 => Repeat::List,
            _ => Repeat::None,
        })?,
        _ => return Ok(()),
    };
    op.get()?;
    Ok(())
}

fn endpoint() -> Option<IAudioEndpointVolume> {
    // SAFETY: COM is initialised on this thread; plain activation calls.
    unsafe {
        let en: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok()
    }
}

/// Re-resolved each time: the default device changes with headphones and HDMI.
fn volume() -> Option<f32> {
    // SAFETY: a live endpoint interface.
    unsafe { endpoint()?.GetMasterVolumeLevelScalar().ok() }
}

pub fn set_volume(v: f32) {
    // Called from a Tauri command thread: COM may not be set up there yet.
    com_init();
    let Some(ep) = endpoint() else { return };
    // SAFETY: a live endpoint interface; a null event context is allowed.
    unsafe {
        let _ = ep.SetMasterVolumeLevelScalar(v.clamp(0.0, 1.0), std::ptr::null());
    }
}

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn player_names() {
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(
            app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(app_name("Chrome"), "Chrome");
        assert_eq!(app_name("MSEdge"), "Edge");
        assert_eq!(app_name("308046B0AF4A39CB"), "Firefox");
    }
}
