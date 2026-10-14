//! macOS: window above the menu bar on every Space, notch geometry from NSScreen,
//! cursor from CoreGraphics. Everything except `cursor()` must run on the main thread.

use std::ffi::c_void;

use objc2::runtime::{AnyClass, AnyObject};
use objc2::{define_class, ClassType, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSPanel, NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize};
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

define_class!(
    // SAFETY: NSPanel has no subclassing requirements; no ivars, no Drop.
    #[unsafe(super(NSPanel, NSWindow))]
    #[thread_kind = MainThreadOnly]
    #[name = "AlmanacIslandPanel"]
    struct IslandPanel;

    impl IslandPanel {
        // Never key or main: a click on the island must not take keyboard focus
        // from the app the user is typing in.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool {
            false
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool {
            false
        }
    }
);

/// Turn Tauri's NSWindow into a non-activating NSPanel in place (same trick as tauri-nspanel).
/// AppKit honours NSWindowStyleMaskNonactivatingPanel only on NSPanel instances.
fn make_nonactivating_panel(ns: &NSWindow) {
    let obj = ns as *const NSWindow as *mut AnyObject;
    // SAFETY: `obj` is a live NSWindow; the panel class adds no ivars, and we only
    // swap when the original instance is at least as large as the new class needs.
    unsafe {
        let from: &AnyClass = (*obj).class();
        if from.name().to_bytes() == b"AlmanacIslandPanel" {
            return;
        }
        let to = IslandPanel::class();
        if from.instance_size() < to.instance_size() {
            eprintln!("[island] cannot swap {:?} -> panel: instance too small", from.name());
            return;
        }
        objc2::ffi::object_setClass(obj, to);
        eprintln!("[island] window class {:?} -> AlmanacIslandPanel", from.name());
    }
    ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
}

pub fn setup_window(window: &WebviewWindow) {
    let ns = ns_window(window);
    // ALMANAC_PLAIN_WINDOW=1 keeps the plain Tauri window, to compare focus behaviour.
    if std::env::var_os("ALMANAC_PLAIN_WINDOW").is_none() {
        make_nonactivating_panel(ns);
    }
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
    let mut geometry = Geometry { has_notch: false, notch_w: 190.0, notch_h: 32.0, win_w: WIN_W, win_h: WIN_H };
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
    primary_screen(mtm).map(|s| s.frame().size.height).unwrap_or(0.0)
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
        (want.origin.x, want.origin.y, want.size.width, want.size.height),
        (got.origin.x, got.origin.y, got.size.width, got.size.height),
        origin,
        ns.level(),
        geometry,
        if moved { " MOVED BY SYSTEM" } else { "" }
    );
    Placement { geometry, origin, scale: 1.0 }
}

/// True when the screen setup changed, the window drifted or it was ordered out (sleep, lock, displays).
pub fn needs_replace(window: &WebviewWindow, last: &Placement) -> bool {
    let mtm = mtm();
    let ns = ns_window(window);
    let Some((want, geometry)) = desired(mtm) else { return false };
    let got = ns.frame();
    let ph = primary_height(mtm);
    let origin = (got.origin.x, ph - (got.origin.y + got.size.height));
    // KVO on the original window may swap the isa back when its observers go away.
    let panel_lost = std::env::var_os("ALMANAC_PLAIN_WINDOW").is_none()
        && !ns.class().name().to_bytes().ends_with(b"AlmanacIslandPanel");
    if panel_lost {
        eprintln!("[island] window class reverted to {:?}", ns.class().name());
    }
    panel_lost
        || !ns.isVisible()
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
