//! Stage 1 shell: one transparent window at the notch, click-through outside the island.
//!
//! The window ignores the mouse by default. A background thread polls the global cursor
//! and turns mouse events on only while the cursor is over the island's hit rect, so
//! clicks on the empty part of the window reach the app below.

mod platform;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use platform::{Geometry, Placement};

#[derive(Clone, Copy, Debug, Default, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct Shared {
    placement: Placement,
    /// Hit rects in CSS px of the webview, set by the frontend.
    closed: Rect,
    open: Rect,
    hover: bool,
}

type SharedState = Arc<Mutex<Shared>>;

/// Poll period while the cursor is near the island: ~60 Hz.
const NEAR_PERIOD: Duration = Duration::from_millis(16);
/// Poll period while the cursor is far away; keeps idle CPU low.
const FAR_PERIOD: Duration = Duration::from_millis(50);
/// "Near" margin around the open rect, in points.
const NEAR_MARGIN: f64 = 120.0;
/// How often the main thread re-checks screens and the window frame (sleep, lock, displays).
const WATCH_PERIOD: Duration = Duration::from_secs(2);

#[tauri::command]
fn island_geometry(state: State<'_, SharedState>) -> Geometry {
    state.lock().unwrap().placement.geometry
}

#[tauri::command]
fn set_hit_rects(state: State<'_, SharedState>, closed: Rect, open: Rect) {
    let mut s = state.lock().unwrap();
    s.closed = closed;
    s.open = open;
}

/// Distance in CSS px from point to rect (0 inside). `p` is already window-relative CSS px.
fn distance(r: &Rect, p: (f64, f64)) -> f64 {
    let dx = (r.x - p.0).max(p.0 - (r.x + r.w)).max(0.0);
    let dy = (r.y - p.1).max(p.1 - (r.y + r.h)).max(0.0);
    dx.hypot(dy)
}

fn place_and_publish(app: &AppHandle, window: &WebviewWindow, state: &SharedState) {
    let placement = platform::place(window);
    state.lock().unwrap().placement = placement;
    let _ = app.emit("island://geometry", placement.geometry);
}

fn spawn_cursor_poller(app: AppHandle, window: WebviewWindow, state: SharedState) {
    thread::spawn(move || {
        let mut last_watch = Instant::now();
        loop {
            let mut period = FAR_PERIOD;
            if let Some(c) = platform::cursor() {
                let (inside, near, changed) = {
                    let mut s = state.lock().unwrap();
                    let pl = s.placement;
                    // Screen units -> window-relative CSS px.
                    let p = (
                        (c.0 - pl.origin.0) / pl.scale,
                        (c.1 - pl.origin.1) / pl.scale,
                    );
                    // Hysteresis: enter through the closed rect, leave through the open one.
                    let zone = if s.hover { s.open } else { s.closed };
                    let inside = zone.w > 0.0 && distance(&zone, p) == 0.0;
                    let near = distance(&s.open, p) < NEAR_MARGIN;
                    let changed = inside != s.hover;
                    s.hover = inside;
                    (inside, near, changed)
                };
                if changed {
                    let _ = window.set_ignore_cursor_events(!inside);
                    let _ = app.emit("island://hover", inside);
                }
                if near || inside {
                    period = NEAR_PERIOD;
                }
            }
            if last_watch.elapsed() >= WATCH_PERIOD {
                last_watch = Instant::now();
                let (app2, win2, st2) = (app.clone(), window.clone(), state.clone());
                let _ = app.run_on_main_thread(move || {
                    let last = st2.lock().unwrap().placement;
                    if platform::needs_replace(&win2, &last) {
                        eprintln!("[island] screen or window changed, re-placing");
                        platform::setup_window(&win2);
                        place_and_publish(&app2, &win2, &st2);
                    }
                });
            }
            thread::sleep(period);
        }
    });
}

pub fn run() {
    #[cfg(windows)]
    platform::init_process();

    platform::remember_front_app();

    let state: SharedState = Arc::new(Mutex::new(Shared::default()));
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![island_geometry, set_hit_rects])
        .setup(move |app| {
            // Not in the Dock and not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("island")
                .expect("island window missing");
            window.set_ignore_cursor_events(true)?;
            platform::setup_window(&window);
            place_and_publish(app.handle(), &window, &state);
            spawn_cursor_poller(app.handle().clone(), window, state.clone());
            // Launch activation (tao, wry) arrives asynchronously; undo it once it has.
            let handle = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(800));
                let _ = handle.run_on_main_thread(platform::yield_activation);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
