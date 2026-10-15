//! GitHub (stage 6): CI of the default branch, PRs waiting for my review, my commits of 7 days.
//!
//! The fine-grained token lives only in the system keychain (service `dev.almanac.notch`).
//! A thread asks `api.github.com/graphql` once a minute (and right after a token change) and
//! sends `island://github` when the result changed. Only repo names, check states, a PR count
//! and commit times leave this module; the token never goes to the frontend or to a log.
//! Without a token nothing is requested: the state is `{"auth":"off"}` and the module is empty.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

const SERVICE: &str = "dev.almanac.notch";
const ACCOUNT: &str = "github-token";
const ENDPOINT: &str = "https://api.github.com/graphql";
const PERIOD: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
const DAYS: i64 = 7;

/// CI of one repository's default branch head.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Repo {
    pub name: String,
    /// "run" | "fail" | "ok"
    pub state: &'static str,
    /// commit time, epoch ms (the newest repo wins the card)
    pub at: f64,
    pub done: u32,
    pub total: u32,
    /// name of the first failed check
    pub failed: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    /// "off" no token | "ok" | "bad" the token was refused | "net" no answer (data kept)
    pub auth: &'static str,
    pub login: Option<String>,
    /// repositories that have any CI
    pub repos: Vec<Repo>,
    /// repositories the token sees
    pub repo_count: u32,
    /// open PRs that wait for my review
    pub prs: u32,
    /// my commits of the last 7 days, epoch ms
    pub commits: Vec<f64>,
}

impl State {
    pub fn off() -> Self {
        State {
            auth: "off",
            login: None,
            repos: Vec::new(),
            repo_count: 0,
            prs: 0,
            commits: Vec::new(),
        }
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

const QUERY: &str = "query($since: GitTimestamp!, $author: ID) {
  viewer { login id
    repositories(first: 30, orderBy: {field: PUSHED_AT, direction: DESC}, isArchived: false,
                 ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
      totalCount
      nodes {
        nameWithOwner
        defaultBranchRef { target { ... on Commit {
          committedDate
          statusCheckRollup { state contexts(first: 50) { totalCount nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          } } }
          history(since: $since, first: 100, author: {id: $author}) { nodes { committedDate } }
        } } }
      }
    }
  }
  prs: search(query: \"is:pr is:open review-requested:@me archived:false\", type: ISSUE, first: 1) { issueCount }
}";

fn post(token: &str, body: &Value) -> Result<Value, Failure> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        // the system's TLS and trust store (SecureTransport, SChannel): no bundled roots
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into();
    let mut resp = agent
        .post(ENDPOINT)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "almanac-notch")
        .send_json(body)
        .map_err(|e| match e {
            ureq::Error::StatusCode(401) => Failure::Unauthorized,
            _ => Failure::Net,
        })?;
    resp.body_mut().read_json::<Value>().map_err(|_| Failure::Net)
}

/// The login behind a token; Err = refused or unreachable.
fn viewer(token: &str) -> Result<(String, String), Failure> {
    let v = post(token, &json!({"query": "{ viewer { login id } }"}))?;
    let u = &v["data"]["viewer"];
    match (u["login"].as_str(), u["id"].as_str()) {
        (Some(l), Some(i)) => Ok((l.to_owned(), i.to_owned())),
        _ => Err(Failure::Unauthorized),
    }
}

fn fetch(token: &str, now_ms: f64) -> Result<State, Failure> {
    let (_, id) = viewer(token)?;
    let since = iso(now_ms - (DAYS as f64) * 86_400_000.0);
    let v = post(
        token,
        &json!({"query": QUERY, "variables": {"since": since, "author": id}}),
    )?;
    parse(&v).ok_or(Failure::Net)
}

/// Seconds-precision UTC "2026-10-14T12:00:00Z" from epoch ms.
fn iso(ms: f64) -> String {
    let secs = (ms / 1000.0).floor() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // civil from days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Epoch ms from GitHub's "2026-10-14T12:00:00Z".
fn parse_time(t: &str) -> Option<f64> {
    let b = t.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |a: usize, z: usize| t.get(a..z)?.parse::<i64>().ok();
    let (y, m, d) = (n(0, 4)?, n(5, 7)?, n(8, 10)?);
    let (hh, mm, ss) = (n(11, 13)?, n(14, 16)?, n(17, 19)?);
    // days from civil
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + hh * 3600 + mm * 60 + ss) * 1000) as f64)
}

/// Check-run or status-context conclusions that make a commit red.
fn is_failed(c: &Value) -> bool {
    match c["__typename"].as_str() {
        Some("CheckRun") => matches!(
            c["conclusion"].as_str(),
            Some("FAILURE" | "TIMED_OUT" | "STARTUP_FAILURE" | "ACTION_REQUIRED" | "CANCELLED")
        ),
        _ => matches!(c["state"].as_str(), Some("FAILURE" | "ERROR")),
    }
}

fn is_done(c: &Value) -> bool {
    match c["__typename"].as_str() {
        Some("CheckRun") => c["status"].as_str() == Some("COMPLETED"),
        _ => !matches!(c["state"].as_str(), Some("PENDING" | "EXPECTED")),
    }
}

/// One GraphQL answer -> State (auth "ok"). None = not the shape we expect.
fn parse(v: &Value) -> Option<State> {
    let user = v["data"]["viewer"].as_object()?;
    let login = user.get("login")?.as_str()?.to_owned();
    let repos = user.get("repositories")?;
    let mut out = State {
        auth: "ok",
        login: Some(login),
        repos: Vec::new(),
        repo_count: repos["totalCount"].as_u64().unwrap_or(0) as u32,
        prs: v["data"]["prs"]["issueCount"].as_u64().unwrap_or(0) as u32,
        commits: Vec::new(),
    };
    for r in repos["nodes"].as_array()? {
        let head = &r["defaultBranchRef"]["target"];
        for c in head["history"]["nodes"].as_array().into_iter().flatten() {
            if let Some(t) = c["committedDate"].as_str().and_then(parse_time) {
                out.commits.push(t);
            }
        }
        let roll = &head["statusCheckRollup"];
        let state = match roll["state"].as_str() {
            Some("SUCCESS") => "ok",
            Some("FAILURE" | "ERROR") => "fail",
            Some("PENDING" | "EXPECTED") => "run",
            _ => continue,
        };
        let nodes: Vec<&Value> = roll["contexts"]["nodes"]
            .as_array()
            .map(|a| a.iter().collect())
            .unwrap_or_default();
        let total = roll["contexts"]["totalCount"]
            .as_u64()
            .unwrap_or(nodes.len() as u64) as u32;
        let done = (nodes.iter().filter(|c| is_done(c)).count() as u32).min(total);
        let failed = nodes.iter().find(|c| is_failed(c)).and_then(|c| {
            c["name"]
                .as_str()
                .or_else(|| c["context"].as_str())
                .map(str::to_owned)
        });
        let name = r["nameWithOwner"].as_str().unwrap_or("?");
        out.repos.push(Repo {
            // the owner is noise in a notch
            name: name.rsplit('/').next().unwrap_or(name).to_owned(),
            state,
            at: head["committedDate"]
                .as_str()
                .and_then(parse_time)
                .unwrap_or(0.0),
            done,
            total,
            failed,
        });
    }
    out.commits.sort_by(|a, b| a.total_cmp(b));
    Some(out)
}

// ---------- worker ----------

static POKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

/// Read again now: token changed, the settings window opened.
pub fn poke() {
    if let Some(tx) = POKE.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

pub fn start(emit: impl Fn(&State) + Send + 'static) {
    let (tx, rx) = channel::<()>();
    *POKE.lock().unwrap() = Some(tx);
    thread::spawn(move || {
        let mut last: Option<State> = None;
        let mut wait = PERIOD;
        loop {
            let next = match token() {
                None => {
                    wait = PERIOD;
                    State::off()
                }
                Some(t) => match fetch(&t, now_ms()) {
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
            // a poke (token set) or the period, whichever comes first
            match rx.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while rx.try_recv().is_ok() {}
        }
    });
}

/// Check the token against GitHub, then keep it in the keychain. Returns the login.
pub fn connect(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Пустой токен".into());
    }
    let (login, _) = viewer(token).map_err(|e| match e {
        Failure::Unauthorized => "GitHub не принял токен".to_owned(),
        Failure::Net => "Нет связи с api.github.com".to_owned(),
    })?;
    entry()
        .and_then(|e| e.set_password(token))
        .map_err(|_| "Не удалось записать токен в Связку ключей".to_owned())?;
    poke();
    Ok(login)
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

    #[test]
    fn time_roundtrip() {
        let t = parse_time("2026-10-14T12:30:05Z").unwrap();
        assert_eq!(iso(t), "2026-10-14T12:30:05Z");
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(parse_time("2000-03-01T00:00:00Z"), Some(951_868_800_000.0));
    }

    fn fixture() -> Value {
        json!({"data": {
            "viewer": {"login": "sora", "id": "U1", "repositories": {"totalCount": 3, "nodes": [
                {"nameWithOwner": "sora/almanac-notch", "defaultBranchRef": {"target": {
                    "committedDate": "2026-10-14T10:00:00Z",
                    "statusCheckRollup": {"state": "FAILURE", "contexts": {"totalCount": 3, "nodes": [
                        {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
                        {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "FAILURE"},
                        {"__typename": "StatusContext", "context": "ci/x", "state": "PENDING"}
                    ]}},
                    "history": {"nodes": [{"committedDate": "2026-10-13T09:00:00Z"}, {"committedDate": "2026-10-14T10:00:00Z"}]}
                }}},
                {"nameWithOwner": "sora/site", "defaultBranchRef": {"target": {
                    "committedDate": "2026-10-12T10:00:00Z",
                    "statusCheckRollup": null,
                    "history": {"nodes": []}
                }}},
                {"nameWithOwner": "org/empty", "defaultBranchRef": null}
            ]}},
            "prs": {"issueCount": 2}
        }})
    }

    #[test]
    fn parses_ci_prs_and_commits() {
        let s = parse(&fixture()).unwrap();
        assert_eq!(s.auth, "ok");
        assert_eq!(s.login.as_deref(), Some("sora"));
        assert_eq!((s.repo_count, s.prs), (3, 2));
        assert_eq!(s.commits.len(), 2);
        assert!(s.commits[0] < s.commits[1]);
        // only the repo with CI is listed
        assert_eq!(s.repos.len(), 1);
        let r = &s.repos[0];
        assert_eq!((r.name.as_str(), r.state), ("almanac-notch", "fail"));
        assert_eq!((r.done, r.total), (2, 3));
        assert_eq!(r.failed.as_deref(), Some("build"));
    }

    /// Network: a made-up token must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_token_is_unauthorized() {
        assert!(matches!(viewer("ghp_notarealtoken"), Err(Failure::Unauthorized)));
    }

    #[test]
    fn wrong_shape_is_none() {
        assert!(parse(&json!({"errors": [{"message": "x"}]})).is_none());
    }
}
