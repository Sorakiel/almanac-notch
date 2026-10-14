//! macOS: window above the menu bar on every Space, notch geometry from NSScreen,
//! cursor from CoreGraphics. Everything except `cursor()` must run on the main thread.

use std::ffi::c_void;

use objc2::MainThreadMarker;
use objc2_app_kit::{NSScreen, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize};
use tauri::WebviewWindow;

use super::{Geometry, Placement, WIN_H, WIN_W};

/// kCGStatusWindowLevel: one above the menu bar (kCGMainMenuWindowLevel = 24).
const STATUS_WINDOW_LEVEL: isize = 25;

fn ns_window(window: &WebviewWindow) -> &NSWindow {
    let ptr = window.ns_window().expect("island window has no NSWindow");
    // SAFETY: Tauri owns the NSWindow for the lifetime of `window`.
    unsafe { &*(ptr as *const NSWindow) }
}

fn mtm() -> MainThreadMarker {
    MainThreadMarker::new().expect("AppKit call off the main thread")
}

/// Keep WindowServer from activating the app when the island is clicked.
/// Checked in stage 1: without this tag a click activates us (an activated event from
/// WindowServer, no activate call in-process) and steals focus from the app the user
/// types in. NSPanel sets the tag for non-activating panels at init; a plain window
/// needs the private setter. Private API, already allowed via macOSPrivateApi.
fn prevent_activation(ns: &NSWindow) {
    let sel = objc2::sel!(_setPreventsActivation:);
    if ns.respondsToSelector(sel) {
        // SAFETY: private AppKit setter taking a BOOL, checked with respondsToSelector.
        let _: () = unsafe { objc2::msg_send![ns, _setPreventsActivation: true] };
    } else {
        eprintln!("[island] _setPreventsActivation missing: clicks will steal focus");
    }
}

pub fn setup_window(window: &WebviewWindow) {
    let ns = ns_window(window);
    // Never key: a click must not take keyboard focus from the app the user types in.
    let _ = window.set_focusable(false);
    prevent_activation(ns);
    ns.setLevel(STATUS_WINDOW_LEVEL);
    ns.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns.setHidesOnDeactivate(false);
    ns.setCanHide(false);
    ns.setHasShadow(false);
}

/// Island lives on the menu-bar screen (ARCHITECTURE: primary display for now).
fn primary_screen(mtm: MainThreadMarker) -> Option<objc2::rc::Retained<NSScreen>> {
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

pub fn place(window: &WebviewWindow) -> Placement {
    let mtm = mtm();
    let ns = ns_window(window);
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
pub fn needs_replace(window: &WebviewWindow, last: &Placement) -> bool {
    let mtm = mtm();
    let ns = ns_window(window);
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
    static PREV_FRONT: std::cell::RefCell<Option<objc2::rc::Retained<objc2_app_kit::NSRunningApplication>>> =
        const { std::cell::RefCell::new(None) };
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
