//! macOS: window above the menu bar on every Space, notch geometry from NSScreen,
//! cursor from CoreGraphics. Everything except `cursor()` must run on the main thread.

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicU8, Ordering};

use objc2::rc::Retained;
use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSPanel, NSScreen, NSView, NSWindow, NSWindowCollectionBehavior,
    NSWindowOrderingMode, NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

use super::{Geometry, Placement, WIN_H, WIN_W};

/// kCGStatusWindowLevel: one above the menu bar (kCGMainMenuWindowLevel = 24).
const STATUS_WINDOW_LEVEL: isize = 25;

fn mtm() -> MainThreadMarker {
    MainThreadMarker::new().expect("AppKit call off the main thread")
}

thread_local! {
    /// The visible island window. Main thread only.
    static PANEL: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
}

fn panel() -> Retained<NSPanel> {
    PANEL
        .with(|p| p.borrow().clone())
        .expect("island panel not created")
}

/// Host the Tauri webview in our own non-activating NSPanel.
///
/// A click on a plain Tauri window activates the app (WindowServer sends an activated
/// event; nothing in-process calls activate) and steals focus from the app the user types
/// in. Setting NSWindowStyleMaskNonactivatingPanel later, or swapping the window class to
/// NSPanel, does not help: AppKit tells WindowServer "don't activate" only when an NSPanel
/// is created with that style. So the panel is created here with public API, Tauri's
/// content view (with the WKWebView) is moved into it, and Tauri's window stays hidden,
/// still owning the webview and IPC.
fn create_panel(window: &WebviewWindow) -> Retained<NSPanel> {
    let mtm = mtm();
    let ptr = window.ns_window().expect("island window has no NSWindow");
    // SAFETY: Tauri owns the NSWindow for the lifetime of the app.
    let tauri_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(WIN_W, WIN_H));
    let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
    // SAFETY: designated initializer of NSWindow, inherited by NSPanel.
    let panel: Retained<NSPanel> = unsafe {
        msg_send![
            NSPanel::alloc(mtm),
            initWithContentRect: rect,
            styleMask: style,
            backing: NSBackingStoreType::Buffered,
            defer: false
        ]
    };
    // SAFETY: we keep the panel retained in PANEL; AppKit must not free it on close.
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setHidesOnDeactivate(false);
    panel.setCanHide(false);
    panel.setIgnoresMouseEvents(true);
    if let Some(content) = tauri_window.contentView() {
        // Leave Tauri's window a valid empty view; the webview moves to the panel.
        tauri_window.setContentView(Some(&NSView::new(mtm)));
        panel.setContentView(Some(&content));
    }
    tauri_window.orderOut(None);
    panel
}

pub fn setup_window(window: &WebviewWindow) {
    let panel = PANEL.with(|p| p.borrow().clone()).unwrap_or_else(|| {
        let created = create_panel(window);
        PANEL.with(|p| *p.borrow_mut() = Some(created.clone()));
        created
    });
    panel.setLevel(STATUS_WINDOW_LEVEL);
    apply_behavior(&panel, FS_HIDE.load(Ordering::Relaxed) != 0);
}

/// Last full-screen setting applied to the panel: 0 show over full-screen Spaces, 1 hide there.
/// Starts as "hide", the default (prefs.rs), until the first `fullscreen_tick`.
static FS_HIDE: AtomicU8 = AtomicU8::new(1);

/// Every Space, but a full-screen one only when the user wants the island there: without
/// `FullScreenAuxiliary` AppKit itself keeps the panel off full-screen Spaces (a game, a video,
/// a slideshow) and brings it back on leaving them - nothing to poll.
fn apply_behavior(panel: &NSPanel, hide: bool) {
    let mut b = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
    if !hide {
        b |= NSWindowCollectionBehavior::FullScreenAuxiliary;
    }
    panel.setCollectionBehavior(b);
}

/// Any thread. Applies a changed setting; AppKit does the hiding, so it never reports a change.
pub fn fullscreen_tick(window: &WebviewWindow, hide: bool) -> Option<bool> {
    if FS_HIDE.swap(hide as u8, Ordering::Relaxed) != hide as u8 {
        let _ = window.run_on_main_thread(move || {
            if let Some(p) = PANEL.with(|p| p.borrow().clone()) {
                apply_behavior(&p, hide);
            }
        });
    }
    None
}

/// The settings window's opening overlay (opening.rs): over the menu bar like the island - the
/// island's own shape grows there - but just under the island's panel, and never in the way of a
/// click. Any thread.
pub fn raise_overlay(window: &WebviewWindow) {
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ptr) = w.ns_window() else {
            return;
        };
        // SAFETY: Tauri owns the NSWindow while the overlay lives; this runs on the main thread.
        let ns: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        ns.setLevel(STATUS_WINDOW_LEVEL);
        ns.setHasShadow(false);
        ns.setIgnoresMouseEvents(true);
        ns.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        if let Some(p) = PANEL.with(|p| p.borrow().clone()) {
            ns.orderWindow_relativeTo(NSWindowOrderingMode::Below, p.windowNumber());
        }
    });
}

/// Click-through toggle for the panel; callable from any thread.
pub fn set_ignore(window: &WebviewWindow, ignore: bool) {
    let _ = window.run_on_main_thread(move || {
        if let Some(p) = PANEL.with(|p| p.borrow().clone()) {
            p.setIgnoresMouseEvents(ignore);
        }
    });
}

/// Island lives on the menu-bar screen (ARCHITECTURE: primary display for now).
fn primary_screen(mtm: MainThreadMarker) -> Option<Retained<NSScreen>> {
    NSScreen::screens(mtm).firstObject()
}

/// Desired window frame (AppKit coords, bottom-left origin) and notch geometry.
fn desired(mtm: MainThreadMarker) -> Option<(NSRect, Geometry)> {
    let screen = primary_screen(mtm)?;
    let frame = screen.frame();
    let insets = screen.safeAreaInsets();
    let mut geometry = Geometry {
        has_notch: false,
        notch_w: 190.0,
        notch_h: 32.0,
        win_w: WIN_W,
        win_h: WIN_H,
    };
    let mut center_x = frame.origin.x + frame.size.width / 2.0;
    if insets.top > 0.0 {
        // The notch is what lies between the two menu-bar areas left and right of the camera.
        let left = screen.auxiliaryTopLeftArea();
        let right = screen.auxiliaryTopRightArea();
        let notch_l = left.origin.x + left.size.width;
        let notch_r = right.origin.x;
        if notch_r > notch_l {
            geometry.has_notch = true;
            geometry.notch_w = notch_r - notch_l;
            geometry.notch_h = insets.top;
            center_x = (notch_l + notch_r) / 2.0;
        }
    }
    let origin = NSPoint::new(
        (center_x - WIN_W / 2.0).round(),
        frame.origin.y + frame.size.height - WIN_H,
    );
    Some((NSRect::new(origin, NSSize::new(WIN_W, WIN_H)), geometry))
}

/// Height of the menu-bar screen, for flipping AppKit y into CoreGraphics y.
fn primary_height(mtm: MainThreadMarker) -> f64 {
    primary_screen(mtm)
        .map(|s| s.frame().size.height)
        .unwrap_or(0.0)
}

pub fn place(_window: &WebviewWindow) -> Placement {
    let mtm = mtm();
    let ns = panel();
    let Some((want, geometry)) = desired(mtm) else {
        eprintln!("[island] no screens");
        return Placement::default();
    };
    ns.setFrame_display(want, true);
    // Show without activating the app or taking key focus.
    ns.orderFrontRegardless();
    // macOS may still constrain the frame (e.g. below the menu bar): report what we actually got.
    let got = ns.frame();
    let ph = primary_height(mtm);
    let origin = (got.origin.x, ph - (got.origin.y + got.size.height));
    let moved = (got.origin.x - want.origin.x).abs() > 0.5
        || (got.origin.y - want.origin.y).abs() > 0.5
        || (got.size.width - want.size.width).abs() > 0.5
        || (got.size.height - want.size.height).abs() > 0.5;
    eprintln!(
        "[island] placed: want {:?} got {:?} (cg top-left {:?}) level {} notch {:?}{}",
        (
            want.origin.x,
            want.origin.y,
            want.size.width,
            want.size.height
        ),
        (got.origin.x, got.origin.y, got.size.width, got.size.height),
        origin,
        ns.level(),
        geometry,
        if moved { " MOVED BY SYSTEM" } else { "" }
    );
    Placement {
        geometry,
        origin,
        scale: 1.0,
    }
}

/// True when the screen setup changed, the window drifted or it was ordered out (sleep, lock, displays).
pub fn needs_replace(_window: &WebviewWindow, last: &Placement) -> bool {
    let mtm = mtm();
    let ns = panel();
    let Some((want, geometry)) = desired(mtm) else {
        return false;
    };
    let got = ns.frame();
    let ph = primary_height(mtm);
    let origin = (got.origin.x, ph - (got.origin.y + got.size.height));
    !ns.isVisible()
        || ns.level() != STATUS_WINDOW_LEVEL
        || geometry != last.geometry
        || (got.origin.x - want.origin.x).abs() > 0.5
        || (got.origin.y - want.origin.y).abs() > 0.5
        || (origin.0 - last.origin.0).abs() > 0.5
        || (origin.1 - last.origin.1).abs() > 0.5
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// Global cursor in CoreGraphics points (top-left origin), safe off the main thread.
/// NSEvent.mouseLocation would be bottom-left and main-thread bound.
pub fn cursor() -> Option<(f64, f64)> {
    // SAFETY: CGEventCreate(NULL) returns an owned event or NULL; released below.
    unsafe {
        let ev = CGEventCreate(std::ptr::null());
        if ev.is_null() {
            return None;
        }
        let p = CGEventGetLocation(ev);
        CFRelease(ev);
        Some((p.x, p.y))
    }
}

thread_local! {
    static PREV_FRONT: RefCell<Option<Retained<objc2_app_kit::NSRunningApplication>>> =
        const { RefCell::new(None) };
}

/// Remember the frontmost app before tao/wry activate us at launch. Main thread.
pub fn remember_front_app() {
    let front = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication();
    PREV_FRONT.with(|p| *p.borrow_mut() = front);
}

/// tao and wry activate the app at launch. Hand focus back to the app that had it;
/// allowed because we are the active app at this point.
pub fn yield_activation() {
    let app = objc2_app_kit::NSApplication::sharedApplication(mtm());
    if !app.isActive() {
        return;
    }
    let prev = PREV_FRONT.with(|p| p.borrow_mut().take());
    match prev {
        Some(prev) if !prev.isTerminated() => {
            prev.activateWithOptions(objc2_app_kit::NSApplicationActivationOptions::empty());
        }
        _ => app.deactivate(),
    }
}

/// The page drew its first frame. Nothing to do here: the window is shown when placed, and a
/// transparent WKWebView has no white fill to hide (Windows waits for this, platform/windows.rs).
pub fn ready(_window: &WebviewWindow) {}
