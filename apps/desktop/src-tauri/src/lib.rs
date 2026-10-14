//! Island shell: one transparent window at the notch, click-through outside the island.
//!
//! The window ignores the mouse by default. A background thread polls the global cursor and
//! streams it to the frontend (`island://cursor`) while it is near the window. The frontend
//! feeds it to packages/island as pointer moves (hover works while the window is see-through)
//! and turns mouse events on with `set_interactive` only over `islandRect()` or a hit zone.

mod platform;
mod tray;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use platform::{Geometry, Placement};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Point {
    x: f64,
    y: f64,
}

#[derive(Default)]
struct Shared {
    placement: Placement,
    /// Last cursor sent to the frontend; None once it was told the cursor is far away.
    sent: Option<Point>,
    interactive: bool,
}

type SharedState = Arc<Mutex<Shared>>;

/// Poll period while the cursor is near the window: ~60 Hz.
const NEAR_PERIOD: Duration = Duration::from_millis(16);
/// Poll period while the cursor is far away; keeps idle CPU low.
const FAR_PERIOD: Duration = Duration::from_millis(50);
/// "Near" margin around the window, in CSS px. Moves inside it are streamed to the frontend.
const NEAR_MARGIN: f64 = 120.0;
/// How often the main thread re-checks screens and the window frame (sleep, lock, displays).
const WATCH_PERIOD: Duration = Duration::from_secs(2);

#[tauri::command]
fn island_geometry(state: State<'_, SharedState>) -> Geometry {
    state.lock().unwrap().placement.geometry
}

/// The frontend decides from the island's hit zones whether the window takes the mouse.
#[tauri::command]
fn set_interactive(window: WebviewWindow, state: State<'_, SharedState>, on: bool) {
    let mut s = state.lock().unwrap();
    if s.interactive != on {
        s.interactive = on;
        platform::set_ignore(&window, !on);
    }
}

/// Distance in CSS px from point to rect (0 inside).
fn distance(x: f64, y: f64, w: f64, h: f64, p: Point) -> f64 {
    let dx = (x - p.x).max(p.x - (x + w)).max(0.0);
    let dy = (y - p.y).max(p.y - (y + h)).max(0.0);
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
                let msg = {
                    let mut s = state.lock().unwrap();
                    let pl = s.placement;
                    let g = pl.geometry;
                    // Screen units -> window-relative CSS px.
                    let p = Point {
                        x: (c.0 - pl.origin.0) / pl.scale,
                        y: (c.1 - pl.origin.1) / pl.scale,
                    };
                    let near =
                        pl.scale > 0.0 && distance(0.0, 0.0, g.win_w, g.win_h, p) < NEAR_MARGIN;
                    if near {
                        period = NEAR_PERIOD;
                    }
                    let next = if near { Some(p) } else { None };
                    // Only real moves: the island reads them as pointermove (idle timers, wake).
                    if next != s.sent {
                        s.sent = next;
                        Some(next)
                    } else {
                        None
                    }
                };
                if let Some(m) = msg {
                    let _ = app.emit("island://cursor", m);
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
        .invoke_handler(tauri::generate_handler![island_geometry, set_interactive])
        .setup(move |app| {
            // Not in the Dock and not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("island")
                .expect("island window missing");
            window.set_ignore_cursor_events(true)?;
            platform::setup_window(&window);
            platform::set_ignore(&window, true);
            place_and_publish(app.handle(), &window, &state);
            tray::create(app.handle())?;
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
