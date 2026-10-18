//! Almanac (stage 8e): today's habits from the user's own Almanac account, and a tap on the
//! island marks one done.
//!
//! The notch signs in to Almanac as the user - "Sign in with Almanac" in the browser (OAuth 2.1 with
//! PKCE and a loopback redirect, client `almanac-notch`, scopes habits:read habits:write; Almanac's
//! docs/API.md), or as a fallback with the password or a code from the sign-in email - and asks two functions of Almanac's integration API (for any client): `today_habits(p_date)` - today's
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
    /// signed in through "Sign in with Almanac": the refresh token belongs to the OAuth server
    #[serde(default)]
    oauth: bool,
}

fn config() -> Config {
    fs::read(cfg_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
        .unwrap_or_default()
}

fn save_config(c: &Config) {
    let _ = fs::create_dir_all(almanac_hook::paths::app_dir());
    if let Ok(s) = serde_json::to_string(c) {
        let _ = fs::write(cfg_path(), s);
    }
}

fn cfg_path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("almanac.json")
}

fn email() -> Option<String> {
    config().email
}

fn set_email(email: Option<String>) {
    save_config(&Config { email, ..config() });
}

fn set_oauth(oauth: bool) {
    save_config(&Config { oauth, ..config() });
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
    if let Some(m) = v["user"]["email"]
        .as_str()
        .or_else(|| v["account"]["email"].as_str())
    {
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
    let renewed = if config().oauth {
        oauth_post(
            "token",
            &[
                ("grant_type", "refresh_token"),
                ("client_id", CLIENT_ID),
                ("refresh_token", &refresh),
            ],
        )
    } else {
        auth_post(
            "token?grant_type=refresh_token",
            json!({ "refresh_token": refresh }),
        )
    };
    match renewed {
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
        // "Disconnect" in Almanac's connected apps: the app token is refused from now on
        Err(ureq::Error::StatusCode(403)) if config().oauth => {
            forget();
            return Err(Failure::Unauthorized);
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
    set_oauth(false);
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
    if config().oauth {
        if let Some(refresh) = refresh_token() {
            let _ = oauth_post("revoke", &[("client_id", CLIENT_ID), ("token", &refresh)]);
        }
    } else if let (Some((url, key)), Ok(token)) = (project(), access()) {
        let _ = agent()
            .post(format!("{url}/auth/v1/logout"))
            .header("apikey", key)
            .header("Authorization", format!("Bearer {token}"))
            .send_empty();
    }
    forget();
    save_config(&Config::default());
    poke();
}

// ---------- Sign in with Almanac (OAuth 2.1, PKCE, loopback redirect) ----------

const CLIENT_ID: &str = "almanac-notch";
const SCOPES: &str = "habits:read habits:write";
/// how long the browser has to come back
const BROWSER_WAIT: Duration = Duration::from_secs(300);
/// a newer sign-in attempt ends the waiting one
static ATTEMPT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// POST a form to Almanac's OAuth server (`<project>/functions/v1/oauth/<path>`).
fn oauth_post(path: &str, form: &[(&str, &str)]) -> Result<Value, Failure> {
    let (url, key) = project().ok_or(Failure::Net)?;
    agent()
        .post(format!("{url}/functions/v1/oauth/{path}"))
        .header("apikey", key)
        .header("User-Agent", "almanac-notch")
        .send_form(form.iter().copied())
        .map_err(failure)?
        .body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

fn b64url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_b64(n: usize) -> String {
    let mut b = vec![0u8; n];
    let _ = getrandom::fill(&mut b);
    b64url(&b)
}

/// RFC 7636: code_challenge = base64url(sha256(verifier))
fn challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    b64url(&Sha256::digest(verifier.as_bytes()))
}

/// Percent-encode everything but RFC 3986 unreserved characters.
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(v) => {
                    out.push(v);
                    i += 2;
                }
                Err(_) => out.push(b'%'),
            },
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn authorize_url(base: &str, redirect: &str, state: &str, challenge: &str) -> String {
    format!(
        "{base}/functions/v1/oauth/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        enc(CLIENT_ID),
        enc(redirect),
        enc(SCOPES),
        enc(challenge),
        enc(state)
    )
}

/// What came back to the loopback address.
#[derive(Debug, PartialEq)]
enum Callback {
    Code(String),
    Denied,
    Failed(String),
}

/// The request line's target (`/oauth/callback?code=...&state=...`) -> the answer, if it is
/// ours: the right path and our state.
fn parse_callback(target: &str, state: &str) -> Option<Callback> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/oauth/callback" {
        return None;
    }
    let get = |k: &str| {
        query
            .split('&')
            .filter_map(|kv| kv.split_once('='))
            .find(|(key, _)| *key == k)
            .map(|(_, v)| dec(v))
    };
    if get("state").as_deref() != Some(state) {
        return None;
    }
    Some(match (get("code"), get("error")) {
        (Some(code), None) if !code.is_empty() => Callback::Code(code),
        (_, Some(e)) if e == "access_denied" => Callback::Denied,
        (_, e) => Callback::Failed(
            get("error_description")
                .or(e)
                .unwrap_or_else(|| "invalid_request".into()),
        ),
    })
}

/// The page the browser shows after coming back: the island's look, the app's language.
fn callback_page(ok: bool) -> String {
    let (title, text) = if ok {
        (
            crate::lang::t("Готово", "Done"),
            crate::lang::t(
                "Almanac Notch вошёл в Almanac. Эту вкладку можно закрыть.",
                "Almanac Notch is signed in to Almanac. You can close this tab.",
            ),
        )
    } else {
        (
            crate::lang::t("Вход не выполнен", "Not signed in"),
            crate::lang::t(
                "Вернитесь в Almanac Notch и попробуйте ещё раз.",
                "Go back to Almanac Notch and try again.",
            ),
        )
    };
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Almanac Notch</title>\
<style>html,body{{height:100%;margin:0}}body{{display:grid;place-items:center;background:#070708;color:#f2f2f4;font:15px/1.5 -apple-system,system-ui,sans-serif}}\
main{{text-align:center;padding:24px}}h1{{margin:18px 0 6px;font-size:22px;font-weight:600}}p{{margin:0;color:rgba(255,255,255,.55)}}\
.m{{width:72px;height:66px;margin:auto;border-radius:46% 46% 44% 44%/52% 52% 48% 48%;background:#eeede8;position:relative}}\
.m i{{position:absolute;top:24px;width:9px;height:19px;border-radius:5px;background:#16171a}}.m i:first-child{{left:24px}}.m i:last-child{{right:24px}}</style>\
</head><body><main><div class=\"m\"><i></i><i></i></div><h1>{title}</h1><p>{text}</p></main></body></html>"
    )
}

/// Wait on the loopback listener for our callback; answer every request so the browser never hangs.
fn wait_callback(
    listener: &std::net::TcpListener,
    state: &str,
    attempt: u64,
) -> Result<Callback, String> {
    use std::io::{Read, Write};
    use std::sync::atomic::Ordering;
    let _ = listener.set_nonblocking(true);
    let deadline = Instant::now() + BROWSER_WAIT;
    loop {
        if ATTEMPT.load(Ordering::SeqCst) != attempt {
            return Err(crate::lang::t("Вход отменён", "Sign-in cancelled").into());
        }
        if Instant::now() > deadline {
            return Err(crate::lang::t(
                "Браузер не вернулся за 5 минут - попробуйте ещё раз",
                "The browser didn't come back in 5 minutes - try again",
            )
            .into());
        }
        let (mut conn, _) = match listener.accept() {
            Ok(c) => c,
            Err(_) => {
                thread::sleep(Duration::from_millis(100));
                continue;
            }
        };
        let _ = conn.set_nonblocking(false);
        let _ = conn.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 8192];
        let n = conn.read(&mut buf).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]);
        let target = head
            .lines()
            .next()
            .and_then(|l| l.strip_prefix("GET "))
            .and_then(|l| l.split(' ').next())
            .unwrap_or("");
        let got = parse_callback(target, state);
        let (status, body) = match &got {
            Some(Callback::Code(_)) => ("200 OK", callback_page(true)),
            Some(_) => ("200 OK", callback_page(false)),
            None => ("404 Not Found", String::new()),
        };
        let _ = conn.write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
        if let Some(c) = got {
            return Ok(c);
        }
    }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

/// "Sign in with Almanac": the browser shows Almanac's consent, the answer comes back to
/// 127.0.0.1, the code becomes this app's own session. Blocks until done (up to 5 minutes).
/// Returns the account's email.
pub fn sign_in_browser() -> Result<String, String> {
    let (base, _) = project().ok_or_else(no_build)?;
    let attempt = ATTEMPT.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/oauth/callback");
    let verifier = random_b64(32);
    let state = random_b64(24);
    open_browser(&authorize_url(
        base,
        &redirect,
        &state,
        &challenge(&verifier),
    ));
    let code = match wait_callback(&listener, &state, attempt)? {
        Callback::Code(c) => c,
        Callback::Denied => {
            return Err(crate::lang::t(
                "Доступ не разрешён в Almanac",
                "Access wasn't allowed in Almanac",
            )
            .into())
        }
        Callback::Failed(e) => {
            return Err(format!(
                "{}: {e}",
                crate::lang::t("Almanac отклонил вход", "Almanac refused the sign-in")
            ))
        }
    };
    drop(listener);
    let v = oauth_post(
        "token",
        &[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ],
    )
    .map_err(|e| match e {
        Failure::Net => net_text(),
        _ => crate::lang::t(
            "Код входа не подошёл или устарел - попробуйте ещё раз",
            "The sign-in code was refused or expired - try again",
        )
        .into(),
    })?;
    keep(&v).map_err(|_| {
        crate::lang::t(
            "Не удалось записать вход в Связку ключей",
            "Cannot save the sign-in to the system keychain",
        )
        .to_owned()
    })?;
    set_oauth(true);
    poke();
    Ok(email().unwrap_or_default())
}

/// The settings window's "Cancel": stop waiting for the browser.
pub fn cancel_browser() {
    ATTEMPT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
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
    #[test]
    fn pkce_challenge_matches_rfc7636() {
        // RFC 7636, appendix B
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let v = random_b64(32);
        assert_eq!(v.len(), 43);
        assert!(v
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn authorize_url_carries_pkce_and_loopback() {
        let u = authorize_url(
            "https://p.supabase.co",
            "http://127.0.0.1:5123/oauth/callback",
            "st",
            "ch",
        );
        assert!(u.starts_with("https://p.supabase.co/functions/v1/oauth/authorize?response_type=code&client_id=almanac-notch&"));
        assert!(u.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5123%2Foauth%2Fcallback"));
        assert!(u.contains("scope=habits%3Aread%20habits%3Awrite"));
        assert!(u.contains("code_challenge=ch&code_challenge_method=S256&state=st"));
    }

    #[test]
    fn callback_only_ours() {
        assert_eq!(
            parse_callback("/oauth/callback?code=abc&state=s1", "s1"),
            Some(Callback::Code("abc".into()))
        );
        assert_eq!(
            parse_callback("/oauth/callback?error=access_denied&state=s1", "s1"),
            Some(Callback::Denied)
        );
        assert_eq!(
            parse_callback(
                "/oauth/callback?error=invalid_scope&error_description=bad%20scope&state=s1",
                "s1"
            ),
            Some(Callback::Failed("bad scope".into()))
        );
        // someone else's state, another path, the favicon: not the answer
        assert_eq!(
            parse_callback("/oauth/callback?code=abc&state=zz", "s1"),
            None
        );
        assert_eq!(parse_callback("/favicon.ico", "s1"), None);
        assert_eq!(parse_callback("/oauth/callback?code=abc", "s1"), None);
    }

    /// Network, staging-built only: our client and redirect are accepted (no 400 page), a made-up
    /// code is refused as invalid_grant. `ALMANAC_URL=<staging> ALMANAC_KEY=<key> cargo test -- --ignored oauth_staging`
    #[test]
    #[ignore]
    fn oauth_staging() {
        let (base, _) = project().expect("build with ALMANAC_URL/ALMANAC_KEY");
        let r = agent()
            .get(authorize_url(
                base,
                "http://127.0.0.1:5123/oauth/callback",
                "teststate",
                &challenge(&random_b64(32)),
            ))
            .config()
            .max_redirects(0)
            .build()
            .call();
        let status = match r {
            Ok(r) => r.status().as_u16(),
            Err(ureq::Error::StatusCode(c)) => c,
            Err(e) => panic!("{e}"),
        };
        assert!((300..400).contains(&status), "authorize answered {status}");
        let e = oauth_post(
            "token",
            &[
                ("grant_type", "authorization_code"),
                ("client_id", CLIENT_ID),
                ("code", "made-up"),
                ("redirect_uri", "http://127.0.0.1:5123/oauth/callback"),
                ("code_verifier", &random_b64(32)),
            ],
        );
        assert!(matches!(e, Err(Failure::Bad(400))), "{e:?}");
    }
}
