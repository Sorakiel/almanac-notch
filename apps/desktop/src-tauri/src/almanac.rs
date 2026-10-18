//! Almanac (stage 8e): today's habits from the user's own Almanac account, and a tap on the
//! island marks one done.
//!
//! The notch signs in to Almanac's Supabase project as the user (password, or a code from the
//! sign-in email) and asks two functions of Almanac's integration API (for any client): `today_habits(p_date)` - today's
//! habits counted the way Almanac counts them - and `toggle_habit(p_habit, p_date)` - one tap,
//! as in Almanac. The refresh token lives only in the system keychain (service
//! `dev.almanac.notch`), the access token only in memory; neither reaches the frontend or a log.
//! The address and the public (anon) key come from the build (`.env.almanac`, see build.rs).
//! A thread asks once a minute (and right after a sign-in or a tap) and sends `island://almanac`
//! when the result changed. Signed out, or with the module switched off, nothing is requested.

use std::fs;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SERVICE: &str = "dev.almanac.notch";
const ACCOUNT: &str = "almanac-refresh";
const PERIOD: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// renew the access token this long before it runs out
const EARLY: Duration = Duration::from_secs(60);

/// Almanac's project, from the build; None = this build has no Almanac.
fn project() -> Option<(&'static str, &'static str)> {
    let url = option_env!("ALMANAC_URL")?.trim_end_matches('/');
    let key = option_env!("ALMANAC_KEY")?;
    (url.starts_with("https://") && !key.is_empty()).then_some((url, key))
}

pub fn available() -> bool {
    project().is_some()
}

/// One of today's habits, in card order.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    /// taps today, taps that close the day ("3 of 8 glasses")
    pub count: i64,
    pub goal: i64,
    pub done: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    /// "off" signed out (or no Almanac in this build) | "ok" | "bad" the sign-in expired |
    /// "net" no answer (data kept)
    pub auth: &'static str,
    /// the account signed in
    pub email: Option<String>,
    /// the day the list is for, "2026-10-18"
    pub date: Option<String>,
    pub done: i64,
    pub total: i64,
    pub habits: Vec<Habit>,
}

impl State {
    pub fn off() -> Self {
        State {
            auth: "off",
            email: None,
            date: None,
            done: 0,
            total: 0,
            habits: Vec::new(),
        }
    }
}

// ---------- the account (not a secret: shown in settings) ----------

#[derive(Default, Serialize, Deserialize)]
struct Config {
    email: Option<String>,
}

fn cfg_path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("almanac.json")
}

fn email() -> Option<String> {
    fs::read(cfg_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
        .and_then(|c| c.email)
}

fn set_email(email: Option<String>) {
    let _ = fs::create_dir_all(almanac_hook::paths::app_dir());
    if let Ok(s) = serde_json::to_string(&Config { email }) {
        let _ = fs::write(cfg_path(), s);
    }
}

// ---------- keychain and session ----------

fn entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, ACCOUNT)
}

fn refresh_token() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

struct Session {
    access: String,
    until: Instant,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Debug)]
enum Failure {
    /// the sign-in is gone: refresh token refused, or no account any more
    Unauthorized,
    Net,
    /// an answer we cannot use (a missing function, a refused habit)
    Bad(u16),
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
        ureq::Error::StatusCode(401) => Failure::Unauthorized,
        ureq::Error::StatusCode(c) if c < 500 && c != 429 => Failure::Bad(c),
        _ => Failure::Net,
    }
}

/// POST to Supabase Auth with the public key; the answer as JSON.
fn auth_post(path: &str, body: Value) -> Result<Value, Failure> {
    let (url, key) = project().ok_or(Failure::Net)?;
    agent()
        .post(format!("{url}/auth/v1/{path}"))
        .header("apikey", key)
        .header("User-Agent", "almanac-notch")
        .send_json(body)
        .map_err(failure)?
        .body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

/// A token answer: keep the new refresh token (rotated on every use) and the access token.
fn keep(v: &Value) -> Result<(), Failure> {
    let (Some(access), Some(refresh)) = (v["access_token"].as_str(), v["refresh_token"].as_str())
    else {
        return Err(Failure::Bad(0));
    };
    let ttl = v["expires_in"].as_u64().unwrap_or(3600);
    entry()
        .and_then(|e| e.set_password(refresh))
        .map_err(|_| Failure::Bad(0))?;
    if let Some(m) = v["user"]["email"].as_str() {
        set_email(Some(m.to_owned()));
    }
    *SESSION.lock().unwrap() = Some(Session {
        access: access.to_owned(),
        until: Instant::now() + Duration::from_secs(ttl).saturating_sub(EARLY),
    });
    Ok(())
}

/// A valid access token: the one in memory, or a fresh one from the keychain's refresh token.
fn access() -> Result<String, Failure> {
    if let Some(s) = SESSION.lock().unwrap().as_ref() {
        if Instant::now() < s.until {
            return Ok(s.access.clone());
        }
    }
    let refresh = refresh_token().ok_or(Failure::Unauthorized)?;
    match auth_post(
        "token?grant_type=refresh_token",
        json!({ "refresh_token": refresh }),
    ) {
        Ok(v) => keep(&v)?,
        // a refused (or reused) refresh token: signed out for good
        Err(Failure::Bad(_)) | Err(Failure::Unauthorized) => {
            forget();
            return Err(Failure::Unauthorized);
        }
        Err(e) => return Err(e),
    }
    SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.access.clone())
        .ok_or(Failure::Unauthorized)
}

fn forget() {
    *SESSION.lock().unwrap() = None;
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}

// ---------- the two functions ----------

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn rpc(name: &str, body: Value) -> Result<Value, Failure> {
    let (url, key) = project().ok_or(Failure::Net)?;
    let token = access()?;
    let call = |token: &str| {
        agent()
            .post(format!("{url}/rest/v1/rpc/{name}"))
            .header("apikey", key)
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "almanac-notch")
            .send_json(body.clone())
    };
    let mut resp = match call(&token) {
        // the access token expired early (clock, revoked session): renew once
        Err(ureq::Error::StatusCode(401)) => {
            *SESSION.lock().unwrap() = None;
            call(&access()?).map_err(failure)?
        }
        r => r.map_err(failure)?,
    };
    resp.body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

/// `today_habits` / `toggle_habit` answer -> state. Unknown shapes give an empty day.
fn parse(v: &Value) -> State {
    let habits: Vec<Habit> = v["habits"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|h| {
            let goal = h["goal"].as_i64().unwrap_or(1).max(1);
            let count = h["count"].as_i64().unwrap_or(0).max(0);
            Some(Habit {
                id: h["id"].as_str()?.to_owned(),
                name: h["name"]
                    .as_str()?
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
                icon: h["icon"]
                    .as_str()
                    .filter(|e| !e.is_empty() && e.chars().count() <= 8)
                    .map(str::to_owned),
                count,
                goal,
                done: h["done"].as_bool().unwrap_or(count >= goal),
            })
        })
        .collect();
    let done = habits.iter().filter(|h| h.done).count() as i64;
    State {
        auth: "ok",
        email: email(),
        date: v["date"].as_str().map(str::to_owned),
        done: v["done"].as_i64().unwrap_or(done),
        total: v["total"].as_i64().unwrap_or(habits.len() as i64),
        habits,
    }
}

fn fetch() -> Result<State, Failure> {
    rpc("today_habits", json!({ "p_date": today() })).map(|v| parse(&v))
}

// ---------- worker ----------

static POKE: Mutex<Option<Sender<()>>> = Mutex::new(None);
type Emit = Box<dyn Fn(&State) + Send>;
/// the last state sent, shared by the worker and a tap
static LAST: Mutex<Option<State>> = Mutex::new(None);
static EMIT: Mutex<Option<Emit>> = Mutex::new(None);

fn send(next: State) {
    let mut last = LAST.lock().unwrap();
    if last.as_ref() != Some(&next) {
        if let Some(emit) = EMIT.lock().unwrap().as_ref() {
            emit(&next);
        }
        *last = Some(next);
    }
}

/// Read again now: signed in or out, the module was switched.
pub fn poke() {
    if let Some(tx) = POKE.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

pub fn start(emit: impl Fn(&State) + Send + 'static) {
    *EMIT.lock().unwrap() = Some(Box::new(emit));
    let (tx, rx) = channel::<()>();
    *POKE.lock().unwrap() = Some(tx);
    thread::spawn(move || {
        let mut wait = PERIOD;
        loop {
            let on = crate::modules::is_on("almanac") && available();
            let next = if !on || refresh_token().is_none() {
                // signed out, no Almanac in this build, or switched off: no requests
                wait = PERIOD;
                State::off()
            } else {
                match fetch() {
                    Ok(s) => {
                        wait = PERIOD;
                        s
                    }
                    Err(Failure::Unauthorized) => {
                        wait = PERIOD;
                        State {
                            auth: "bad",
                            email: email(),
                            ..State::off()
                        }
                    }
                    Err(Failure::Net) | Err(Failure::Bad(_)) => {
                        // also a missing function (an older Almanac): keep what we had
                        wait = (wait * 2).min(MAX_BACKOFF);
                        let last = LAST.lock().unwrap().clone();
                        State {
                            auth: "net",
                            email: email(),
                            ..last.unwrap_or_else(State::off)
                        }
                    }
                }
            };
            send(next);
            match rx.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while rx.try_recv().is_ok() {}
        }
    });
}

/// A tap on the island: mark (or clear) the habit for today in Almanac; the answer is the new
/// day, sent to the island at once.
pub fn toggle(id: &str) -> Result<(), String> {
    if !crate::modules::is_on("almanac") {
        return Err("off".into());
    }
    match rpc("toggle_habit", json!({ "p_habit": id, "p_date": today() })) {
        Ok(v) => {
            send(parse(&v));
            Ok(())
        }
        Err(e) => {
            // the island's optimistic tick is undone by the true state
            poke();
            Err(match e {
                Failure::Bad(code) => format!("HTTP {code}"),
                Failure::Unauthorized => "signed out".into(),
                Failure::Net => net_text(),
            })
        }
    }
}

// ---------- sign-in from the settings window ----------

fn net_text() -> String {
    crate::lang::t("Нет связи с Almanac", "No connection to Almanac").into()
}

/// Email and password. Returns the account's email.
pub fn sign_in(email: &str, password: &str) -> Result<String, String> {
    let email = email.trim();
    if project().is_none() {
        return Err(no_build());
    }
    if email.is_empty() || password.is_empty() {
        return Err(
            crate::lang::t("Введите почту и пароль", "Enter the email and password").into(),
        );
    }
    let v = auth_post(
        "token?grant_type=password",
        json!({ "email": email, "password": password }),
    )
    .map_err(|e| match e {
        Failure::Net => net_text(),
        _ => crate::lang::t(
            "Почта или пароль не подошли. Если входите в Almanac по ссылке из письма - войдите кодом",
            "Wrong email or password. If you sign in to Almanac with an email link, use a code",
        )
        .into(),
    })?;
    signed_in(&v)
}

/// Send a sign-in code to the email (only to an existing Almanac account).
pub fn send_code(email: &str) -> Result<(), String> {
    let email = email.trim();
    if project().is_none() {
        return Err(no_build());
    }
    if email.is_empty() {
        return Err(crate::lang::t("Введите почту", "Enter the email").into());
    }
    auth_post("otp", json!({ "email": email, "create_user": false }))
        .map(|_| ())
        .map_err(|e| match e {
            Failure::Net => net_text(),
            _ => crate::lang::t(
                "Не удалось отправить код. Проверьте почту или подождите минуту",
                "Could not send a code. Check the email or wait a minute",
            )
            .into(),
        })
}

/// The code from the email. Returns the account's email.
pub fn verify_code(email: &str, code: &str) -> Result<String, String> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    if code.is_empty() {
        return Err(
            crate::lang::t("Введите код из письма", "Enter the code from the email").into(),
        );
    }
    let v = auth_post(
        "verify",
        json!({ "type": "email", "email": email.trim(), "token": code }),
    )
    .map_err(|e| match e {
        Failure::Net => net_text(),
        _ => crate::lang::t("Код не подошёл или устарел", "The code is wrong or expired").into(),
    })?;
    signed_in(&v)
}

fn signed_in(v: &Value) -> Result<String, String> {
    keep(v).map_err(|_| {
        crate::lang::t(
            "Не удалось записать вход в Связку ключей",
            "Cannot save the sign-in to the system keychain",
        )
        .to_owned()
    })?;
    poke();
    Ok(email().unwrap_or_default())
}

fn no_build() -> String {
    crate::lang::t(
        "В этой сборке нет адреса Almanac",
        "This build has no Almanac address",
    )
    .into()
}

/// Sign out: the session ends on the server too (best effort), the keychain forgets it.
pub fn sign_out() {
    if let (Some((url, key)), Ok(token)) = (project(), access()) {
        let _ = agent()
            .post(format!("{url}/auth/v1/logout"))
            .header("apikey", key)
            .header("Authorization", format!("Bearer {token}"))
            .send_empty();
    }
    forget();
    set_email(None);
    poke();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_in_card_order() {
        let v = json!({"date": "2026-10-18", "done": 1, "total": 3, "habits": [
            {"id": "h-1", "name": "Вода  на\nкухне", "icon": "💧", "slot": "morning",
             "count": 3, "goal": 8, "done": false},
            {"id": "h-2", "name": "Зарядка", "icon": "", "slot": "anytime",
             "count": 0, "goal": 1, "done": false},
            {"id": "h-3", "name": "Книга", "icon": null, "count": 1, "goal": 1, "done": true},
            {"name": "без id"},
            {"id": "h-4"}
        ]});
        let s = parse(&v);
        assert_eq!(s.auth, "ok");
        assert_eq!(s.date.as_deref(), Some("2026-10-18"));
        assert_eq!((s.done, s.total), (1, 3));
        let rows: Vec<_> = s
            .habits
            .iter()
            .map(|h| (h.id.as_str(), h.name.as_str(), h.count, h.goal, h.done))
            .collect();
        assert_eq!(
            rows,
            [
                ("h-1", "Вода на кухне", 3, 8, false),
                ("h-2", "Зарядка", 0, 1, false),
                ("h-3", "Книга", 1, 1, true),
            ]
        );
        assert_eq!(s.habits[0].icon.as_deref(), Some("💧"));
        assert_eq!(s.habits[1].icon, None);
    }

    #[test]
    fn missing_counts_are_derived() {
        let s = parse(&json!({"habits": [
            {"id": "a", "name": "A", "count": 2, "goal": 2},
            {"id": "b", "name": "B", "goal": 0}
        ]}));
        assert!(s.habits[0].done);
        assert_eq!(s.habits[1].goal, 1);
        assert!(!s.habits[1].done);
        assert_eq!((s.done, s.total), (1, 2));
    }

    #[test]
    fn wrong_shape_is_an_empty_day() {
        let s = parse(&json!({"code": "PGRST202", "message": "not found"}));
        assert!(s.habits.is_empty());
        assert_eq!((s.done, s.total), (0, 0));
    }

    #[test]
    fn statuses_map_to_failures() {
        assert!(matches!(
            failure(ureq::Error::StatusCode(401)),
            Failure::Unauthorized
        ));
        assert!(matches!(
            failure(ureq::Error::StatusCode(404)),
            Failure::Bad(404)
        ));
        assert!(matches!(
            failure(ureq::Error::StatusCode(429)),
            Failure::Net
        ));
        assert!(matches!(
            failure(ureq::Error::StatusCode(503)),
            Failure::Net
        ));
    }

    /// Network: a made-up password must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_password_is_refused() {
        if project().is_none() {
            return;
        }
        let e = sign_in("nobody@example.invalid", "not-a-password").unwrap_err();
        assert_ne!(e, net_text());
    }
}
