//! The settings window comes out of the island (owner, 2026-10-26; the scene is
//! src/opening-scene.ts, its sequence design/goo.html): a transparent click-through overlay over
//! the menu-bar screen plays it, while the real window waits hidden where it will appear. At the
//! moment the scene's body has become the window, the page asks for the real one
//! (`opening_show`); when the last thread has let go, the overlay goes (`opening_done`).

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::platform::{self, Placement, WIN_W};

const LABEL: &str = "opening";

#[derive(Serialize)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: f64,
}

#[derive(Serialize)]
struct Size {
    w: f64,
    h: f64,
}

/// What the scene needs, in CSS px of the overlay (opening-scene.ts `OpeningGeo`).
#[derive(Serialize)]
struct Geo {
    w: f64,
    h: f64,
    cx: f64,
    island: Size,
    win: Rect,
    /// debug builds: ALMANAC_OPENING_SLOW=8 plays it 8 times slower, to look at it frame by frame
    slow: f64,
}

/// The corner of a titled window on macOS 26 (measured on a screenshot of the settings window).
const WIN_CORNER: f64 = 16.0;

/// Plays the opening for `settings` (built hidden). False when it cannot - no island, the window
/// on another screen - and the caller shows the window at once.
pub fn play(app: &AppHandle, settings: &WebviewWindow, placement: Placement) -> bool {
    if app.get_webview_window(LABEL).is_some() {
        return false;
    }
    let Ok(Some(mon)) = settings.primary_monitor() else {
        return false;
    };
    let ms = mon.scale_factor();
    let (mx, my) = (mon.position().x as f64 / ms, mon.position().y as f64 / ms);
    let (mw, mh) = (mon.size().width as f64 / ms, mon.size().height as f64 / ms);
    let (Ok(pos), Ok(size)) = (settings.outer_position(), settings.outer_size()) else {
        return false;
    };
    let ws = settings.scale_factor().unwrap_or(ms);
    let win = Rect {
        x: pos.x as f64 / ws - mx,
        y: pos.y as f64 / ws - my,
        w: size.width as f64 / ws,
        h: size.height as f64 / ws,
        r: WIN_CORNER,
    };
    // the window has to be on the island's screen, below the island
    if win.x < 0.0 || win.y < 40.0 || win.x + win.w > mw || win.y + win.h > mh {
        return false;
    }
    let g = placement.geometry;
    let scale = if placement.scale > 0.0 {
        placement.scale
    } else {
        1.0
    };
    let geo = Geo {
        w: mw,
        h: mh,
        cx: placement.origin.0 / scale - mx + WIN_W / 2.0,
        // the closed island: the strip under the notch (packages/island islandTargets)
        island: Size {
            w: g.notch_w.min(WIN_W * 0.36),
            h: if g.has_notch { g.notch_h } else { 32.0 },
        },
        win,
        slow: if cfg!(debug_assertions) {
            std::env::var("ALMANAC_OPENING_SLOW")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.0)
        } else {
            1.0
        },
    };
    let geo_slow = geo.slow.max(1.0);
    let Ok(json) = serde_json::to_string(&geo) else {
        return false;
    };
    let url = format!("opening.html#{}", encode(&json));
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(url.into()))
        .title("")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .position(mx, my)
        .inner_size(mw, mh)
        .build();
    let Ok(overlay) = built else {
        return false;
    };
    let _ = overlay.set_ignore_cursor_events(true);
    platform::raise_overlay(&overlay);
    // never leave the user without the window: if the page fails, show it anyway
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis((2500.0 * geo_slow) as u64));
        show_settings(&app2);
        if let Some(o) = app2.get_webview_window(LABEL) {
            let _ = o.close();
        }
    });
    true
}

/// Percent-encoding for the URL's fragment: everything but letters, digits and `-._`.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'.' | b'_' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

/// The scene's body has become the window: the real one takes its place.
#[tauri::command]
pub fn opening_show(app: AppHandle) {
    show_settings(&app);
}

/// The last thread has let go.
#[tauri::command]
pub fn opening_done(app: AppHandle) {
    show_settings(&app);
    if let Some(o) = app.get_webview_window(LABEL) {
        let _ = o.close();
    }
}
