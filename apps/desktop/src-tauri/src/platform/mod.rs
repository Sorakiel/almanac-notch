//! Per-OS window placement and cursor polling.
//!
//! Units: a "screen unit" is whatever the OS cursor API returns. On macOS that is
//! points in CoreGraphics global space (origin top-left of the menu-bar screen, y down);
//! on Windows it is physical pixels. `Placement.scale` converts CSS px of the webview
//! into screen units, so the cursor can be sent to the frontend in CSS px.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub has_notch: bool,
    pub notch_w: f64,
    pub notch_h: f64,
    pub win_w: f64,
    pub win_h: f64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Placement {
    pub geometry: Geometry,
    /// Window top-left in screen units.
    pub origin: (f64, f64),
    /// Screen units per CSS px.
    pub scale: f64,
}

/// Window size in points = the prototype's island canvas (#island 560x200), so the ear and
/// open-width limits that depend on IW match the reference frames exactly.
pub const WIN_W: f64 = 560.0;
pub const WIN_H: f64 = 200.0;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(not(any(target_os = "macos", windows)))]
mod other;
#[cfg(not(any(target_os = "macos", windows)))]
pub use other::*;
