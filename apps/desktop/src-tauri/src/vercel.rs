//! Vercel (stage 8): the latest deployments of my projects (the card shows three, like coucou).
//!
//! The token lives only in secrets.rs (a private file on the Mac, Credential Manager on Windows), like GitHub's.
//! A thread asks `api.vercel.com` once a minute (and right after a token change) and sends
//! `island://vercel` when the result changed. Only project names, deployment states, targets,
//! branches and times leave this module; the token never goes to the frontend or to a log.
//! Without a token, or with the module switched off, nothing is requested.

use std::collections::HashSet;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::lang;

const ACCOUNT: &str = "vercel-token";
const API: &str = "https://api.vercel.com";
const PERIOD: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(300);
/// deployments asked per scope (the personal account and each team)
const PER_SCOPE: u32 = 20;
/// teams read besides the personal account
const TEAMS: usize = 5;
/// deployments kept, newest first
const KEEP: usize = 12;

/// One deployment.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Deploy {
    pub id: String,
    pub project: String,
    /// "building" | "ready" | "error" | "canceled"
    pub state: &'static str,
    /// created, epoch ms
    pub created: f64,
    /// finished (ready or failed), epoch ms; None while building
    pub done: Option<f64>,
    /// "production" | "preview"
    pub target: &'static str,
    /// git branch, when the deployment came from git
    pub branch: Option<String>,
    /// the deployment's page on vercel.com (opened from the card's arrow)
    pub url: Option<String>,
    /// the commit's message, first line (stage 10: the deployment's own level)
    pub commit: Option<String>,
    /// the deployment's own host, "proj-abc.vercel.app": "Открыть сайт"
    pub site: Option<String>,
    /// the team it belongs to ('' the personal account): a redeploy is asked in its scope
    #[serde(skip)]
    pub team: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct State {
    /// "off" no token | "ok" | "bad" the token was refused | "net" no answer (data kept)
    pub auth: &'static str,
    pub user: Option<String>,
    /// newest first
    pub deploys: Vec<Deploy>,
}

impl State {
    pub fn off() -> Self {
        State {
            auth: "off",
            user: None,
            deploys: Vec::new(),
        }
    }
}

// ---------- secrets (secrets.rs) ----------

fn token() -> Option<String> {
    crate::secrets::get(ACCOUNT)
}

// ---------- reading ----------

enum Failure {
    Unauthorized,
    Net,
}

fn get(token: &str, path: &str) -> Result<Value, Failure> {
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
        .get(format!("{API}{path}"))
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "almanac-notch")
        .call()
        .map_err(|e| match e {
            // Vercel answers 403 to a revoked or made-up token
            ureq::Error::StatusCode(401 | 403) => Failure::Unauthorized,
            _ => Failure::Net,
        })?;
    resp.body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
}

/// The username behind a token; Err = refused or unreachable.
fn user(token: &str) -> Result<String, Failure> {
    let v = get(token, "/v2/user")?;
    let u = &v["user"];
    u["username"]
        .as_str()
        .or_else(|| u["email"].as_str())
        .map(str::to_owned)
        .ok_or(Failure::Unauthorized)
}

fn fetch(token: &str) -> Result<State, Failure> {
    let login = user(token)?;
    // the personal account, then the teams (a newer Hobby account is itself a team)
    let mut scopes: Vec<String> = vec![String::new()];
    if let Ok(t) = get(token, "/v2/teams?limit=20") {
        scopes.extend(team_ids(&t).into_iter().take(TEAMS));
    }
    let mut all: Vec<Deploy> = Vec::new();
    for (i, team) in scopes.iter().enumerate() {
        let q = if team.is_empty() {
            format!("/v6/deployments?limit={PER_SCOPE}")
        } else {
            format!("/v6/deployments?limit={PER_SCOPE}&teamId={team}")
        };
        match get(token, &q) {
            Ok(v) => all.extend(parse_deploys(&v, team)),
            // a team the token may not read is skipped; the personal scope must answer
            Err(e) if i == 0 => return Err(e),
            Err(_) => {}
        }
    }
    Ok(State {
        auth: "ok",
        user: Some(login),
        deploys: newest(all),
    })
}

fn team_ids(v: &Value) -> Vec<String> {
    v["teams"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t["id"].as_str())
        // ids go into a URL: only what Vercel's ids look like
        .filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .map(str::to_owned)
        .collect()
}

fn ms(v: &Value) -> Option<f64> {
    v.as_f64().filter(|t| *t > 0.0)
}

/// `/v6/deployments` answer -> deployments. Unknown shapes give an empty list.
fn parse_deploys(v: &Value, team: &str) -> Vec<Deploy> {
    let mut out = Vec::new();
    for d in v["deployments"].as_array().into_iter().flatten() {
        let (Some(id), Some(project), Some(created)) = (
            d["uid"].as_str(),
            d["name"].as_str(),
            ms(&d["created"]).or_else(|| ms(&d["createdAt"])),
        ) else {
            continue;
        };
        let raw = d["state"].as_str().or_else(|| d["readyState"].as_str());
        let state = match raw {
            Some("READY") => "ready",
            Some("ERROR") => "error",
            Some("CANCELED") => "canceled",
            Some("BUILDING" | "INITIALIZING" | "QUEUED") => "building",
            _ => continue,
        };
        let done = match state {
            "building" => None,
            _ => ms(&d["ready"]).or(Some(created)),
        };
        out.push(Deploy {
            id: id.to_owned(),
            project: project.to_owned(),
            state,
            created,
            done,
            target: if d["target"].as_str() == Some("production") {
                "production"
            } else {
                "preview"
            },
            branch: d["meta"]["githubCommitRef"]
                .as_str()
                .or_else(|| d["meta"]["gitlabCommitRef"].as_str())
                .or_else(|| d["meta"]["bitbucketCommitRef"].as_str())
                .map(str::to_owned),
            // only Vercel's own pages are ever opened
            url: d["inspectorUrl"]
                .as_str()
                .filter(|u| u.starts_with("https://vercel.com/"))
                .map(str::to_owned),
            commit: d["meta"]["githubCommitMessage"]
                .as_str()
                .or_else(|| d["meta"]["gitlabCommitMessage"].as_str())
                .or_else(|| d["meta"]["bitbucketCommitMessage"].as_str())
                .and_then(|m| m.lines().next())
                .map(|m| m.trim().chars().take(120).collect())
                .filter(|m: &String| !m.is_empty()),
            site: d["url"].as_str().filter(|h| host_ok(h)).map(str::to_owned),
            team: team.to_owned(),
        });
    }
    out
}

/// Newest first; a deployment seen in two scopes counts once.
fn newest(mut all: Vec<Deploy>) -> Vec<Deploy> {
    all.sort_by(|a, b| b.created.total_cmp(&a.created));
    let mut seen = HashSet::new();
    all.retain(|d| seen.insert(d.id.clone()));
    all.truncate(KEEP);
    all
}

/// A host name as Vercel gives a deployment: letters, digits, dots and dashes, nothing more.
fn host_ok(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.contains('.')
        && h.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// "Открыть сайт": the deployment itself.
pub fn open_site(host: &str) {
    if host_ok(host) {
        open_any(&format!("https://{host}"));
    }
}

/// "Повторить": a new deployment from this one's source, in its scope and to its target.
/// Vercel's own redeploy (POST /v13/deployments with deploymentId).
pub fn redeploy(d: &Deploy) -> Result<(), String> {
    let token = token()
        .ok_or_else(|| lang::t("Vercel не подключён", "Vercel is not connected").to_owned())?;
    let mut body = json!({"name": d.project, "deploymentId": d.id});
    if d.target == "production" {
        body["target"] = json!("production");
    }
    let q = if d.team.is_empty() {
        String::new()
    } else {
        format!("?teamId={}", d.team)
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into();
    match agent
        .post(format!("{API}/v13/deployments{q}"))
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "almanac-notch")
        .send_json(&body)
    {
        Ok(_) => {
            poke();
            Ok(())
        }
        Err(ureq::Error::StatusCode(401 | 403)) => Err(lang::t(
            "Токену не хватает прав на деплой",
            "The token may not deploy",
        )
        .to_owned()),
        Err(_) => Err(lang::t("Vercel не ответил", "Vercel did not answer").to_owned()),
    }
}

fn open_any(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

/// Open a deployment's page in the browser. The URL comes from Vercel's answer, checked above.
pub fn open(url: &str) {
    if !url.starts_with("https://vercel.com/") || url.chars().any(|c| c.is_whitespace() || c == '"')
    {
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
            let next = match token().filter(|_| crate::modules::is_on("vercel")) {
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

/// Check the token against Vercel, then keep it in secrets.rs. Returns the username.
pub fn connect(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err(crate::lang::t("Пустой токен", "Empty token").into());
    }
    let login = user(token).map_err(|e| match e {
        Failure::Unauthorized => crate::lang::t(
            "Vercel не принял токен - проверьте, что он скопирован целиком и не отозван",
            "Vercel rejected the token - check it was copied in full and hasn't been revoked",
        )
        .to_owned(),
        Failure::Net => crate::lang::t(
            "Нет связи с api.vercel.com - проверьте интернет и попробуйте ещё раз",
            "No connection to api.vercel.com - check the connection and try again",
        )
        .to_owned(),
    })?;
    crate::secrets::set(ACCOUNT, token).map_err(|_| {
        crate::lang::t(
            "Не удалось сохранить токен на этом компьютере, попробуйте ещё раз",
            "Cannot save the token on this computer, try again",
        )
        .to_owned()
    })?;
    poke();
    Ok(login)
}

pub fn disconnect() {
    crate::secrets::remove(ACCOUNT);
    poke();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_site_and_team_for_the_deployment_level() {
        let v = json!({"deployments": [
            {"uid": "d1", "name": "site", "state": "ERROR", "created": 1000.0, "url": "site-abc.vercel.app",
             "meta": {"githubCommitRef": "main", "githubCommitMessage": "Fix the hero\n\nlong body"}},
            {"uid": "d2", "name": "site", "state": "READY", "created": 900.0, "url": "evil.com/\"x"}
        ]});
        let d = parse_deploys(&v, "team_1");
        assert_eq!(d[0].commit.as_deref(), Some("Fix the hero"));
        assert_eq!(d[0].site.as_deref(), Some("site-abc.vercel.app"));
        assert_eq!(d[0].team, "team_1");
        assert_eq!(d[1].site, None);
        assert!(!host_ok("a b.com") && !host_ok("nodot") && host_ok("x-1.vercel.app"));
    }
    use serde_json::json;

    fn deployments() -> Value {
        json!({"deployments": [
            {"uid": "dpl_3", "name": "site", "created": 3000.0, "state": "BUILDING",
             "target": "production", "meta": {"githubCommitRef": "main"},
             "inspectorUrl": "https://vercel.com/me/site/dpl3"},
            {"uid": "dpl_3", "name": "site", "created": 3000.0, "state": "BUILDING",
             "inspectorUrl": "https://evil.example/x"},
            {"uid": "dpl_2", "name": "site", "created": 2000.0, "state": "READY", "ready": 2500.0,
             "target": "production", "meta": {"githubCommitRef": "main"}},
            {"uid": "dpl_1", "name": "app", "created": 1000.0, "readyState": "ERROR", "ready": 1200.0,
             "target": null, "meta": {"githubCommitRef": "feat-x"}},
            {"uid": "dpl_0", "name": "old", "created": 500.0, "state": "CANCELED", "meta": {}},
            {"uid": "dpl_9", "name": "weird", "created": 400.0, "state": "DELETED"},
            {"name": "broken"}
        ], "pagination": {}})
    }

    #[test]
    fn newest_deploys_first() {
        let d = newest(parse_deploys(&deployments(), ""));
        let rows: Vec<_> = d
            .iter()
            .map(|x| (x.project.as_str(), x.state, x.target, x.branch.as_deref()))
            .collect();
        assert_eq!(
            rows,
            [
                ("site", "building", "production", Some("main")),
                ("site", "ready", "production", Some("main")),
                ("app", "error", "preview", Some("feat-x")),
                ("old", "canceled", "preview", None),
            ]
        );
        // building has no finish time; a failed one finished when Vercel says so
        assert_eq!(d[0].done, None);
        assert_eq!(d[2].done, Some(1200.0));
        // canceled without "ready": the creation time
        assert_eq!(d[3].done, Some(500.0));
        // the same deployment twice counts once; only vercel.com pages are kept
        assert_eq!(d[0].url.as_deref(), Some("https://vercel.com/me/site/dpl3"));
        assert_eq!(d.iter().filter(|x| x.id == "dpl_3").count(), 1);
    }

    #[test]
    fn team_ids_are_url_safe() {
        let v = json!({"teams": [{"id": "team_abc123"}, {"id": "x&y=1"}, {"slug": "no-id"}]});
        assert_eq!(team_ids(&v), ["team_abc123"]);
    }

    #[test]
    fn wrong_shape_is_empty() {
        assert!(parse_deploys(&json!({"error": {"code": "forbidden"}}), "").is_empty());
    }

    /// Network: a made-up token must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_token_is_unauthorized() {
        assert!(matches!(user("notarealtoken"), Err(Failure::Unauthorized)));
    }
}
