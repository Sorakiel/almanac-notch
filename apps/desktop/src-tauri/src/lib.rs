//! Island shell: one transparent window at the notch, click-through outside the island.
//!
//! The window ignores the mouse by default. A background thread polls the global cursor and
//! streams it to the frontend (`island://cursor`) while it is near the window. The frontend
//! feeds it to packages/island as pointer moves (hover works while the window is see-through)
//! and turns mouse events on with `set_interactive` only over `islandRect()` or a hit zone.

mod almanac;
mod calendar;
mod claude;
mod github;
mod grafana;
mod notion;
mod vercel;
// on Mac only its tests use it: the choice of sources is Windows-only
#[cfg_attr(target_os = "macos", allow(dead_code))]
mod ical;
mod identity;
mod lang;
mod media;
mod modules;
mod opening;
#[cfg(windows)]
mod outlook;
mod platform;
mod prefs;
mod secrets;
mod settings;
mod shelf;
mod sound;
mod tray;
mod uninstall;
mod update;

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
    /// the left button and what it carries (shelf::drag_state): the island opens onto the shelf
    /// when a file comes near, before the OS drop reaches the window
    drag: u8,
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
/// How often to look for a full-screen app in front (Windows; on the Mac AppKit hides the panel).
const FULLSCREEN_PERIOD: Duration = Duration::from_millis(500);

/// Where the island is now (the settings window's opening grows out of it).
pub(crate) fn island_placement(app: &AppHandle) -> Option<Placement> {
    app.try_state::<SharedState>()
        .map(|s| s.lock().unwrap().placement)
}

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

/// The island page has drawn its first frame: the window may show (platform::ready).
#[tauri::command]
fn island_ready(window: WebviewWindow) {
    platform::ready(&window);
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
    almanac: Option<almanac::State>,
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
    almanac: Option<almanac::State>,
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
        almanac: f.almanac.clone(),
    }
}

/// Connect a GitHub token: checked against GitHub, then kept in secrets.rs. Returns the login.
#[tauri::command]
async fn github_connect(token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || github::connect(&token))
        .await
        .map_err(|e| e.to_string())?
}

/// The CI card's buttons: the repository's failed check page, or a re-run of its failed jobs.
/// Looked up here by repository name, not sent by the page.
fn gh_repo(feeds: &Arc<Mutex<Feeds>>, name: &str) -> Option<github::Repo> {
    feeds
        .lock()
        .unwrap()
        .github
        .as_ref()
        .and_then(|g| g.repos.iter().find(|r| r.name == name).cloned())
}

#[tauri::command]
fn github_open(feeds: State<'_, Arc<Mutex<Feeds>>>, name: String) {
    if let Some(r) = gh_repo(&feeds, &name) {
        github::open(&r.url);
    }
}

/// A PR's "Одобрить": the PR is looked up among the ones waiting for my review, not taken from
/// the page.
#[tauri::command]
async fn github_approve(feeds: State<'_, Arc<Mutex<Feeds>>>, url: String) -> Result<(), String> {
    let pr = feeds
        .lock()
        .unwrap()
        .github
        .as_ref()
        .and_then(|g| g.review.iter().find(|p| p.url == url).cloned())
        .ok_or_else(|| {
            lang::t(
                "Этот PR уже не ждёт ревью",
                "This PR no longer waits for review",
            )
            .to_owned()
        })?;
    tauri::async_runtime::spawn_blocking(move || github::approve(&pr.full, pr.number))
        .await
        .map_err(|e| e.to_string())?
}

/// A PR or another GitHub page from the card's lists (github::open keeps to github.com).
#[tauri::command]
fn github_open_url(url: String) {
    github::open(&url);
}

#[tauri::command]
async fn github_rerun(feeds: State<'_, Arc<Mutex<Feeds>>>, name: String) -> Result<(), String> {
    let r = gh_repo(&feeds, &name)
        .ok_or_else(|| lang::t("Нет такого репозитория", "No such repository").to_owned())?;
    let id = r.run_id.ok_or_else(|| {
        lang::t(
            "Эту проверку не перезапустить отсюда",
            "This check can't be re-run from here",
        )
        .to_owned()
    })?;
    tauri::async_runtime::spawn_blocking(move || github::rerun(&r.full, id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn github_disconnect() {
    let _ = tauri::async_runtime::spawn_blocking(github::disconnect).await;
}

/// Connect a Vercel token: checked against Vercel, then kept in secrets.rs. Returns the username.
#[tauri::command]
async fn vercel_connect(token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || vercel::connect(&token))
        .await
        .map_err(|e| e.to_string())?
}

/// The card's arrow: open a deployment's page; the URL is looked up here, not sent by the page.
fn vercel_deploy(feeds: &Arc<Mutex<Feeds>>, id: &str) -> Option<vercel::Deploy> {
    feeds
        .lock()
        .unwrap()
        .vercel
        .as_ref()
        .and_then(|v| v.deploys.iter().find(|d| d.id == id).cloned())
}

/// A deployment's own level: "Открыть сайт" (its host, looked up here).
#[tauri::command]
fn vercel_site(feeds: State<'_, Arc<Mutex<Feeds>>>, id: String) {
    if let Some(h) = vercel_deploy(&feeds, &id).and_then(|d| d.site) {
        vercel::open_site(&h);
    }
}

/// A failed deployment's "Повторить": Vercel builds it again from the same source.
#[tauri::command]
async fn vercel_redeploy(feeds: State<'_, Arc<Mutex<Feeds>>>, id: String) -> Result<(), String> {
    let d = vercel_deploy(&feeds, &id)
        .ok_or_else(|| lang::t("Нет такого деплоя", "No such deployment").to_owned())?;
    tauri::async_runtime::spawn_blocking(move || vercel::redeploy(&d))
        .await
        .map_err(|e| e.to_string())?
}

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

/// Almanac sign-in with email and password; returns the account's email.
#[tauri::command]
async fn almanac_sign_in(email: String, password: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || almanac::sign_in(&email, &password))
        .await
        .map_err(|e| e.to_string())?
}

/// Almanac sign-in by a code from the email: send it.
#[tauri::command]
async fn almanac_send_code(email: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || almanac::send_code(&email))
        .await
        .map_err(|e| e.to_string())?
}

/// ...and check it; returns the account's email.
#[tauri::command]
async fn almanac_verify(email: String, code: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || almanac::verify_code(&email, &code))
        .await
        .map_err(|e| e.to_string())?
}

/// "Sign in with Almanac" in the browser; returns the account's email (waits up to 5 minutes).
#[tauri::command]
async fn almanac_browser_sign_in() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(almanac::sign_in_browser)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn almanac_browser_cancel() {
    almanac::cancel_browser();
}

#[tauri::command]
async fn almanac_sign_out() {
    let _ = tauri::async_runtime::spawn_blocking(almanac::sign_out).await;
}

/// This build can sign in to Almanac (its address came with the build).
#[tauri::command]
fn almanac_available() -> bool {
    almanac::available()
}

/// A habit row on the island: mark it (or clear it) for today; the new day follows as
/// `island://almanac`, a failure re-reads the day.
#[tauri::command]
async fn almanac_toggle(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || almanac::toggle(&id))
        .await
        .map_err(|e| e.to_string())?
}

/// The calendar card's "Подключиться": the event's call link (calendar::join checks it).
#[tauri::command]
fn calendar_join(url: String) -> Result<(), String> {
    calendar::join(&url)
}

/// The Almanac card's "Открыть в Almanac": the habit's page in the web app.
#[tauri::command]
fn almanac_open(id: String) -> Result<(), String> {
    almanac::open_habit(&id)
}

/// Connect a Notion integration token: checked against Notion, then kept in secrets.rs.
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
/// secrets.rs. Returns the organisation's name.
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
    almanac::poke();
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

#[derive(Serialize)]
struct AppInfo {
    version: String,
    /// the commit of this build (build.rs), empty when unknown
    build: &'static str,
    onboarded: bool,
    updates: bool,
    fullscreen_hide: bool,
    autostart: bool,
    update: update::State,
}

fn app_info_of(app: &AppHandle) -> AppInfo {
    use tauri_plugin_autostart::ManagerExt;
    let p = prefs::get();
    AppInfo {
        version: app.package_info().version.to_string(),
        build: env!("ALMANAC_BUILD"),
        onboarded: p.onboarded,
        updates: p.updates,
        fullscreen_hide: p.fullscreen_hide,
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        update: update::state(),
    }
}

/// Version, first-run flag, launch at login, update switch and state (stage 8f).
#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    app_info_of(&app)
}

/// `key`: "autostart" | "updates" | "onboarded" | "fullscreen".
#[tauri::command]
fn app_set(app: AppHandle, key: String, on: bool) -> Result<AppInfo, String> {
    use tauri_plugin_autostart::ManagerExt;
    match key.as_str() {
        "autostart" => {
            let l = app.autolaunch();
            if on { l.enable() } else { l.disable() }.map_err(|e| {
                format!(
                    "{}: {e}",
                    lang::t(
                        "Не удалось изменить запуск при входе",
                        "Could not change launch at login"
                    )
                )
            })?;
        }
        "updates" => {
            prefs::set(|p| p.updates = on)?;
            if on && update::state().state == "idle" {
                tauri::async_runtime::spawn(update::check(app.clone()));
            }
        }
        "onboarded" => {
            prefs::set(|p| p.onboarded = on)?;
        }
        "fullscreen" => {
            prefs::set(|p| p.fullscreen_hide = on)?;
        }
        _ => return Err(format!("unknown setting {key}")),
    }
    Ok(app_info_of(&app))
}

#[tauri::command]
async fn update_check(app: AppHandle) -> update::State {
    update::check(app).await
}

#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    update::install(app).await
}

/// The hook client's connection file goes with the process (exit, update restart).
struct HookPort(Arc<Mutex<Option<u16>>>);

pub(crate) fn remove_hook_connection(app: &AppHandle) {
    if let Some(p) = app.try_state::<HookPort>() {
        if let Some(port) = *p.0.lock().unwrap() {
            claude::server::remove_connection_file(port);
        }
    }
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
    let (app2, f2) = (app.clone(), feeds.clone());
    almanac::start(move |a| {
        f2.lock().unwrap().almanac = Some(a.clone());
        let _ = app2.emit("island://almanac", a);
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

/// Hooks installed by an older build: bring our timeouts up to date (install::plan_refresh),
/// so a prompt held behind a full-screen app is not killed by Claude Code at 45 s.
fn refresh_hooks() {
    let settings = almanac_hook::paths::claude_settings();
    match almanac_hook::install::plan_refresh(&settings) {
        Ok(plan) if plan.changed() => match almanac_hook::install::apply(&plan) {
            Ok(b) => eprintln!("[claude] hook timeouts updated, backup: {b:?}"),
            Err(e) => eprintln!("[claude] hook timeouts not updated: {e}"),
        },
        Ok(_) => {}
        Err(e) => eprintln!("[claude] hook timeouts not checked: {e}"),
    }
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
    refresh_hooks();
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

fn spawn_cursor_poller(app: AppHandle, window: WebviewWindow, state: SharedState, hub: Arc<Hub>) {
    thread::spawn(move || {
        let mut last_watch = Instant::now();
        let mut last_fs = Instant::now();
        loop {
            if last_fs.elapsed() >= FULLSCREEN_PERIOD {
                last_fs = Instant::now();
                if let Some(hidden) =
                    platform::fullscreen_tick(&window, prefs::get().fullscreen_hide)
                {
                    eprintln!("[island] full-screen app in front: {hidden}");
                    hub.set_hidden(hidden);
                    let _ = app.emit("island://fullscreen", hidden);
                }
            }
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
                        drag: shelf::drag_state(),
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

/// One copy of the embedded config and pages for both the island and the uninstall window.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

pub fn run() {
    // stage 8g: `--cleanup` (hooks only) and, on Windows, the uninstall window
    match uninstall::cli() {
        uninstall::Cli::Exit(code) => std::process::exit(code),
        #[cfg(windows)]
        uninstall::Cli::Bye(dir) => return uninstall::run_window(dir, context()),
        _ => {}
    }

    // before any window: the webview's storage moves with the rest
    identity::migrate();

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(HookPort(hook_port.clone()))
        .manage(state.clone())
        .manage(feeds.clone())
        .manage(usage.clone())
        .invoke_handler(tauri::generate_handler![
            sound::sound_quiet,
            island_geometry,
            island_ready,
            set_interactive,
            shelf::shelf_add_text,
            shelf::shelf_drop_point,
            shelf::shelf_open,
            shelf::shelf_drag,
            shelf::shelf_quicklook,
            shelf::shelf_menu,
            agent_answer,
            claude_usage,
            feeds_state,
            media_cmd,
            set_volume,
            github_connect,
            github_disconnect,
            github_open,
            github_open_url,
            github_approve,
            github_rerun,
            vercel_connect,
            vercel_disconnect,
            vercel_open,
            vercel_site,
            vercel_redeploy,
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
            almanac_sign_in,
            almanac_send_code,
            almanac_verify,
            almanac_sign_out,
            almanac_browser_sign_in,
            almanac_browser_cancel,
            almanac_available,
            almanac_toggle,
            almanac_open,
            calendar_join,
            calendar_config,
            calendar_choose,
            calendar_access,
            island_action,
            island_status,
            modules_get,
            modules_set,
            lang_get,
            lang_set,
            app_info,
            app_set,
            update_check,
            update_install,
            open_settings,
            opening::opening_show,
            opening::opening_done,
            uninstall::open_bye,
            uninstall::bye_info,
            uninstall::bye_run,
            uninstall::bye_quit
        ])
        .setup(move |app| {
            // Not in the Dock and not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // the island is created here, not from the config: the uninstall window process
            // (stage 8g) shares this config and must not open it
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "island")
                .expect("island window missing")
                .clone();
            let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            // Windows: WebView2 takes drops itself, Tauri's handler misses Explorer's (shelf/win.rs)
            #[cfg(windows)]
            let builder = builder.disable_drag_drop_handler();
            let window = builder.build()?;
            // Windows: tao's version would rewrite the extended styles (platform/windows.rs).
            #[cfg(not(windows))]
            window.set_ignore_cursor_events(true)?;
            platform::setup_window(&window);
            platform::set_ignore(&window, true);
            shelf::init(app.handle(), &window);
            place_and_publish(app.handle(), &window, &state);
            // the page says when it has drawn (island_ready); a page that never does - a script
            // error, a stuck load - must not leave the island hidden for good
            let late = window.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(8));
                platform::ready(&late);
            });
            tray::create(app.handle())?;
            let handle = app.handle().clone();
            let hub = Arc::new(Hub::new(Arc::new(move |name: &str, v| {
                let _ = handle.emit(name, v);
            })));
            app.manage(hub.clone());
            *port_slot.lock().unwrap() = start_claude(app.handle(), hub.clone(), usage.clone());
            let media = start_feeds(app.handle(), feeds.clone());
            app.manage(media);
            spawn_cursor_poller(app.handle().clone(), window, state.clone(), hub);
            update::start(app.handle());
            // first run: the guide (language, Claude Code, calendar, modules, launch at login)
            if !prefs::get().onboarded {
                settings::open(app.handle(), Some("welcome"));
            }
            // Launch activation (tao, wry) arrives asynchronously; undo it once it has.
            let handle = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(800));
                let _ = handle.run_on_main_thread(platform::yield_activation);
            });
            Ok(())
        })
        .build(context())
        .expect("error while building tauri application");
    app.run(move |_, e| {
        if let RunEvent::Exit = e {
            if let Some(port) = *hook_port.lock().unwrap() {
                claude::server::remove_connection_file(port);
            }
        }
    });
}
