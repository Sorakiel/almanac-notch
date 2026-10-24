//! Unsupported platforms: keep the crate building, no placement logic.

use super::{Geometry, Placement, WIN_H, WIN_W};
use tauri::WebviewWindow;

pub fn setup_window(_window: &WebviewWindow) {}

pub fn place(window: &WebviewWindow) -> Placement {
    let _ = window.show();
    Placement {
        geometry: Geometry {
            has_notch: false,
            notch_w: 190.0,
            notch_h: 32.0,
            win_w: WIN_W,
            win_h: WIN_H,
        },
        origin: (0.0, 0.0),
        scale: 1.0,
    }
}

pub fn needs_replace(_window: &WebviewWindow, _last: &Placement) -> bool {
    false
}

pub fn cursor() -> Option<(f64, f64)> {
    None
}

pub fn remember_front_app() {}

pub fn yield_activation() {}

pub fn set_ignore(window: &WebviewWindow, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
}

pub fn fullscreen_tick(_window: &WebviewWindow, _hide: bool) -> Option<bool> {
    None
}
