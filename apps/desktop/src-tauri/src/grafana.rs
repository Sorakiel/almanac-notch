//! Grafana (stage 8): the alert rules firing or pending right now, and one dashboard the user
//! picked - a link to it and a small graph of one of its panels over the last hour.
//!
//! The address and the service account token live only in the system keychain (service
//! `dev.almanac.notch`), like the other tokens. A thread asks that address - and nothing else -
//! once a minute (and right after a change) and sends `island://grafana` when the result changed.
//! Only rule names, states and times, the dashboard's title and one panel's numbers leave this
//! module; the token never goes to the frontend or to a log. Without an address and a token, or
//! with the module switched off, nothing is requested.
//!
//! The picked dashboard and panel are not secret: `<app data>/grafana.json`.

use std::fs;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SERVICE: &str = "dev.almanac.notch";
const ACCOUNT_TOKEN: &str = "grafana-token";
const ACCOUNT_URL: &str = "grafana-url";
const PERIOD: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// points kept for the card's graph (one an hour's minute at most)
const MAX_POINTS: usize = 60;
/// panel types whose first query gives a line worth drawing
const GRAPH_PANELS: [&str; 5] = ["timeseries", "graph", "stat", "gauge", "bargauge"];

/// One alert rule that is not calm.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Alert {
    /// the rule's uid, or folder/group/name on Grafanas that do not send it
    pub id: String,
    pub name: String,
    /// "firing" | "pending"
    pub state: &'static str,
    /// the oldest active instance, epoch ms
    pub since: Option<f64>,
    /// the dashboard the rule is linked to (its uid)
    #[serde(skip)]
    pub board: Option<String>,
}

/// The picked dashboard as the card shows it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Board {
    pub uid: String,
    pub title: String,
    /// the picked panel's title; None = no panel picked or it is gone
    pub panel: Option<String>,
    /// the panel's unit ("percent", "bytes", "ms", ...), formatted by the frontend
    pub unit: Option<String>,
    /// the panel's first series over the last hour, oldest first; empty = nothing to draw
    pub points: Vec<f64>,
    /// rules linked to this dashboard that fire now
    pub firing: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    /// "off" no address or token | "ok" | "bad" the token was refused | "net" no answer (data kept)
    pub auth: &'static str,
    /// the organisation the token belongs to
    pub org: Option<String>,
    /// alert rules in all
    pub rules: u32,
    /// firing first, then pending; newest first within each
    pub alerts: Vec<Alert>,
    pub board: Option<Board>,
}

impl State {
    pub fn off() -> Self {
        State {
            auth: "off",
            org: None,
            rules: 0,
            alerts: Vec::new(),
            board: None,
        }
    }
}

// ---------- the picked dashboard ----------

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Pick {
    pub board: Option<String>,
    pub panel: Option<u64>,
}

fn cfg_path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("grafana.json")
}

pub fn pick() -> Pick {
    fs::read(cfg_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Pick>(&b).ok())
        .unwrap_or_default()
}

/// From the settings window: the dashboard and the panel to graph (None = none).
pub fn set_pick(p: Pick) -> Result<(), String> {
    if p.board.as_deref().is_some_and(|u| !safe_uid(u)) {
        return Err("uid".into());
    }
    fs::create_dir_all(almanac_hook::paths::app_dir()).map_err(|e| e.to_string())?;
    fs::write(
        cfg_path(),
        serde_json::to_string(&p).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    poke();
    Ok(())
}

/// Dashboard uids go into URL paths: Grafana's own alphabet only.
fn safe_uid(u: &str) -> bool {
    !u.is_empty()
        && u.len() <= 64
        && u.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

// ---------- the address ----------

/// Private and local hosts may speak plain http; anything else needs https, or the token would
/// cross the internet in the clear.
fn local_host(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']');
    if h == "localhost" || h == "::1" || h.ends_with(".local") || h.ends_with(".lan") {
        return true;
    }
    if h.ends_with(".home.arpa") || h.ends_with(".internal") {
        return true;
    }
    match h.parse::<std::net::Ipv4Addr>() {
        Ok(ip) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Err(_) => false,
    }
}

/// What the user typed -> "https://host[:port][/path]" without a trailing slash.
pub fn normalize(addr: &str) -> Result<String, &'static str> {
    let a = addr.trim().trim_end_matches('/');
    let (scheme, rest) = match a.split_once("://") {
        Some((s, r)) => (s.to_ascii_lowercase(), r),
        None => ("https".to_owned(), a),
    };
    if scheme != "https" && scheme != "http" {
        return Err(crate::lang::t(
            "Адрес должен начинаться с https://",
            "The address must start with https://",
        ));
    }
    let bad = |c: char| c.is_whitespace() || "@?#\"'\\<>`".contains(c);
    let host_port = rest.split('/').next().unwrap_or("");
    // "[::1]:3000" keeps its brackets; the port, when there is one, is digits
    let (host, port) = match host_port.find(']') {
        Some(i) if host_port.starts_with('[') => (&host_port[..=i], &host_port[i + 1..]),
        _ => match host_port.find(':') {
            Some(i) => (&host_port[..i], &host_port[i..]),
            None => (host_port, ""),
        },
    };
    let port_ok = port.is_empty()
        || (port.len() > 1
            && port[1..].chars().all(|c| c.is_ascii_digit())
            && port.starts_with(':'));
    if host.is_empty() || !port_ok || rest.chars().any(bad) || rest.contains("//") {
        return Err(crate::lang::t("Неверный адрес", "Invalid address"));
    }
    if scheme == "http" && !local_host(host) {
        return Err(crate::lang::t(
            "Для адреса в интернете нужен https://",
            "An internet address needs https://",
        ));
    }
    Ok(format!("{scheme}://{rest}"))
}

// ---------- keychain ----------

fn entry(account: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, account)
}

fn secret(account: &str) -> Option<String> {
    entry(account)
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.is_empty())
}

/// The saved address and token, both or nothing.
fn creds() -> Option<(String, String)> {
    let base = normalize(&secret(ACCOUNT_URL)?).ok()?;
    Some((base, secret(ACCOUNT_TOKEN)?))
}

/// For the settings window: the saved address (not secret, the token stays in the keychain).
pub fn address() -> Option<String> {
    secret(ACCOUNT_URL)
}

// ---------- reading ----------

#[derive(Debug)]
enum Failure {
    Unauthorized,
    /// 403: the token is real but lacks a permission
    Forbidden,
    Missing,
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
        ureq::Error::StatusCode(401) => Failure::Unauthorized,
        ureq::Error::StatusCode(403) => Failure::Forbidden,
        ureq::Error::StatusCode(404) => Failure::Missing,
        _ => Failure::Net,
    }
}

fn get(base: &str, token: &str, path: &str) -> Result<Value, Failure> {
    agent()
        .get(format!("{base}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "almanac-notch")
        .call()
        .map_err(failure)?
        .body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

fn post(base: &str, token: &str, path: &str, body: &Value) -> Result<Value, Failure> {
    agent()
        .post(format!("{base}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "almanac-notch")
        .send_json(body)
        .map_err(failure)?
        .body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

/// The organisation behind a token; Err = refused or unreachable (or not a Grafana).
fn org(base: &str, token: &str) -> Result<String, Failure> {
    // a Grafana with anonymous access answers /api/org for any token; /api/user never does
    match get(base, token, "/api/user") {
        Err(Failure::Unauthorized) => return Err(Failure::Unauthorized),
        Err(Failure::Net) => return Err(Failure::Net),
        _ => {}
    }
    let v = get(base, token, "/api/org").map_err(|e| match e {
        Failure::Forbidden => Failure::Unauthorized,
        e => e,
    })?;
    v["name"].as_str().map(str::to_owned).ok_or(Failure::Net)
}

fn epoch_ms(t: &Value) -> Option<f64> {
    let t = chrono::DateTime::parse_from_rfc3339(t.as_str()?).ok()?;
    // inactive instances carry Go's zero time
    (t.timestamp() > 946_684_800).then(|| t.timestamp_millis() as f64)
}

/// `/api/prometheus/grafana/api/v1/rules` -> (rules in all, the ones not calm).
fn parse_rules(v: &Value) -> (u32, Vec<Alert>) {
    let mut n = 0;
    let mut out = Vec::new();
    for g in v["data"]["groups"].as_array().into_iter().flatten() {
        for r in g["rules"].as_array().into_iter().flatten() {
            // recording rules have no state
            if r["type"].as_str().is_some_and(|t| t != "alerting") {
                continue;
            }
            n += 1;
            let state = match r["state"].as_str().map(str::to_ascii_lowercase).as_deref() {
                Some("firing" | "alerting") => "firing",
                Some("pending") => "pending",
                _ => continue,
            };
            let name = r["name"].as_str().unwrap_or("?").to_owned();
            let id = r["uid"].as_str().map(str::to_owned).unwrap_or_else(|| {
                format!(
                    "{}/{}/{}",
                    g["file"].as_str().unwrap_or(""),
                    g["name"].as_str().unwrap_or(""),
                    name
                )
            });
            let since = r["alerts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| epoch_ms(&a["activeAt"]))
                .reduce(f64::min)
                .or_else(|| epoch_ms(&r["activeAt"]));
            let board = r["annotations"]["__dashboardUid__"]
                .as_str()
                .map(str::to_owned);
            out.push(Alert {
                id,
                name,
                state,
                since,
                board,
            });
        }
    }
    out.sort_by(|a, b| {
        (a.state != "firing")
            .cmp(&(b.state != "firing"))
            .then(b.since.unwrap_or(0.0).total_cmp(&a.since.unwrap_or(0.0)))
    });
    (n, out)
}

fn rules(base: &str, token: &str) -> Result<(u32, Vec<Alert>), Failure> {
    match get(base, token, "/api/prometheus/grafana/api/v1/rules") {
        Ok(v) => Ok(parse_rules(&v)),
        // alerting switched off on that Grafana: no rules, not an error
        Err(Failure::Missing) => Ok((0, Vec::new())),
        Err(e) => Err(e),
    }
}

/// A dashboard's panels, rows' panels included.
fn panels(dash: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    for p in dash["panels"].as_array().into_iter().flatten() {
        out.push(p);
        for q in p["panels"].as_array().into_iter().flatten() {
            out.push(q);
        }
    }
    out
}

/// One panel the settings window offers.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PanelInfo {
    pub id: u64,
    pub title: String,
}

fn graph_panels(dash: &Value) -> Vec<PanelInfo> {
    panels(dash)
        .into_iter()
        .filter(|p| {
            p["type"]
                .as_str()
                .is_some_and(|t| GRAPH_PANELS.contains(&t))
                && p["targets"].as_array().is_some_and(|t| !t.is_empty())
        })
        .filter_map(|p| {
            Some(PanelInfo {
                id: p["id"].as_u64()?,
                title: p["title"].as_str().unwrap_or("").to_owned(),
            })
        })
        .collect()
}

/// A datasource as a panel names it: an object with a uid, a name, or a dashboard variable.
fn datasource(dash: &Value, ds: &Value) -> Option<Value> {
    let raw = match ds {
        Value::Object(o) => o.get("uid")?.as_str()?.to_owned(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let name = raw.trim_start_matches("${").trim_start_matches('$');
    let name = name.trim_end_matches('}');
    let resolved = if raw.starts_with('$') {
        // a datasource variable: its current value
        dash["templating"]["list"].as_array()?.iter().find(|v| {
            v["name"].as_str() == Some(name) && v["type"].as_str() == Some("datasource")
        })?["current"]["value"]
            .as_str()?
            .to_owned()
    } else {
        raw
    };
    // Grafana's built-in sources (annotations, mixed, "dashboard") have nothing to graph alone
    if resolved.is_empty() || resolved.starts_with("--") || resolved == "grafana" {
        return None;
    }
    let mut out = json!({ "uid": resolved });
    if let Some(t) = ds["type"].as_str() {
        out["type"] = json!(t);
    }
    Some(out)
}

/// The `/api/ds/query` body for a panel's first visible query over the last hour.
fn panel_query(dash: &Value, panel: &Value) -> Option<Value> {
    let target = panel["targets"]
        .as_array()?
        .iter()
        .find(|t| t["hide"].as_bool() != Some(true))?;
    let ds = datasource(dash, &target["datasource"])
        .or_else(|| datasource(dash, &panel["datasource"]))?;
    let mut q = target.clone();
    q["datasource"] = ds;
    q["refId"] = json!(target["refId"].as_str().unwrap_or("A"));
    q["intervalMs"] = json!(60_000);
    q["maxDataPoints"] = json!(MAX_POINTS);
    Some(json!({ "queries": [q], "from": "now-1h", "to": "now" }))
}

/// `/api/ds/query` answer -> the first numeric series, at most MAX_POINTS, oldest first.
fn parse_points(v: &Value) -> Vec<f64> {
    let Some(results) = v["results"].as_object() else {
        return Vec::new();
    };
    for r in results.values() {
        for f in r["frames"].as_array().into_iter().flatten() {
            let fields = f["schema"]["fields"].as_array();
            let Some(i) = fields.and_then(|fs| fs.iter().position(|x| x["type"] == "number"))
            else {
                continue;
            };
            let pts: Vec<f64> = f["data"]["values"][i]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_f64)
                .filter(|x| x.is_finite())
                .collect();
            if pts.is_empty() {
                continue;
            }
            if pts.len() <= MAX_POINTS {
                return pts;
            }
            // keep the last point exact: stride back from it
            let step = pts.len() as f64 / MAX_POINTS as f64;
            let mut out: Vec<f64> = (0..MAX_POINTS)
                .map(|k| pts[pts.len() - 1 - (k as f64 * step) as usize])
                .collect();
            out.reverse();
            return out;
        }
    }
    Vec::new()
}

fn dashboard(base: &str, token: &str, uid: &str) -> Result<Value, Failure> {
    if !safe_uid(uid) {
        return Err(Failure::Missing);
    }
    get(base, token, &format!("/api/dashboards/uid/{uid}")).map(|v| v["dashboard"].clone())
}

fn board(base: &str, token: &str, p: &Pick, alerts: &[Alert]) -> Option<Board> {
    let uid = p.board.as_deref()?;
    let dash = dashboard(base, token, uid).ok()?;
    let panel = p.panel.and_then(|id| {
        panels(&dash)
            .into_iter()
            .find(|x| x["id"].as_u64() == Some(id))
    });
    let points = panel
        .and_then(|x| panel_query(&dash, x))
        .and_then(|q| post(base, token, "/api/ds/query", &q).ok())
        .map(|v| parse_points(&v))
        .unwrap_or_default();
    Some(Board {
        uid: uid.to_owned(),
        title: dash["title"].as_str().unwrap_or("?").to_owned(),
        panel: panel.and_then(|x| x["title"].as_str()).map(str::to_owned),
        unit: panel
            .and_then(|x| x["fieldConfig"]["defaults"]["unit"].as_str())
            .filter(|u| !u.is_empty())
            .map(str::to_owned),
        points,
        firing: alerts
            .iter()
            .filter(|a| a.state == "firing" && a.board.as_deref() == Some(uid))
            .count() as u32,
    })
}

fn fetch(base: &str, token: &str) -> Result<State, Failure> {
    let org = org(base, token)?;
    let (rules, alerts) = rules(base, token)?;
    let board = board(base, token, &pick(), &alerts);
    Ok(State {
        auth: "ok",
        org: Some(org),
        rules,
        alerts,
        board,
    })
}

/// One dashboard the settings window offers.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct BoardInfo {
    pub uid: String,
    pub title: String,
    pub folder: Option<String>,
}

fn parse_boards(v: &Value) -> Vec<BoardInfo> {
    v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| {
            let uid = d["uid"].as_str().filter(|u| safe_uid(u))?;
            Some(BoardInfo {
                uid: uid.to_owned(),
                title: d["title"].as_str().unwrap_or("?").to_owned(),
                folder: d["folderTitle"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

fn offline() -> String {
    crate::lang::t(
        "Нет связи с Grafana по этому адресу",
        "No connection to Grafana at this address",
    )
    .to_owned()
}

/// Settings: the dashboards the token can see.
pub fn dashboards() -> Result<Vec<BoardInfo>, String> {
    let (base, token) = creds().ok_or_else(offline)?;
    get(&base, &token, "/api/search?type=dash-db&limit=200")
        .map(|v| parse_boards(&v))
        .map_err(|_| offline())
}

/// Settings: a dashboard's panels that can be graphed.
pub fn dashboard_panels(uid: &str) -> Result<Vec<PanelInfo>, String> {
    let (base, token) = creds().ok_or_else(offline)?;
    dashboard(&base, &token, uid)
        .map(|d| graph_panels(&d))
        .map_err(|_| offline())
}

/// Open the alert list ("alerts") or the picked dashboard ("board") on the saved address.
pub fn open(what: &str) {
    let Some(base) = secret(ACCOUNT_URL).and_then(|a| normalize(&a).ok()) else {
        return;
    };
    let url = match what {
        "alerts" => format!("{base}/alerting/list"),
        "board" => match pick().board.filter(|u| safe_uid(u)) {
            Some(uid) => format!("{base}/d/{uid}"),
            None => return,
        },
        _ => return,
    };
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
}

// ---------- worker ----------

static POKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

/// Read again now: address, token or pick changed, the module was switched.
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
            let next = match creds().filter(|_| crate::modules::is_on("grafana")) {
                // no address or token, or the module is switched off: no requests
                None => {
                    wait = PERIOD;
                    State::off()
                }
                Some((base, token)) => match fetch(&base, &token) {
                    Ok(s) => {
                        wait = PERIOD;
                        s
                    }
                    Err(Failure::Unauthorized | Failure::Forbidden) => {
                        wait = MAX_BACKOFF;
                        State {
                            auth: "bad",
                            ..State::off()
                        }
                    }
                    Err(Failure::Net | Failure::Missing) => {
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

/// Check the address and token against Grafana, then keep both in the keychain. Returns the
/// organisation's name.
pub fn connect(addr: &str, token: &str) -> Result<String, String> {
    let base = normalize(addr).map_err(str::to_owned)?;
    let token = token.trim();
    if token.is_empty() {
        return Err(crate::lang::t("Пустой токен", "Empty token").into());
    }
    let name = org(&base, token).map_err(|e| match e {
        Failure::Unauthorized | Failure::Forbidden => {
            crate::lang::t("Grafana не приняла токен", "Grafana rejected the token").to_owned()
        }
        Failure::Missing | Failure::Net => offline(),
    })?;
    entry(ACCOUNT_URL)
        .and_then(|e| e.set_password(&base))
        .and_then(|_| entry(ACCOUNT_TOKEN))
        .and_then(|e| e.set_password(token))
        .map_err(|_| {
            crate::lang::t(
                "Не удалось записать токен в Связку ключей",
                "Cannot save the token to the system keychain",
            )
            .to_owned()
        })?;
    poke();
    Ok(name)
}

pub fn disconnect() {
    for a in [ACCOUNT_TOKEN, ACCOUNT_URL] {
        if let Ok(e) = entry(a) {
            let _ = e.delete_credential();
        }
    }
    let _ = fs::remove_file(cfg_path());
    poke();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_is_checked() {
        assert_eq!(
            normalize(" grafana.example.com/ ").as_deref(),
            Ok("https://grafana.example.com")
        );
        assert_eq!(
            normalize("https://example.com/grafana/").as_deref(),
            Ok("https://example.com/grafana")
        );
        assert_eq!(
            normalize("http://localhost:3000").as_deref(),
            Ok("http://localhost:3000")
        );
        assert!(normalize("http://192.168.1.5:3000").is_ok());
        assert!(normalize("http://172.20.0.1").is_ok());
        assert!(normalize("http://grafana.local").is_ok());
        assert!(normalize("HTTPS://x.grafana.net").is_ok());
        // the token would cross the internet in the clear
        assert!(normalize("http://grafana.example.com").is_err());
        assert!(normalize("http://172.40.0.1").is_err());
        assert!(normalize("ftp://x").is_err());
        assert!(normalize("").is_err());
        assert!(normalize("https://user@evil.example").is_err());
        assert!(normalize("https://x?y").is_err());
        assert!(normalize("https://x:port").is_err());
        assert!(normalize("https://x//y").is_err());
    }

    fn rules_answer() -> Value {
        json!({"status": "success", "data": {"groups": [
            {"name": "api", "file": "Prod", "rules": [
                {"name": "CPU > 90%", "uid": "r-cpu", "type": "alerting", "state": "firing",
                 "annotations": {"__dashboardUid__": "d-api"},
                 "alerts": [
                    {"state": "Alerting", "activeAt": "2026-10-18T09:00:00Z"},
                    {"state": "Alerting", "activeAt": "2026-10-18T08:50:00Z"}]},
                {"name": "5xx", "type": "alerting", "state": "firing",
                 "alerts": [{"state": "Alerting", "activeAt": "2026-10-18T09:30:00Z"}]},
                {"name": "Disk", "uid": "r-disk", "type": "alerting", "state": "pending",
                 "alerts": [{"state": "Pending", "activeAt": "2026-10-18T09:40:00Z"}]},
                {"name": "Calm", "uid": "r-ok", "type": "alerting", "state": "inactive",
                 "alerts": [{"state": "Normal", "activeAt": "0001-01-01T00:00:00Z"}]},
                {"name": "rec", "type": "recording", "health": "ok"}
            ]}
        ]}})
    }

    #[test]
    fn firing_first_then_pending() {
        let (n, a) = parse_rules(&rules_answer());
        assert_eq!(n, 4);
        let rows: Vec<_> = a.iter().map(|x| (x.id.as_str(), x.state)).collect();
        assert_eq!(
            rows,
            [
                ("Prod/api/5xx", "firing"),
                ("r-cpu", "firing"),
                ("r-disk", "pending")
            ]
        );
        // the oldest instance
        assert_eq!(a[1].since, Some(1_792_313_400_000.0));
        assert_eq!(a[1].board.as_deref(), Some("d-api"));
        assert!(parse_rules(&json!({"status": "error"})).1.is_empty());
    }

    fn dash() -> Value {
        json!({"title": "API", "uid": "d-api",
        "templating": {"list": [
            {"name": "DS", "type": "datasource", "current": {"value": "prom-1"}}]},
        "panels": [
            {"id": 1, "type": "timeseries", "title": "RPS",
             "datasource": {"type": "prometheus", "uid": "${DS}"},
             "fieldConfig": {"defaults": {"unit": "reqps"}},
             "targets": [{"refId": "A", "hide": true, "expr": "x"},
                         {"refId": "B", "expr": "sum(rate(http_requests_total[5m]))"}]},
            {"id": 2, "type": "text", "title": "Notes"},
            {"id": 3, "type": "row", "title": "More", "panels": [
                {"id": 4, "type": "stat", "title": "Up", "datasource": "-- Grafana --",
                 "targets": [{"refId": "A"}]}]}
        ]})
    }

    #[test]
    fn panels_and_their_query() {
        let d = dash();
        assert_eq!(
            graph_panels(&d),
            [
                PanelInfo {
                    id: 1,
                    title: "RPS".into()
                },
                PanelInfo {
                    id: 4,
                    title: "Up".into()
                }
            ]
        );
        let ps = panels(&d);
        let q = panel_query(&d, ps[0]).unwrap();
        assert_eq!(q["queries"][0]["refId"], "B");
        assert_eq!(q["queries"][0]["datasource"]["uid"], "prom-1");
        assert_eq!(q["queries"][0]["datasource"]["type"], "prometheus");
        assert_eq!(q["from"], "now-1h");
        // Grafana's built-in source: nothing to graph
        assert!(panel_query(&d, ps[3]).is_none());
    }

    #[test]
    fn points_from_frames() {
        let v = json!({"results": {"B": {"frames": [
            {"schema": {"fields": [{"type": "time"}, {"type": "number"}]},
             "data": {"values": [[1, 2, 3], [1.5, null, 3.0]]}}]}}});
        assert_eq!(parse_points(&v), [1.5, 3.0]);
        let long: Vec<f64> = (0..240).map(f64::from).collect();
        let v = json!({"results": {"A": {"frames": [
            {"schema": {"fields": [{"type": "number"}]}, "data": {"values": [long]}}]}}});
        let p = parse_points(&v);
        assert_eq!(p.len(), MAX_POINTS);
        assert_eq!(p.last(), Some(&239.0));
        assert!(parse_points(&json!({"results": {"A": {"error": "bad"}}})).is_empty());
    }

    #[test]
    fn boards_list() {
        let v = json!([
            {"uid": "d-api", "title": "API", "folderTitle": "Prod", "type": "dash-db"},
            {"uid": "../x", "title": "Bad"}
        ]);
        assert_eq!(
            parse_boards(&v),
            [BoardInfo {
                uid: "d-api".into(),
                title: "API".into(),
                folder: Some("Prod".into())
            }]
        );
    }

    /// Network: a made-up token must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_token_is_unauthorized() {
        assert!(matches!(
            org("https://play.grafana.org", "glsa_notarealtoken_00000000"),
            Err(Failure::Unauthorized)
        ));
    }
}
