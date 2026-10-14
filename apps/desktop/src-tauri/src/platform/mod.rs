//! Per-OS window placement and cursor polling.
//!
//! Units: a "screen unit" is whatever the OS cursor API returns. On macOS that is
//! points in CoreGraphics global space (origin top-left of the menu-bar screen, y down);
//! on Windows it is physical pixels. `Placement.scale` converts CSS px of the webview
//! into screen units, so hit rects from the frontend can be compared with the cursor.

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

/// Window size in points: the open island (480x150) plus margins (ARCHITECTURE: ~520x190).
pub const WIN_W: f64 = 520.0;
pub const WIN_H: f64 = 190.0;

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
