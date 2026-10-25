//! macOS side of the shelf: the native drop (files from Finder, text, links and pictures from a
//! browser), the drag out, the letter, Quick Look and previews.

use std::cell::RefCell;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSApplication, NSBitmapImageFileType, NSBitmapImageRep, NSDragOperation, NSDraggingContext,
    NSDraggingItem, NSDraggingSession, NSDraggingSource, NSEventType, NSImage, NSPasteboard,
    NSPasteboardNameDrag, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF,
    NSPasteboardTypeURL, NSPasteboardWriting, NSSharingService, NSSharingServiceDelegate,
    NSSharingServiceNameComposeEmail, NSWorkspace,
};
use objc2_core_foundation::CGSize;
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSInteger, NSPoint, NSRect, NSSize, NSString, NSURL,
};
use objc2_quick_look_thumbnailing::{
    QLThumbnailGenerationRequest, QLThumbnailGenerationRequestRepresentationTypes,
    QLThumbnailGenerator, QLThumbnailRepresentation,
};
use objc2_quick_look_ui::{QLPreviewItem, QLPreviewPanel, QLPreviewPanelDataSource};
use tauri::{AppHandle, DragDropEvent, Emitter, WebviewWindow, WindowEvent};

use super::{add_image, add_paths, add_text, take, Item, Kind};

/// Our own drag out is under way: the drag pasteboard changes, but nothing is carried *to* us.
static DRAGGING_OUT: AtomicBool = AtomicBool::new(false);

pub fn setup(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    // The page opens the island and shows the carry from the cursor stream (drag_state); the
    // drop itself arrives here, from wry's NSDraggingDestination on the webview.
    window.on_window_event(move |e| {
        if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = e {
            // wry's position is off in our panel (the webview moved out of Tauri's window): the
            // island takes the point from its own cursor stream
            let point = None;
            if DRAGGING_OUT.load(Ordering::Relaxed) {
                return;
            }
            if !paths.is_empty() {
                add_paths(&app, paths.clone(), point);
            } else {
                dropped_content(&app, point);
            }
        }
    });
}

/// 0: no button, 1: the left button is held, 2: and something is being dragged (the drag
/// pasteboard changed since the press) - a file, text, a link, not a window or a selection.
/// Any thread: the cursor poller calls it.
pub fn drag_state() -> u8 {
    static PRESS_COUNT: AtomicIsize = AtomicIsize::new(0);
    static WAS_DOWN: AtomicBool = AtomicBool::new(false);
    // SAFETY: plain CoreGraphics query.
    let down = unsafe { CGEventSourceButtonState(0, 0) };
    let count = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag }).changeCount();
    if down && !WAS_DOWN.load(Ordering::Relaxed) {
        PRESS_COUNT.store(count, Ordering::Relaxed);
    }
    WAS_DOWN.store(down, Ordering::Relaxed);
    if !down {
        0
    } else if count != PRESS_COUNT.load(Ordering::Relaxed) && !DRAGGING_OUT.load(Ordering::Relaxed)
    {
        2
    } else {
        1
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// kCGEventSourceStateCombinedSessionState = 0, kCGMouseButtonLeft = 0
    fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
}

/// A drop without files: a picture, a link or text from the drag pasteboard.
fn dropped_content(app: &AppHandle, point: Option<(f64, f64)>) {
    let pb = NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag });
    let url = pb
        .stringForType(unsafe { NSPasteboardTypeURL })
        .map(|s| s.to_string());
    // a picture from a page: its pixels (the page may be gone later); named after its address
    let img = pb
        .dataForType(unsafe { NSPasteboardTypePNG })
        .map(|d| d.to_vec())
        .or_else(|| {
            pb.dataForType(unsafe { NSPasteboardTypeTIFF })
                .and_then(|d| png_of_data(&d.to_vec()))
        });
    if let Some(png) = img {
        add_image(app, &png, &image_name(url.as_deref()), point);
        return;
    }
    if let Some(u) = url.filter(|u| u.starts_with("http")) {
        add_text(app, &u, true, point);
        return;
    }
    if let Some(t) = pb.stringForType(unsafe { NSPasteboardTypeString }) {
        add_text(app, &t.to_string(), false, point);
    }
}

fn image_name(url: Option<&str>) -> String {
    let stem = url
        .and_then(|u| u.split(['?', '#']).next())
        .and_then(|u| u.rsplit('/').next())
        .map(|n| n.rsplit_once('.').map_or(n, |(s, _)| s).to_string())
        .filter(|n| !n.is_empty() && n.len() < 60)
        .unwrap_or_else(|| crate::lang::t("Картинка", "Picture").to_string());
    format!("{}.png", super::safe(&stem))
}

fn png_of_data(data: &[u8]) -> Option<Vec<u8>> {
    let d = objc2_foundation::NSData::with_bytes(data);
    let rep = NSBitmapImageRep::imageRepWithData(&d)?;
    // SAFETY: an empty properties dictionary.
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    Some(png.to_vec())
}

// ---------- the drag out ----------

pub struct SourceIvars {
    app: AppHandle,
    ids: Vec<String>,
    /// the island's window on screen: a drop back onto it is not a send
    home: NSRect,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the drag source lives on the main thread.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "AlmanacShelfDragSource"]
    #[ivars = SourceIvars]
    struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        /// Copy only, never move: a drop into another Finder folder must not take the file away
        /// from where the person keeps it (docs/PLAN.md: originals are never moved).
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn mask(
            &self,
            _session: &NSDraggingSession,
            _context: NSDraggingContext,
        ) -> NSDragOperation {
            NSDragOperation::Copy
        }

        /// No operation = the drop was refused or cancelled: the things stay on the shelf.
        #[unsafe(method(draggingSession:endedAtPoint:operation:))]
        fn ended(&self, _session: &NSDraggingSession, point: NSPoint, operation: NSDragOperation) {
            DRAGGING_OUT.store(false, Ordering::Relaxed);
            let iv = self.ivars();
            let _ = iv.app.emit("island://shelf-drag-end", ());
            let h = iv.home;
            let back = point.x >= h.origin.x
                && point.x <= h.origin.x + h.size.width
                && point.y >= h.origin.y
                && point.y <= h.origin.y + h.size.height;
            if operation != NSDragOperation::None && !back {
                take(&iv.app, &iv.ids, "sent");
            }
            SOURCE.with(|s| s.borrow_mut().take());
        }
    }
);

thread_local! {
    /// The source of the drag in progress: AppKit does not retain it.
    static SOURCE: RefCell<Option<Retained<DragSource>>> = const { RefCell::new(None) };
    static LOOK: RefCell<Option<Retained<LookSource>>> = const { RefCell::new(None) };
    static MAIL: RefCell<Option<Retained<MailDelegate>>> = const { RefCell::new(None) };
}

/// Main thread. Files go as file URLs (a copy where they land), links as web URLs (a link in a
/// chat, a .webloc in Finder), text as text - each the way its target expects it.
pub fn drag(app: &AppHandle, _window: &WebviewWindow, items: Vec<Item>) {
    let mtm = MainThreadMarker::new().expect("main thread");
    let app_ns = NSApplication::sharedApplication(mtm);
    let Some(event) = app_ns.currentEvent().filter(|e| {
        matches!(
            e.r#type(),
            NSEventType::LeftMouseDown | NSEventType::LeftMouseDragged
        )
    }) else {
        return;
    };
    // The window that got the press is our panel; Tauri's `ns_view()` is the empty view left in
    // its hidden window when the webview moved to the panel, so a session started there drew the
    // image away from the cursor and took a drop into Finder or a chat for a drop back home.
    let Some(win) = event.window(mtm) else { return };
    let Some(view) = win.contentView() else {
        return;
    };
    let at = view.convertPoint_fromView(event.locationInWindow(), None);
    let mut list: Vec<Retained<NSDraggingItem>> = Vec::new();
    for (i, it) in items.iter().enumerate() {
        let writer: Retained<ProtocolObject<dyn NSPasteboardWriting>> = match (it.kind, &it.text) {
            (Kind::Link, Some(u)) => match NSURL::URLWithString(&NSString::from_str(u)) {
                Some(url) => ProtocolObject::from_retained(url),
                None => ProtocolObject::from_retained(file_url(&it.path)),
            },
            (Kind::Text, Some(t)) => ProtocolObject::from_retained(NSString::from_str(t)),
            _ => ProtocolObject::from_retained(file_url(&it.path)),
        };
        let di = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), &writer);
        let icon = drag_image(&it.path, it.kind);
        // a small fanned stack under the cursor, as Finder does for several files
        let s = 56.0;
        let frame = NSRect::new(
            NSPoint::new(
                at.x - s / 2.0 + i as f64 * 4.0,
                at.y - s / 2.0 - i as f64 * 4.0,
            ),
            NSSize::new(s, s),
        );
        // SAFETY: NSImage is a valid contents object for a dragging frame.
        unsafe { di.setDraggingFrame_contents(frame, Some(&icon)) };
        list.push(di);
    }
    let home = win.frame();
    let source = DragSource::alloc(mtm).set_ivars(SourceIvars {
        app: app.clone(),
        ids: items.iter().map(|it| it.id.clone()).collect(),
        home,
    });
    // SAFETY: NSObject's init.
    let source: Retained<DragSource> = unsafe { msg_send![super(source), init] };
    let arr = NSArray::from_retained_slice(&list);
    DRAGGING_OUT.store(true, Ordering::Relaxed);
    let session = view.beginDraggingSessionWithItems_event_source(
        &arr,
        &event,
        ProtocolObject::from_ref(&*source),
    );
    // a refused drop flies back to the island: it visibly did not leave
    session.setAnimatesToStartingPositionsOnCancelOrFail(true);
    SOURCE.with(|s| *s.borrow_mut() = Some(source));
}

fn file_url(p: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()))
}

fn drag_image(p: &Path, kind: Kind) -> Retained<NSImage> {
    let img = if kind == Kind::Image {
        NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&p.to_string_lossy()))
    } else {
        None
    };
    let img = img.unwrap_or_else(|| {
        NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&p.to_string_lossy()))
    });
    img.setSize(NSSize::new(56.0, 56.0));
    img
}

// ---------- Quick Look ----------

pub struct LookIvars {
    urls: Vec<Retained<NSURL>>,
}

define_class!(
    // SAFETY: a plain data source, main thread only.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "AlmanacShelfLook"]
    #[ivars = LookIvars]
    struct LookSource;

    unsafe impl NSObjectProtocol for LookSource {}

    unsafe impl QLPreviewPanelDataSource for LookSource {
        #[unsafe(method(numberOfPreviewItemsInPreviewPanel:))]
        unsafe fn count(&self, _panel: Option<&QLPreviewPanel>) -> NSInteger {
            self.ivars().urls.len() as NSInteger
        }

        #[unsafe(method_id(previewPanel:previewItemAtIndex:))]
        unsafe fn item(
            &self,
            _panel: Option<&QLPreviewPanel>,
            index: NSInteger,
        ) -> Option<Retained<ProtocolObject<dyn QLPreviewItem>>> {
            self.ivars()
                .urls
                .get(index as usize)
                .map(|u| ProtocolObject::from_retained(u.clone()))
        }
    }
);

/// Main thread: the system Quick Look panel over the picked things (space bar in Finder).
pub fn quicklook(_app: &AppHandle, items: Vec<Item>) {
    let mtm = MainThreadMarker::new().expect("main thread");
    let urls: Vec<Retained<NSURL>> = items.iter().map(|it| file_url(&it.path)).collect();
    let src = LookSource::alloc(mtm).set_ivars(LookIvars { urls });
    // SAFETY: NSObject's init.
    let src: Retained<LookSource> = unsafe { msg_send![super(src), init] };
    // SAFETY: the shared panel; the data source is kept alive in LOOK.
    unsafe {
        let panel = QLPreviewPanel::sharedPreviewPanel(mtm);
        if let Some(panel) = panel {
            panel.setDataSource(Some(ProtocolObject::from_ref(&*src)));
            panel.reloadData();
            panel.setCurrentPreviewItemIndex(0);
            // the panel is a window of ours: it comes to the front only with the app
            #[allow(deprecated)]
            NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
            panel.makeKeyAndOrderFront(None);
        }
    }
    LOOK.with(|l| *l.borrow_mut() = Some(src));
}

// ---------- the letter ----------

pub struct MailIvars {
    app: AppHandle,
    ids: Vec<String>,
}

define_class!(
    // SAFETY: a plain delegate, main thread only.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "AlmanacShelfMail"]
    #[ivars = MailIvars]
    struct MailDelegate;

    unsafe impl NSObjectProtocol for MailDelegate {}

    unsafe impl NSSharingServiceDelegate for MailDelegate {
        /// The mail app took the letter: what went with it leaves the shelf, as after a drag out.
        #[unsafe(method(sharingService:didShareItems:))]
        unsafe fn did_share(&self, _service: &NSSharingService, _items: &NSArray) {
            let iv = self.ivars();
            take(&iv.app, &iv.ids, "sent");
            MAIL.with(|m| m.borrow_mut().take());
        }

        #[unsafe(method(sharingService:didFailToShareItems:error:))]
        unsafe fn did_fail(&self, _service: &NSSharingService, _items: &NSArray, _error: &NSError) {
            MAIL.with(|m| m.borrow_mut().take());
        }
    }
);

/// Main thread: the system "New Message" with the files attached and text and links in the body.
/// No servers or keys of ours (docs/PLAN.md).
pub fn mail(app: &AppHandle, items: Vec<Item>) {
    let mtm = MainThreadMarker::new().expect("main thread");
    let Some(service) =
        NSSharingService::sharingServiceNamed(unsafe { NSSharingServiceNameComposeEmail })
    else {
        return;
    };
    let mut objs: Vec<Retained<AnyObject>> = Vec::new();
    for it in &items {
        match (it.kind, &it.text) {
            (Kind::Text | Kind::Link, Some(t)) => objs.push(Retained::into_super(
                Retained::into_super(NSString::from_str(t)),
            )),
            _ => objs.push(Retained::into_super(Retained::into_super(file_url(
                &it.path,
            )))),
        }
    }
    let arr = NSArray::from_retained_slice(&objs);
    // SAFETY: strings and URLs are what the compose service takes.
    if !unsafe { service.canPerformWithItems(Some(&arr)) } {
        return;
    }
    let del = MailDelegate::alloc(mtm).set_ivars(MailIvars {
        app: app.clone(),
        ids: items.iter().map(|it| it.id.clone()).collect(),
    });
    // SAFETY: NSObject's init.
    let del: Retained<MailDelegate> = unsafe { msg_send![super(del), init] };
    service.setDelegate(Some(ProtocolObject::from_ref(&*del)));
    MAIL.with(|m| *m.borrow_mut() = Some(del));
    // SAFETY: as above.
    unsafe { service.performWithItems(&arr) };
}

// ---------- previews ----------

/// A Quick Look thumbnail, PNG at 2x of the tile's picture (54 pt), or None: then the island
/// draws a glyph of the type instead of the generic system icon.
pub fn thumb(path: &Path) -> Option<Vec<u8>> {
    let url = file_url(path);
    // SAFETY: a request for a real file URL; the handler runs on a QL queue and only sends.
    unsafe {
        let req = QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes(
            QLThumbnailGenerationRequest::alloc(),
            &url,
            CGSize {
                width: 108.0,
                height: 108.0,
            },
            1.0,
            QLThumbnailGenerationRequestRepresentationTypes::Thumbnail,
        );
        let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();
        let block = block2::RcBlock::new(
            move |rep: *mut QLThumbnailRepresentation, _err: *mut NSError| {
                let out = rep.as_ref().and_then(|r| {
                    let img = r.NSImage();
                    let tiff = img.TIFFRepresentation()?;
                    png_of_data(&tiff.to_vec())
                });
                let _ = tx.send(out);
            },
        );
        QLThumbnailGenerator::sharedGenerator()
            .generateBestRepresentationForRequest_completionHandler(&req, &block);
        rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
    }
}
