//! Notion (stage 8): the pages edited last among those shared with my integration (the card
//! shows three, like coucou).
//!
//! The internal integration token lives only in the system keychain (service `dev.almanac.notch`),
//! like GitHub's and Vercel's. A thread asks `api.notion.com` once a minute (and right after a
//! token change) and sends `island://notion` when the result changed. Only page titles, icons,
//! edit times, who edited and links leave this module; page contents are never read, and the
//! token never goes to the frontend or to a log. Without a token, or with the module switched
//! off, nothing is requested.
//!
//! "Me" (edits by anyone else are an island event): picked in settings and kept in
//! `<app data>/notion.json`, or the workspace's only person.

use std::collections::HashSet;
use std::fs;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SERVICE: &str = "dev.almanac.notch";
const ACCOUNT: &str = "notion-token";
const API: &str = "https://api.notion.com";
/// the API version the answers below are parsed for
const VERSION: &str = "2022-06-28";
const PERIOD: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// results asked: a few more than kept, the trashed ones are dropped
const ASK: u32 = 15;
/// pages kept, newest first
const KEEP: usize = 10;

/// One page (or database) shared with the integration.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Page {
    pub id: String,
    /// None = untitled (the frontend writes "Без названия" in the interface's language)
    pub title: Option<String>,
    /// the page's emoji icon, when it has one
    pub emoji: Option<String>,
    /// last edited, epoch ms
    pub edited: f64,
    /// "page" | "database"
    pub kind: &'static str,
    /// who edited last (a Notion user id)
    pub by: Option<String>,
    /// the page on notion.so (opened from the card)
    pub url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    /// "off" no token | "ok" | "bad" the token was refused | "net" no answer (data kept)
    pub auth: &'static str,
    /// the workspace the integration belongs to
    pub workspace: Option<String>,
    /// newest first
    pub pages: Vec<Page>,
    /// the workspace's people (empty without the "read user information" capability)
    pub people: Vec<Person>,
    /// my user id: picked in settings, or the only person; None = unknown (no edit events)
    pub me: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Person {
    pub id: String,
    pub name: String,
}

impl State {
    pub fn off() -> Self {
        State {
            auth: "off",
            workspace: None,
            pages: Vec::new(),
            people: Vec::new(),
            me: None,
        }
    }
}

// ---------- "me" ----------

#[derive(Default, Serialize, Deserialize)]
struct Config {
    me: Option<String>,
}

fn cfg_path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("notion.json")
}

fn picked() -> Option<String> {
    fs::read(cfg_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
        .and_then(|c| c.me)
}

/// From the settings window: who I am among the workspace's people (None = forget).
pub fn set_me(me: Option<String>) -> Result<(), String> {
    fs::create_dir_all(almanac_hook::paths::app_dir()).map_err(|e| e.to_string())?;
    fs::write(
        cfg_path(),
        serde_json::to_string(&Config { me }).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    poke();
    Ok(())
}

/// The picked one if still in the workspace, else the only person.
fn resolve_me(picked: Option<String>, people: &[Person]) -> Option<String> {
    match picked {
        Some(id) if people.is_empty() || people.iter().any(|p| p.id == id) => Some(id),
        _ if people.len() == 1 => Some(people[0].id.clone()),
        _ => None,
    }
}

// ---------- keychain ----------

fn entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

fn token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

// ---------- reading ----------

enum Failure {
    Unauthorized,
    Net,
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        // the system's TLS and trust store (SecureTransport, SChannel): no bundled roots
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into()
}

fn failure(e: ureq::Error) -> Failure {
    match e {
        // a revoked or made-up token
        ureq::Error::StatusCode(401 | 403) => Failure::Unauthorized,
        _ => Failure::Net,
    }
}

/// The workspace behind a token; Err = refused or unreachable.
fn workspace(token: &str) -> Result<String, Failure> {
    let mut resp = agent()
        .get(format!("{API}/v1/users/me"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", VERSION)
        .header("User-Agent", "almanac-notch")
        .call()
        .map_err(failure)?;
    let v = resp
        .body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)?;
    // an internal integration is a bot; its owner is the workspace
    v["bot"]["workspace_name"]
        .as_str()
        .or_else(|| v["name"].as_str())
        .filter(|n| !n.is_empty())
        .map(str::to_owned)
        .or_else(|| v["object"].as_str().map(|_| "Notion".to_owned()))
        .ok_or(Failure::Unauthorized)
}

fn search(token: &str) -> Result<Value, Failure> {
    let mut resp = agent()
        .post(format!("{API}/v1/search"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", VERSION)
        .header("User-Agent", "almanac-notch")
        .send_json(json!({
            "sort": {"direction": "descending", "timestamp": "last_edited_time"},
            "page_size": ASK,
        }))
        .map_err(failure)?;
    resp.body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

/// The workspace's people; empty when the integration may not read users.
fn people(token: &str) -> Vec<Person> {
    let Ok(mut resp) = agent()
        .get(format!("{API}/v1/users?page_size=100"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Notion-Version", VERSION)
        .header("User-Agent", "almanac-notch")
        .call()
    else {
        return Vec::new();
    };
    resp.body_mut()
        .read_json::<Value>()
        .map(|v| parse_people(&v))
        .unwrap_or_default()
}

fn parse_people(v: &Value) -> Vec<Person> {
    v["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|u| u["type"].as_str() == Some("person"))
        .filter_map(|u| {
            Some(Person {
                id: u["id"].as_str()?.to_owned(),
                name: u["name"].as_str().unwrap_or("?").to_owned(),
            })
        })
        .collect()
}

fn fetch(token: &str) -> Result<State, Failure> {
    let ws = workspace(token)?;
    let v = search(token)?;
    let people = people(token);
    Ok(State {
        auth: "ok",
        workspace: Some(ws),
        pages: newest(parse_pages(&v)),
        me: resolve_me(picked(), &people),
        people,
    })
}

fn plain(rich: &Value) -> Option<String> {
    let s: String = rich
        .as_array()?
        .iter()
        .filter_map(|r| r["plain_text"].as_str())
        .collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    (!s.is_empty()).then_some(s)
}

/// `/v1/search` answer -> pages. Unknown shapes give an empty list.
fn parse_pages(v: &Value) -> Vec<Page> {
    let mut out = Vec::new();
    for p in v["results"].as_array().into_iter().flatten() {
        let kind = match p["object"].as_str() {
            Some("page") => "page",
            Some("database") => "database",
            _ => continue,
        };
        if p["archived"].as_bool() == Some(true) || p["in_trash"].as_bool() == Some(true) {
            continue;
        }
        let (Some(id), Some(edited)) = (
            p["id"].as_str(),
            p["last_edited_time"]
                .as_str()
                .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                .map(|t| t.timestamp_millis() as f64),
        ) else {
            continue;
        };
        let title = if kind == "database" {
            plain(&p["title"])
        } else {
            // the one property of type "title", whatever it is called
            p["properties"]
                .as_object()
                .into_iter()
                .flat_map(|o| o.values())
                .find(|x| x["type"].as_str() == Some("title"))
                .and_then(|x| plain(&x["title"]))
        };
        let emoji = (p["icon"]["type"].as_str() == Some("emoji"))
            .then(|| p["icon"]["emoji"].as_str())
            .flatten()
            .filter(|e| e.chars().count() <= 8)
            .map(str::to_owned);
        out.push(Page {
            id: id.to_owned(),
            title,
            emoji,
            edited,
            kind,
            by: p["last_edited_by"]["id"].as_str().map(str::to_owned),
            url: p["url"].as_str().filter(|u| safe_url(u)).map(str::to_owned),
        });
    }
    out
}

/// Newest first; the same page twice counts once.
fn newest(mut all: Vec<Page>) -> Vec<Page> {
    all.sort_by(|a, b| b.edited.total_cmp(&a.edited));
    let mut seen = HashSet::new();
    all.retain(|p| seen.insert(p.id.clone()));
    all.truncate(KEEP);
    all
}

/// Only Notion's own pages are ever opened.
fn safe_url(u: &str) -> bool {
    (u.starts_with("https://www.notion.so/") || u.starts_with("https://notion.so/"))
        && !u.chars().any(|c| c.is_whitespace() || c == '"')
}

/// Open a page in the browser (Notion's site hands it to the app when one is installed).
/// The URL comes from Notion's answer, checked above.
pub fn open(url: &str) {
    if !safe_url(url) {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

// ---------- worker ----------

static POKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

/// Read again now: token changed, the module was switched.
pub fn poke() {
    if let Some(tx) = POKE.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

pub fn start(emit: impl Fn(&State) + Send + 'static) {
    let (tx, rx) = channel::<()>();
    *POKE.lock().unwrap() = Some(tx);
    thread::spawn(move || {
        let mut last: Option<State> = None;
        let mut wait = PERIOD;
        loop {
            let next = match token().filter(|_| crate::modules::is_on("notion")) {
                // no token, or the module is switched off: no requests
                None => {
                    wait = PERIOD;
                    State::off()
                }
                Some(t) => match fetch(&t) {
                    Ok(s) => {
                        wait = PERIOD;
                        s
                    }
                    Err(Failure::Unauthorized) => {
                        wait = MAX_BACKOFF;
                        State {
                            auth: "bad",
                            ..State::off()
                        }
                    }
                    Err(Failure::Net) => {
                        // also 429: Notion asks to slow down
                        wait = (wait * 2).min(MAX_BACKOFF);
                        // keep what we had; only the flag changes
                        State {
                            auth: "net",
                            ..last.clone().unwrap_or_else(State::off)
                        }
                    }
                },
            };
            if last.as_ref() != Some(&next) {
                emit(&next);
                last = Some(next);
            }
            match rx.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while rx.try_recv().is_ok() {}
        }
    });
}

/// Check the token against Notion, then keep it in the keychain. Returns the workspace name.
pub fn connect(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err(crate::lang::t("Пустой токен", "Empty token").into());
    }
    let ws = workspace(token).map_err(|e| match e {
        Failure::Unauthorized => {
            crate::lang::t("Notion не принял токен", "Notion rejected the token").to_owned()
        }
        Failure::Net => crate::lang::t(
            "Нет связи с api.notion.com",
            "No connection to api.notion.com",
        )
        .to_owned(),
    })?;
    entry().and_then(|e| e.set_password(token)).map_err(|_| {
        crate::lang::t(
            "Не удалось записать токен в Связку ключей",
            "Cannot save the token to the system keychain",
        )
        .to_owned()
    })?;
    poke();
    Ok(ws)
}

pub fn disconnect() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    poke();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn results() -> Value {
        json!({"object": "list", "results": [
            {"object": "page", "id": "p-old", "last_edited_time": "2026-10-17T08:00:00.000Z",
             "properties": {"Name": {"type": "title", "title": [{"plain_text": "Старое"}]}},
             "url": "https://www.notion.so/Old-1"},
            {"object": "page", "id": "p-new", "last_edited_time": "2026-10-18T09:30:00.000Z",
             "icon": {"type": "emoji", "emoji": "📝"}, "last_edited_by": {"object": "user", "id": "u-1"},
             "properties": {
                 "Tags": {"type": "multi_select", "multi_select": []},
                 "Задача": {"type": "title", "title": [
                     {"plain_text": "План "}, {"plain_text": " релиза"}]}},
             "url": "https://www.notion.so/Plan-2"},
            {"object": "database", "id": "db-1", "last_edited_time": "2026-10-18T09:00:00Z",
             "title": [{"plain_text": "Задачи"}], "icon": {"type": "external", "external": {}},
             "url": "https://evil.example/x"},
            {"object": "page", "id": "p-empty", "last_edited_time": "2026-10-18T07:00:00.000Z",
             "properties": {"title": {"type": "title", "title": []}}},
            {"object": "page", "id": "p-trash", "last_edited_time": "2026-10-18T10:00:00.000Z",
             "in_trash": true, "properties": {}},
            {"object": "page", "id": "p-new", "last_edited_time": "2026-10-18T09:30:00.000Z",
             "properties": {}},
            {"object": "user", "id": "u"},
            {"object": "page", "id": "no-time"}
        ]})
    }

    #[test]
    fn newest_pages_first() {
        let p = newest(parse_pages(&results()));
        let rows: Vec<_> = p
            .iter()
            .map(|x| (x.id.as_str(), x.title.as_deref(), x.kind))
            .collect();
        assert_eq!(
            rows,
            [
                ("p-new", Some("План релиза"), "page"),
                ("db-1", Some("Задачи"), "database"),
                ("p-empty", None, "page"),
                ("p-old", Some("Старое"), "page"),
            ]
        );
        assert_eq!(p[0].emoji.as_deref(), Some("📝"));
        assert_eq!(p[0].by.as_deref(), Some("u-1"));
        assert_eq!(p[1].by, None);
        assert_eq!(p[1].emoji, None);
        assert_eq!(p[0].edited, 1_792_315_800_000.0);
        // only notion.so pages are kept
        assert_eq!(p[0].url.as_deref(), Some("https://www.notion.so/Plan-2"));
        assert_eq!(p[1].url, None);
    }

    #[test]
    fn me_is_picked_or_the_only_person() {
        let v = json!({"results": [
            {"object": "user", "type": "person", "id": "u-1", "name": "Никита"},
            {"object": "user", "type": "bot", "id": "b-1", "name": "Almanac"},
            {"object": "user", "type": "person", "id": "u-2"}
        ]});
        let all = parse_people(&v);
        assert_eq!(
            all.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
            ["u-1", "u-2"]
        );
        let one = &all[..1];
        assert_eq!(resolve_me(None, one), Some("u-1".into()));
        assert_eq!(resolve_me(None, &all), None);
        assert_eq!(resolve_me(Some("u-2".into()), &all), Some("u-2".into()));
        // picked someone who left: unknown again
        assert_eq!(resolve_me(Some("u-9".into()), &all), None);
        // no "read users" capability: the pick stands
        assert_eq!(resolve_me(Some("u-9".into()), &[]), Some("u-9".into()));
    }

    #[test]
    fn wrong_shape_is_empty() {
        assert!(parse_pages(&json!({"object": "error", "code": "unauthorized"})).is_empty());
    }

    #[test]
    fn only_notion_pages_open() {
        assert!(safe_url("https://www.notion.so/Plan-2"));
        assert!(!safe_url("https://www.notion.so.evil.example/x"));
        assert!(!safe_url("https://www.notion.so/a b"));
        assert!(!safe_url("notion://x"));
    }

    /// Network: a made-up token must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_token_is_unauthorized() {
        assert!(matches!(
            workspace("secret_notarealtoken"),
            Err(Failure::Unauthorized)
        ));
    }
}
