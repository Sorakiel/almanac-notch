//! Windows: tool window at the top edge of the primary monitor, topmost, never activates.
//! Coordinates are physical pixels (the process is Per-Monitor DPI v2 aware).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL,
    MONITOR_DEFAULTTOPRIMARY,
};
use windows::Win32::UI::HiDpi::{
    GetDpiForWindow, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    IsWindowVisible, IsZoomed, SetWindowLongPtrW, SetWindowPos, ShowWindowAsync, GWL_EXSTYLE,
    GWL_STYLE, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_SHOWNOACTIVATE, WS_CAPTION, WS_EX_APPWINDOW,
    WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use super::{Geometry, Placement, WIN_H, WIN_W};

fn hwnd(window: &WebviewWindow) -> HWND {
    let h = window.hwnd().expect("island window has no HWND");
    HWND(h.0 as _)
}

/// Call before the event loop starts. tao normally sets this too; failing because
/// awareness is already set is fine.
pub fn init_process() {
    // SAFETY: plain Win32 call with a constant context.
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

/// Click-through as last asked; re-applied whenever the styles are rebuilt.
static IGNORE: AtomicBool = AtomicBool::new(true);

/// Not in Alt-Tab or the taskbar, never activated, topmost.
const KEEP: isize = (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TOPMOST.0) as isize;
/// Click-through, the same bits tao sets for `set_ignore_cursor_events`.
const PASS: isize = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;

fn wanted_ex(ex: isize) -> isize {
    let ex = (ex | KEEP) & !(WS_EX_APPWINDOW.0 as isize);
    if IGNORE.load(Ordering::Relaxed) {
        ex | PASS
    } else {
        ex & !PASS
    }
}

pub fn setup_window(window: &WebviewWindow) {
    let h = hwnd(window);
    // SAFETY: `h` is a live window owned by Tauri.
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, wanted_ex(ex));
        let _ = SetWindowPos(
            h,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

fn desired(h: HWND) -> (RECT, Geometry, f64) {
    // SAFETY: plain Win32 queries.
    unsafe {
        let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let _ = GetMonitorInfoW(mon, &mut info);
        let m = info.rcMonitor;
        let dpi = GetDpiForWindow(h).max(96);
        let scale = dpi as f64 / 96.0;
        let w = (WIN_W * scale).round() as i32;
        let hh = (WIN_H * scale).round() as i32;
        let x = m.left + ((m.right - m.left) - w) / 2;
        let rect = RECT {
            left: x,
            top: m.top,
            right: x + w,
            bottom: m.top + hh,
        };
        // No camera on Windows: the frontend draws the flat strip.
        let geometry = Geometry {
            has_notch: false,
            notch_w: 190.0,
            notch_h: 32.0,
            win_w: WIN_W,
            win_h: WIN_H,
        };
        (rect, geometry, scale)
    }
}

pub fn place(window: &WebviewWindow) -> Placement {
    let h = hwnd(window);
    let (r, geometry, scale) = desired(h);
    // SAFETY: `h` is a live window owned by Tauri.
    unsafe {
        let _ = SetWindowPos(
            h,
            Some(HWND_TOPMOST),
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        let mut got = RECT::default();
        let _ = GetWindowRect(h, &mut got);
        eprintln!(
            "[island] placed: want {:?} got {:?} scale {scale}",
            (r.left, r.top, r.right, r.bottom),
            (got.left, got.top, got.right, got.bottom)
        );
        Placement {
            geometry,
            origin: (got.left as f64, got.top as f64),
            scale,
        }
    }
}

pub fn needs_replace(window: &WebviewWindow, last: &Placement) -> bool {
    // hidden for a full-screen app on purpose: re-placing would show it again
    if FS_HIDDEN.load(Ordering::Relaxed) {
        return false;
    }
    let h = hwnd(window);
    let (r, geometry, scale) = desired(h);
    let mut got = RECT::default();
    // SAFETY: plain Win32 queries on a live window.
    let (visible, ex) = unsafe {
        let _ = GetWindowRect(h, &mut got);
        (
            IsWindowVisible(h).as_bool(),
            GetWindowLongPtrW(h, GWL_EXSTYLE),
        )
    };
    // tao rebuilds GWL_EXSTYLE from its own flags on some changes and drops ours.
    !visible
        || ex != wanted_ex(ex)
        || geometry != last.geometry
        || (scale - last.scale).abs() > f64::EPSILON
        || got.left != r.left
        || got.top != r.top
}

pub fn cursor() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    // SAFETY: writes into a local POINT.
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

pub fn remember_front_app() {}

pub fn yield_activation() {}

/// Not `window.set_ignore_cursor_events`: tao rewrites the whole GWL_EXSTYLE from its flags
/// there, which drops WS_EX_TOOLWINDOW (Alt-Tab) and WS_EX_NOACTIVATE (focus on click).
pub fn set_ignore(window: &WebviewWindow, ignore: bool) {
    IGNORE.store(ignore, Ordering::Relaxed);
    let h = hwnd(window);
    // SAFETY: `h` is a live window owned by Tauri.
    unsafe {
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let want = wanted_ex(ex);
        if want != ex {
            SetWindowLongPtrW(h, GWL_EXSTYLE, want);
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }
}

/// The island is hidden because a full-screen app is in front.
static FS_HIDDEN: AtomicBool = AtomicBool::new(false);

/// A window in front that covers the whole island monitor: a game (exclusive or borderless), a
/// video or a browser in full screen, a slideshow. A maximized window with a title bar is not one,
/// even when an auto-hidden taskbar lets it reach the bottom edge.
fn fullscreen_in_front(own: HWND) -> bool {
    // SAFETY: plain Win32 queries on whatever window is in front; nothing is kept.
    unsafe {
        if let Ok(q) = SHQueryUserNotificationState() {
            if q == QUNS_RUNNING_D3D_FULL_SCREEN || q == QUNS_PRESENTATION_MODE {
                return true;
            }
        }
        let fg = GetForegroundWindow();
        if fg.is_invalid() || fg == own {
            return false;
        }
        // the desktop itself covers the monitor too
        let mut cls = [0u16; 16];
        let n = GetClassNameW(fg, &mut cls).max(0) as usize;
        let cls = String::from_utf16_lossy(&cls[..n]);
        if cls == "Progman" || cls == "WorkerW" {
            return false;
        }
        let style = GetWindowLongPtrW(fg, GWL_STYLE) as u32;
        if style & WS_CAPTION.0 == WS_CAPTION.0 || IsZoomed(fg).as_bool() {
            return false;
        }
        let mon = MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        if MonitorFromWindow(fg, MONITOR_DEFAULTTONULL) != mon {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut r = RECT::default();
        if !GetMonitorInfoW(mon, &mut info).as_bool() || GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let m = info.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

/// Any thread, a few times a second. Hides the island while a full-screen app is in front (when
/// `hide` is on) and shows it again after; returns the new state when it changed.
pub fn fullscreen_tick(window: &WebviewWindow, hide: bool) -> Option<bool> {
    let h = hwnd(window);
    let want = hide && fullscreen_in_front(h);
    if FS_HIDDEN.swap(want, Ordering::Relaxed) == want {
        return None;
    }
    // SAFETY: `h` is a live window owned by Tauri; the async call only posts to its thread.
    unsafe {
        let _ = ShowWindowAsync(h, if want { SW_HIDE } else { SW_SHOWNOACTIVATE });
    }
    Some(want)
}
