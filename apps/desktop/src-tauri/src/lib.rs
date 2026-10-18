//! Island shell: one transparent window at the notch, click-through outside the island.
//!
//! The window ignores the mouse by default. A background thread polls the global cursor and
//! streams it to the frontend (`island://cursor`) while it is near the window. The frontend
//! feeds it to packages/island as pointer moves (hover works while the window is see-through)
//! and turns mouse events on with `set_interactive` only over `islandRect()` or a hit zone.

mod calendar;
mod claude;
mod github;
mod grafana;
mod notion;
mod vercel;
// on Mac only its tests use it: the choice of sources is Windows-only
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod ical;
mod lang;
mod media;
mod modules;
#[cfg(windows)]
mod outlook;
mod platform;
mod settings;
mod tray;

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewWindow};

use claude::usage::Usage;
use claude::Hub;

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

/// Answer from the island to a held hook ("approve", "deny", "opt:N", "none").
#[tauri::command]
fn agent_answer(hub: State<'_, Arc<Hub>>, id: u64, answer: String) {
    hub.answer(id, &answer);
}

/// Plan usage as last scanned; the frontend asks once at start, then listens.
#[tauri::command]
fn claude_usage(usage: State<'_, Arc<Mutex<Usage>>>) -> Usage {
    usage.lock().unwrap().clone()
}

/// Last calendar read and now-playing state; the frontend asks once at start, then listens.
#[derive(Default)]
struct Feeds {
    calendar: Option<calendar::Calendar>,
    media: Option<serde_json::Value>,
    volume: Option<f32>,
    github: Option<github::State>,
    vercel: Option<vercel::State>,
    notion: Option<notion::State>,
    grafana: Option<grafana::State>,
}

#[derive(Serialize)]
struct FeedsSnapshot {
    calendar: Option<calendar::Calendar>,
    media: Option<serde_json::Value>,
    volume: Option<f32>,
    github: Option<github::State>,
    vercel: Option<vercel::State>,
    notion: Option<notion::State>,
    grafana: Option<grafana::State>,
}

#[tauri::command]
fn feeds_state(feeds: State<'_, Arc<Mutex<Feeds>>>) -> FeedsSnapshot {
    let f = feeds.lock().unwrap();
    FeedsSnapshot {
        calendar: f.calendar.clone(),
        media: f.media.clone(),
        volume: f.volume,
        github: f.github.clone(),
        vercel: f.vercel.clone(),
        notion: f.notion.clone(),
        grafana: f.grafana.clone(),
    }
}

/// Connect a GitHub token: checked against GitHub, then kept in the keychain. Returns the login.
#[tauri::command]
async fn github_connect(token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || github::connect(&token))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn github_disconnect() {
    let _ = tauri::async_runtime::spawn_blocking(github::disconnect).await;
}

/// Connect a Vercel token: checked against Vercel, then kept in the keychain. Returns the username.
#[tauri::command]
async fn vercel_connect(token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || vercel::connect(&token))
        .await
        .map_err(|e| e.to_string())?
}

/// The card's arrow: open a deployment's page; the URL is looked up here, not sent by the page.
#[tauri::command]
fn vercel_open(feeds: State<'_, Arc<Mutex<Feeds>>>, id: String) {
    let url = feeds.lock().unwrap().vercel.as_ref().and_then(|v| {
        v.deploys
            .iter()
            .find(|d| d.id == id)
            .and_then(|d| d.url.clone())
    });
    if let Some(u) = url {
        vercel::open(&u);
    }
}

#[tauri::command]
async fn vercel_disconnect() {
    let _ = tauri::async_runtime::spawn_blocking(vercel::disconnect).await;
}

/// Connect a Notion integration token: checked against Notion, then kept in the keychain.
/// Returns the workspace name.
#[tauri::command]
async fn notion_connect(token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || notion::connect(&token))
        .await
        .map_err(|e| e.to_string())?
}

/// A card row: open the page; the URL is looked up here, not sent by the page.
#[tauri::command]
fn notion_open(feeds: State<'_, Arc<Mutex<Feeds>>>, id: String) {
    let url = feeds.lock().unwrap().notion.as_ref().and_then(|n| {
        n.pages
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.url.clone())
    });
    if let Some(u) = url {
        notion::open(&u);
    }
}

/// Settings: who I am in the workspace (edits by anyone else are island events).
#[tauri::command]
fn notion_me(id: Option<String>) -> Result<(), String> {
    notion::set_me(id)
}

#[tauri::command]
async fn notion_disconnect() {
    let _ = tauri::async_runtime::spawn_blocking(notion::disconnect).await;
}

/// Connect Grafana: the address and service account token are checked, then kept in the
/// keychain. Returns the organisation's name.
#[tauri::command]
async fn grafana_connect(url: String, token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || grafana::connect(&url, &token))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn grafana_disconnect() {
    let _ = tauri::async_runtime::spawn_blocking(grafana::disconnect).await;
}

/// The settings page: the saved address (the token is never sent back) and the pick.
#[derive(Serialize)]
struct GrafanaConfig {
    url: Option<String>,
    board: Option<String>,
    panel: Option<u64>,
}

#[tauri::command]
async fn grafana_config() -> GrafanaConfig {
    tauri::async_runtime::spawn_blocking(|| {
        let p = grafana::pick();
        GrafanaConfig {
            url: grafana::address(),
            board: p.board,
            panel: p.panel,
        }
    })
    .await
    .unwrap_or(GrafanaConfig {
        url: None,
        board: None,
        panel: None,
    })
}

#[tauri::command]
async fn grafana_dashboards() -> Result<Vec<grafana::BoardInfo>, String> {
    tauri::async_runtime::spawn_blocking(grafana::dashboards)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn grafana_panels(uid: String) -> Result<Vec<grafana::PanelInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || grafana::dashboard_panels(&uid))
        .await
        .map_err(|e| e.to_string())?
}

/// Settings: the dashboard and panel the card shows (None = none).
#[tauri::command]
fn grafana_pick(board: Option<String>, panel: Option<u64>) -> Result<(), String> {
    grafana::set_pick(grafana::Pick { board, panel })
}

/// The card: "alerts" opens the alert list, "board" the picked dashboard; the URL is built
/// here from the saved address, not sent by the page.
#[tauri::command]
fn grafana_open(what: String) {
    grafana::open(&what);
}

/// Calendar source as the settings window shows it.
#[tauri::command]
async fn calendar_config() -> calendar::Config {
    tauri::async_runtime::spawn_blocking(calendar::config)
        .await
        .expect("calendar config")
}

/// Pick the calendar source ("outlook" | "ical" | "off"); `url` is a new iCal link.
/// Ok(n) = events in the next 48 hours, None = nothing to count.
#[tauri::command]
async fn calendar_choose(source: String, url: Option<String>) -> Result<Option<usize>, String> {
    tauri::async_runtime::spawn_blocking(move || calendar::choose(&source, url))
        .await
        .map_err(|e| e.to_string())?
}

/// Mac: ask for calendar access again or open System Settings (tray, settings window).
#[tauri::command]
fn calendar_access() {
    calendar::open_access();
}

/// A tray item run from the settings window or the island ("nstate:open", "ev:dance",
/// "hooks:install", "quit", ...).
#[tauri::command]
fn island_action(app: AppHandle, id: String) {
    tray::action(&app, &id);
}

/// What the settings window shows about the island and Claude Code.
#[derive(Serialize)]
struct IslandStatus {
    state: &'static str,
    hooks: bool,
}

#[tauri::command]
fn island_status() -> IslandStatus {
    IslandStatus {
        state: tray::state(),
        hooks: almanac_hook::install::is_installed(&almanac_hook::paths::claude_settings()),
    }
}

/// Switched-off modules and the chat tab.
#[tauri::command]
fn modules_get() -> modules::Config {
    modules::get()
}

/// Save from the settings window; refuses to switch every module off. The island and the
/// settings window hear `island://modules`; providers check `modules::is_on` on their next round.
#[tauri::command]
fn modules_set(app: AppHandle, off: Vec<String>, chat: bool) -> Result<modules::Config, String> {
    let c = modules::set(off, chat)?;
    let _ = app.emit("island://modules", &c);
    github::poke();
    vercel::poke();
    notion::poke();
    grafana::poke();
    calendar::poke();
    Ok(c)
}

/// Interface language: what was picked ("auto", "ru", "en") and what is in effect.
#[tauri::command]
fn lang_get() -> lang::Config {
    lang::get()
}

/// Save from the settings window; the island and the settings window hear `island://lang`.
#[tauri::command]
fn lang_set(app: AppHandle, pick: String) -> Result<lang::Config, String> {
    let c = lang::set(&pick)?;
    let _ = app.emit("island://lang", &c);
    tray::relabel(&app);
    Ok(c)
}

/// Settings window (a regular window; the island panel never takes the keyboard).
#[tauri::command]
fn open_settings(app: AppHandle, section: Option<String>) {
    settings::open(&app, section.as_deref());
}

/// Player command from the island ("toggle", "next", "seek 42", ...); unknown ones are dropped.
#[tauri::command]
fn media_cmd(media: State<'_, Arc<media::Media>>, cmd: String) {
    media.command(&cmd);
}

/// System output volume, 0..1.
#[tauri::command]
fn set_volume(v: f32) {
    media::set_volume(v);
}

/// Calendar and now-playing providers. Each one failing leaves its module empty.
fn start_feeds(app: &AppHandle, feeds: Arc<Mutex<Feeds>>) -> Arc<media::Media> {
    let (app2, f2) = (app.clone(), feeds.clone());
    calendar::start(move |c| {
        f2.lock().unwrap().calendar = Some(c.clone());
        let _ = app2.emit("island://calendar", c);
    });
    let (app2, f2) = (app.clone(), feeds.clone());
    github::start(move |g| {
        f2.lock().unwrap().github = Some(g.clone());
        let _ = app2.emit("island://github", g);
    });
    let (app2, f2) = (app.clone(), feeds.clone());
    vercel::start(move |v| {
        f2.lock().unwrap().vercel = Some(v.clone());
        let _ = app2.emit("island://vercel", v);
    });
    let (app2, f2) = (app.clone(), feeds.clone());
    notion::start(move |n| {
        f2.lock().unwrap().notion = Some(n.clone());
        let _ = app2.emit("island://notion", n);
    });
    let (app2, f2) = (app.clone(), feeds.clone());
    grafana::start(move |g| {
        f2.lock().unwrap().grafana = Some(g.clone());
        let _ = app2.emit("island://grafana", g);
    });
    let app2 = app.clone();
    media::start(Arc::new(move |name: &str, v: serde_json::Value| {
        // switched off: the player is still watched locally, nothing reaches the island
        if !modules::is_on("music") {
            return;
        }
        {
            let mut f = feeds.lock().unwrap();
            if name == "island://volume" {
                f.volume = v.as_f64().map(|x| x as f32);
            } else {
                // the cover and the player icon come once; keep them for a reloaded page
                let mut m = v.clone();
                if let (Some(prev), Some(o)) = (f.media.as_ref(), m.as_object_mut()) {
                    for key in ["art", "icon"] {
                        if let Some(x) = prev.get(key) {
                            o.entry(key).or_insert_with(|| x.clone());
                        }
                    }
                }
                f.media = Some(m);
            }
        }
        let _ = app2.emit(name, v);
    }))
}

/// Hook server + plan usage watcher. A failure here leaves the island working without
/// Claude Code (the hook client finds no connection file and stays silent).
fn start_claude(app: &AppHandle, hub: Arc<Hub>, usage: Arc<Mutex<Usage>>) -> Option<u16> {
    let (poke_tx, poke_rx) = mpsc::channel::<()>();
    let poke = Mutex::new(poke_tx);
    *hub.on_turn_end.lock().unwrap() = Some(Box::new(move || {
        let _ = poke.lock().unwrap().send(());
    }));
    let app2 = app.clone();
    thread::spawn(move || {
        claude::usage::watch(poke_rx, |u| {
            *usage.lock().unwrap() = u.clone();
            let _ = app2.emit("island://usage", u);
        })
    });
    let h = hub.clone();
    match claude::server::start(Arc::new(move |p, alive: &dyn Fn() -> bool| {
        h.handle(p, alive)
    })) {
        Ok(s) => Some(s.port),
        Err(e) => {
            eprintln!("[claude] hook server not started: {e}");
            None
        }
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
    let usage = Arc::new(Mutex::new(Usage::default()));
    let feeds: Arc<Mutex<Feeds>> = Arc::new(Mutex::new(Feeds::default()));
    let hook_port: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));
    let port_slot = hook_port.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(state.clone())
        .manage(feeds.clone())
        .manage(usage.clone())
        .invoke_handler(tauri::generate_handler![
            island_geometry,
            set_interactive,
            agent_answer,
            claude_usage,
            feeds_state,
            media_cmd,
            set_volume,
            github_connect,
            github_disconnect,
            vercel_connect,
            vercel_disconnect,
            vercel_open,
            notion_connect,
            notion_disconnect,
            notion_open,
            notion_me,
            grafana_connect,
            grafana_disconnect,
            grafana_config,
            grafana_dashboards,
            grafana_panels,
            grafana_pick,
            grafana_open,
            calendar_config,
            calendar_choose,
            calendar_access,
            island_action,
            island_status,
            modules_get,
            modules_set,
            lang_get,
            lang_set,
            open_settings
        ])
        .setup(move |app| {
            // Not in the Dock and not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("island")
                .expect("island window missing");
            // Windows: tao's version would rewrite the extended styles (platform/windows.rs).
            #[cfg(not(windows))]
            window.set_ignore_cursor_events(true)?;
            platform::setup_window(&window);
            platform::set_ignore(&window, true);
            place_and_publish(app.handle(), &window, &state);
            tray::create(app.handle())?;
            let handle = app.handle().clone();
            let hub = Arc::new(Hub::new(Arc::new(move |name: &str, v| {
                let _ = handle.emit(name, v);
            })));
            app.manage(hub.clone());
            *port_slot.lock().unwrap() = start_claude(app.handle(), hub, usage.clone());
            let media = start_feeds(app.handle(), feeds.clone());
            app.manage(media);
            spawn_cursor_poller(app.handle().clone(), window, state.clone());
            // Launch activation (tao, wry) arrives asynchronously; undo it once it has.
            let handle = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(800));
                let _ = handle.run_on_main_thread(platform::yield_activation);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(move |_, e| {
        if let RunEvent::Exit = e {
            if let Some(port) = *hook_port.lock().unwrap() {
                claude::server::remove_connection_file(port);
            }
        }
    });
}
