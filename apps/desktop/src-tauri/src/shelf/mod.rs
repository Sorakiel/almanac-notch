//! The "+" tab's shelf (docs/PLAN.md stage 9): things dropped on the island wait here for 10
//! minutes until they are dragged somewhere else.
//!
//! - Files and folders are kept by reference: the shelf never copies, moves or deletes them.
//! - Text and links are written to `<app data>/shelf`, which belongs to us: emptied at every
//!   start (the shelf does not outlive the app) and file by file as items leave.
//! - Only paths that came from a real drop get on the shelf - the page cannot ask to put an
//!   arbitrary path here (and so later read it through Quick Look or a drag out).
//!
//! The island draws everything (packages/island/src/island/shelf.ts); this side tells it
//! `island://shelf-add`, `island://shelf-remove`, `island://shelf-thumb`.

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
use mac as os;
#[cfg(windows)]
mod win;
#[cfg(windows)]
use win as os;
#[cfg(not(any(target_os = "macos", windows)))]
mod os {
    use super::*;
    pub fn drag(_app: &AppHandle, _w: &WebviewWindow, _items: Vec<Item>) {}
    pub fn quicklook(_app: &AppHandle, _items: Vec<Item>) {}
    pub fn mail(_app: &AppHandle, _items: Vec<Item>) {}
    pub fn thumb(_path: &Path) -> Option<Vec<u8>> {
        None
    }
    pub fn setup(_app: &AppHandle, _w: &WebviewWindow) {}
    pub fn drag_state() -> u8 {
        0
    }
}

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::lang::t;

/// How long a thing stays: the owner's decision 2026-10-18.
const LIFE_SECS: u64 = 600;

/// The life of a shelf item; debug builds take `ALMANAC_SHELF_LIFE` (s) to check the end live.
fn life() -> Duration {
    #[cfg(debug_assertions)]
    if let Some(s) = std::env::var("ALMANAC_SHELF_LIFE")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        return Duration::from_secs(s);
    }
    Duration::from_secs(LIFE_SECS)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
    Image,
    Text,
    Link,
}

#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub kind: Kind,
    /// the file itself, or our file for text and links
    pub path: PathBuf,
    /// ours to delete (text, links, pictures without a file)
    pub owned: bool,
    pub name: String,
    pub size: Option<u64>,
    pub note: String,
    /// the text or the URL itself, for a drag out as text and for "open"
    pub text: Option<String>,
    pub added: Instant,
}

/// An item as the island gets it.
#[derive(Serialize)]
pub struct Msg {
    id: String,
    kind: Kind,
    name: String,
    size: Option<u64>,
    note: String,
    left: f64,
    thumb: Option<String>,
}

impl Item {
    fn msg(&self) -> Msg {
        Msg {
            id: self.id.clone(),
            kind: self.kind,
            name: self.name.clone(),
            size: self.size,
            note: self.note.clone(),
            left: life().saturating_sub(self.added.elapsed()).as_secs_f64(),
            thumb: None,
        }
    }
}

#[derive(Default)]
pub struct Shelf {
    items: Vec<Item>,
    seq: u64,
    /// where the page saw a drop whose files arrive separately (Windows), island px
    point: Option<(f64, f64)>,
    /// the ids the open menu acts on
    menu: Vec<String>,
}

pub type ShelfState = Arc<Mutex<Shelf>>;

/// What the left button is doing, for the cursor stream: 0 up, 1 held, 2 carrying something
/// to drop (macOS can tell; Windows reports 1 and the page waits for the real dragenter).
pub fn drag_state() -> u8 {
    os::drag_state()
}

/// Our folder for text and links.
pub fn dir() -> PathBuf {
    almanac_hook::paths::app_dir().join("shelf")
}

/// Start: an empty folder, the clock that lets items go, the OS parts (drops, menus).
pub fn init(app: &AppHandle, window: &WebviewWindow) {
    let _ = fs::remove_dir_all(dir());
    let state: ShelfState = Arc::new(Mutex::new(Shelf::default()));
    app.manage(state.clone());
    os::setup(app, window);
    let app2 = app.clone();
    window.on_menu_event(move |_, e| menu_action(&app2, e.id().as_ref()));
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let due: Vec<Item> = {
            let mut s = state.lock().unwrap();
            let (due, keep) = s
                .items
                .drain(..)
                .partition(|it| it.added.elapsed() >= life());
            s.items = keep;
            due
        };
        if !due.is_empty() {
            gone(&app, &due, "expired");
        }
    });
}

/// Items left: their files of ours deleted, the island told.
fn gone(app: &AppHandle, items: &[Item], how: &str) {
    for it in items.iter().filter(|it| it.owned) {
        let _ = fs::remove_file(&it.path);
    }
    let ids: Vec<&str> = items.iter().map(|it| it.id.as_str()).collect();
    let _ = app.emit(
        "island://shelf-remove",
        serde_json::json!({ "ids": ids, "how": how }),
    );
}

/// Take items off the shelf by id ("sent" after a drag out or a letter, "removed" by the menu).
pub fn take(app: &AppHandle, ids: &[String], how: &str) {
    let state = app.state::<ShelfState>();
    let out: Vec<Item> = {
        let mut s = state.lock().unwrap();
        let (out, keep) = s.items.drain(..).partition(|it| ids.contains(&it.id));
        s.items = keep;
        out
    };
    if !out.is_empty() {
        gone(app, &out, how);
    }
}

fn pick(app: &AppHandle, ids: &[String]) -> Vec<Item> {
    let state = app.state::<ShelfState>();
    let s = state.lock().unwrap();
    // in the shelf's order, which is the island's
    s.items
        .iter()
        .filter(|it| ids.contains(&it.id))
        .cloned()
        .collect()
}

fn next_id(s: &mut Shelf) -> String {
    s.seq += 1;
    format!("s{}", s.seq)
}

const IMAGE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "avif",
];

fn ext(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Files and folders let go over the island (paths straight from the OS drop).
pub fn add_paths(app: &AppHandle, paths: Vec<PathBuf>, point: Option<(f64, f64)>) {
    let state = app.state::<ShelfState>();
    let added: Vec<Item> = {
        let mut s = state.lock().unwrap();
        let mut added = Vec::new();
        for p in paths {
            let Ok(meta) = fs::metadata(&p) else { continue };
            // the same file again: it comes to the front with a fresh 10 minutes
            let old = s.items.iter().position(|it| !it.owned && it.path == p);
            let id = match old {
                Some(i) => s.items.remove(i).id,
                None => next_id(&mut s),
            };
            let kind = if meta.is_dir() {
                Kind::Folder
            } else if IMAGE.contains(&ext(&p).as_str()) {
                Kind::Image
            } else {
                Kind::File
            };
            added.push(Item {
                id,
                kind,
                name: p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                size: meta.is_file().then_some(meta.len()),
                note: String::new(),
                text: None,
                path: p,
                owned: false,
                added: Instant::now(),
            });
        }
        for (i, it) in added.iter().enumerate() {
            s.items.insert(i, it.clone());
        }
        added
    };
    publish(app, added, point);
}

/// Text or a link let go over the island: written to our folder so it can also be dragged out
/// as a file (Finder, Windows).
pub fn add_text(app: &AppHandle, text: &str, link: bool, point: Option<(f64, f64)>) -> Vec<Msg> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let link = link || is_url(text);
    let note = if link { host(text) } else { String::new() };
    let name = if link {
        link_name(text)
    } else {
        first_words(text)
    };
    let (file, body) = if link {
        link_file(&name, text)
    } else {
        (format!("{}.txt", safe(&name)), text.to_string())
    };
    let state = app.state::<ShelfState>();
    let item = {
        let mut s = state.lock().unwrap();
        let id = next_id(&mut s);
        // each in a folder of its own: two texts with the same first words keep their names
        let path = dir().join(&id).join(file);
        if fs::create_dir_all(path.parent().unwrap()).is_err() || fs::write(&path, &body).is_err() {
            return Vec::new();
        }
        let item = Item {
            id,
            kind: if link { Kind::Link } else { Kind::Text },
            size: Some(body.len() as u64),
            name,
            note,
            text: Some(text.to_string()),
            path,
            owned: true,
            added: Instant::now(),
        };
        s.items.insert(0, item.clone());
        item
    };
    let msg = vec![item.msg()];
    if point.is_some() {
        publish(app, vec![item], point);
        return Vec::new();
    }
    msg
}

/// A picture without a file (dragged from a browser): PNG bytes into our folder.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn add_image(app: &AppHandle, png: &[u8], name: &str, point: Option<(f64, f64)>) {
    let state = app.state::<ShelfState>();
    let item = {
        let mut s = state.lock().unwrap();
        let id = next_id(&mut s);
        let path = dir().join(&id).join(name);
        if fs::create_dir_all(path.parent().unwrap()).is_err() || fs::write(&path, png).is_err() {
            return;
        }
        let item = Item {
            id,
            kind: Kind::Image,
            size: Some(png.len() as u64),
            name: name.to_string(),
            note: String::new(),
            text: None,
            path,
            owned: true,
            added: Instant::now(),
        };
        s.items.insert(0, item.clone());
        item
    };
    publish(app, vec![item], point);
}

/// Tell the island, then make previews in the background (they come by `island://shelf-thumb`).
fn publish(app: &AppHandle, items: Vec<Item>, point: Option<(f64, f64)>) {
    if items.is_empty() {
        return;
    }
    let msgs: Vec<Msg> = items.iter().map(Item::msg).collect();
    let (x, y) = point.map_or((None, None), |(x, y)| (Some(x), Some(y)));
    let _ = app.emit(
        "island://shelf-add",
        serde_json::json!({ "items": msgs, "x": x, "y": y }),
    );
    let app = app.clone();
    thread::spawn(move || {
        for it in items
            .iter()
            .filter(|it| matches!(it.kind, Kind::File | Kind::Image))
        {
            if let Some(png) = os::thumb(&it.path) {
                let b64 = base64::engine::general_purpose::STANDARD.encode(png);
                let _ = app.emit(
                    "island://shelf-thumb",
                    serde_json::json!({ "id": it.id, "thumb": b64 }),
                );
            }
        }
    });
}

fn is_url(s: &str) -> bool {
    (s.starts_with("https://") || s.starts_with("http://")) && !s.contains(char::is_whitespace)
}

fn host(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let h = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    h.trim_start_matches("www.").to_string()
}

/// "github.com/Louis-CFM/coucou": the host and the start of the path, the part people recognise
fn link_name(url: &str) -> String {
    let rest = url.split("://").nth(1).unwrap_or(url);
    let rest = rest.trim_start_matches("www.");
    let path = rest
        .split(['?', '#'])
        .next()
        .unwrap_or(rest)
        .trim_end_matches('/');
    path.chars().take(80).collect()
}

fn first_words(text: &str) -> String {
    let line = text
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or(text)
        .trim();
    let mut out = String::new();
    for w in line.split_whitespace() {
        if out.chars().count() + w.chars().count() > 40 {
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    if out.is_empty() {
        line.chars().take(40).collect()
    } else {
        out
    }
}

/// A name a file system takes on both systems.
fn safe(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if "/\\:*?\"<>|".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        "text".into()
    } else {
        s.chars().take(60).collect()
    }
}

/// A link as a file: .webloc on the Mac, .url on Windows - what Finder and Explorer make themselves.
fn link_file(name: &str, url: &str) -> (String, String) {
    let base = safe(&name.replace('/', " "));
    if cfg!(windows) {
        (
            format!("{base}.url"),
            format!("[InternetShortcut]\r\nURL={url}\r\n"),
        )
    } else {
        let esc = url
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        (
            format!("{base}.webloc"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>URL</key><string>{esc}</string></dict></plist>\n"
            ),
        )
    }
}

fn open_path(p: &Path) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(p).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer").arg(p).spawn();
}

fn open_url(url: &str) {
    if !is_url(url) {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
}

fn reveal(p: &Path) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg("-R").arg(p).spawn();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer wants "/select,<path>" as one argument, unquoted
        let mut arg = std::ffi::OsString::from("/select,");
        arg.push(p.as_os_str());
        let _ = std::process::Command::new("explorer").raw_arg(arg).spawn();
    }
}

fn open_item(it: &Item) {
    match (it.kind, &it.text) {
        (Kind::Link, Some(url)) => open_url(url),
        _ => open_path(&it.path),
    }
}

// ---------- commands ----------

/// Text or a link from the page's HTML5 drop (Windows, where the WebView takes drops).
#[tauri::command]
pub fn shelf_add_text(app: AppHandle, text: String, link: bool) -> Vec<Msg> {
    add_text(&app, &text, link, None)
}

/// Where the page saw files dropped; their paths come next through WebView2 (Windows).
#[tauri::command]
pub fn shelf_drop_point(state: State<'_, ShelfState>, x: f64, y: f64) {
    state.lock().unwrap().point = Some((x, y));
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn take_point(app: &AppHandle) -> Option<(f64, f64)> {
    app.state::<ShelfState>().lock().unwrap().point.take()
}

#[tauri::command]
pub fn shelf_open(app: AppHandle, id: String) {
    if let Some(it) = pick(&app, &[id]).first() {
        open_item(it);
    }
}

/// A drag out of the island: the OS session; success takes the items off, a cancel keeps them.
#[tauri::command]
pub fn shelf_drag(app: AppHandle, window: WebviewWindow, ids: Vec<String>) {
    let items = pick(&app, &ids);
    if items.is_empty() {
        return;
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || os::drag(&app2, &window, items));
}

#[tauri::command]
pub fn shelf_quicklook(app: AppHandle, ids: Vec<String>) {
    let items = pick(&app, &ids);
    if !items.is_empty() {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || os::quicklook(&app2, items));
    }
}

/// The right click on tiles: open, Quick Look, show in Finder, mail, remove - nothing more
/// (docs/PLAN.md: each extra item needs a reason).
#[tauri::command]
pub fn shelf_menu(app: AppHandle, window: WebviewWindow, ids: Vec<String>) -> Result<(), String> {
    let items = pick(&app, &ids);
    if items.is_empty() {
        return Ok(());
    }
    app.state::<ShelfState>().lock().unwrap().menu = ids;
    let many = items.len() > 1;
    let has_file = items.iter().any(|it| !it.owned);
    let e = |e: tauri::Error| e.to_string();
    let open = MenuItem::with_id(
        &app,
        "shelf:open",
        if many {
            t("Открыть все", "Open all")
        } else {
            t("Открыть", "Open")
        },
        true,
        None::<&str>,
    )
    .map_err(e)?;
    let look = MenuItem::with_id(
        &app,
        "shelf:look",
        "Quick Look",
        cfg!(target_os = "macos"),
        None::<&str>,
    )
    .map_err(e)?;
    let show = MenuItem::with_id(
        &app,
        "shelf:reveal",
        if cfg!(windows) {
            t("Показать в Проводнике", "Show in Explorer")
        } else {
            t("Показать в Finder", "Show in Finder")
        },
        has_file || items.iter().all(|it| it.kind != Kind::Link),
        None::<&str>,
    )
    .map_err(e)?;
    let mail = MenuItem::with_id(
        &app,
        "shelf:mail",
        t("Отправить письмом", "Send by email"),
        true,
        None::<&str>,
    )
    .map_err(e)?;
    let remove = MenuItem::with_id(
        &app,
        "shelf:remove",
        t("Убрать с полки", "Remove from shelf"),
        true,
        None::<&str>,
    )
    .map_err(e)?;
    let sep = PredefinedMenuItem::separator(&app).map_err(e)?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(e)?;
    let menu = if cfg!(target_os = "macos") {
        Menu::with_items(&app, &[&open, &look, &show, &sep, &mail, &sep2, &remove])
    } else {
        // Windows has no system Quick Look
        Menu::with_items(&app, &[&open, &show, &sep, &mail, &sep2, &remove])
    }
    .map_err(e)?;
    window.popup_menu(&menu).map_err(e)
}

fn menu_action(app: &AppHandle, id: &str) {
    let Some(what) = id.strip_prefix("shelf:") else {
        return;
    };
    let ids = std::mem::take(&mut app.state::<ShelfState>().lock().unwrap().menu);
    let items = pick(app, &ids);
    match what {
        "open" => items.iter().for_each(open_item),
        "reveal" => items.iter().for_each(|it| reveal(&it.path)),
        "look" => {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || os::quicklook(&app2, items));
        }
        "mail" => {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || os::mail(&app2, items));
        }
        "remove" => take(app, &ids, "removed"),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(host("https://www.github.com/a/b?x=1"), "github.com");
        assert_eq!(
            link_name("https://github.com/Louis-CFM/coucou/"),
            "github.com/Louis-CFM/coucou"
        );
        assert_eq!(
            first_words("  \n Позвонить в 15:00 насчёт договора и ещё много слов дальше"),
            "Позвонить в 15:00 насчёт договора и ещё"
        );
        assert_eq!(safe("a/b:c?"), "a-b-c-");
        assert!(is_url("https://x.ru/a"));
        assert!(!is_url("https://x.ru/a b"));
    }
}
