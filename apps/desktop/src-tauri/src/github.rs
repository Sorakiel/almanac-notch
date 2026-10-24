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
    pub branch: String,
    /// "run" | "fail" | "ok" | "none" (no checks on the default branch head)
    pub state: &'static str,
    /// newest check start or finish, else the commit time, epoch ms (the newest repo wins the card)
    pub at: f64,
    /// last push to the repository, epoch ms (shown in the settings list)
    pub pushed: f64,
    pub done: u32,
    pub total: u32,
    /// name of the first failed check
    pub failed: Option<String>,
    /// "owner/name": the links and the re-run need it
    pub full: String,
    /// the head commit: short sha and its message's first line
    pub sha: String,
    pub title: String,
    /// the failed check's page (else the commit's checks); opened by the card's button
    pub url: String,
    /// the failed check's Actions workflow run, which "re-run failed jobs" takes; None for
    /// checks that are not Actions (an external CI cannot be re-run from here)
    pub run_id: Option<u64>,
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
    /// the open PRs that wait for my review, newest first (the card's list, stage 10)
    pub review: Vec<Pr>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Pr {
    /// short repository name and "owner/name"
    pub repo: String,
    pub full: String,
    pub number: u64,
    pub title: String,
    pub author: Option<String>,
    /// opened, epoch ms
    pub created: f64,
    /// the PR's page; only https://github.com/ links are kept
    pub url: String,
    pub draft: bool,
}

/// The PRs of the review search; anything without a GitHub link is left out.
fn parse_review(v: &Value) -> Vec<Pr> {
    v["data"]["prs"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| {
            let url = n["url"]
                .as_str()
                .filter(|u| u.starts_with("https://github.com/"))?;
            let full = n["repository"]["nameWithOwner"].as_str()?.to_owned();
            Some(Pr {
                repo: full.rsplit('/').next().unwrap_or(&full).to_owned(),
                full,
                number: n["number"].as_u64()?,
                title: n["title"]
                    .as_str()
                    .unwrap_or("")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
                author: n["author"]["login"].as_str().map(str::to_owned),
                created: n["createdAt"].as_str().and_then(parse_time).unwrap_or(0.0),
                url: url.to_owned(),
                draft: n["isDraft"].as_bool().unwrap_or(false),
            })
        })
        .collect()
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
            review: Vec::new(),
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

/// Step 1: my branches (commit time, author) of the freshest repositories, my commits of 7 days
/// on each default branch, the PRs waiting for me. No checks yet: that is step 2, only for the
/// few branches that matter.
const QUERY: &str = "query($since: GitTimestamp!, $author: ID) {
  viewer { login id
    repositories(first: 30, orderBy: {field: PUSHED_AT, direction: DESC}, isArchived: false,
                 ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
      totalCount
      nodes {
        nameWithOwner
        pushedAt
        defaultBranchRef { name target { ... on Commit {
          history(since: $since, first: 100, author: {id: $author}) { nodes { committedDate } }
        } } }
        refs(refPrefix: \"refs/heads/\", first: 100) { nodes { name target { ... on Commit {
          id committedDate author { user { id } } committer { user { id } }
        } } } }
      }
    }
  }
  prs: search(query: \"is:pr is:open review-requested:@me archived:false sort:created-desc\", type: ISSUE, first: 20) {
    issueCount
    nodes { ... on PullRequest { number title url isDraft createdAt author { login } repository { nameWithOwner } } }
  }
}";

/// Step 2: the checks of the chosen commits.
const ROLLUPS: &str = "query($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Commit {
    id oid messageHeadline
    statusCheckRollup { state contexts(first: 50) { totalCount nodes {
      __typename
      ... on CheckRun { name status conclusion startedAt completedAt detailsUrl
                        checkSuite { workflowRun { databaseId } } }
      ... on StatusContext { context state createdAt targetUrl }
    } } }
  } }
}";

/// Branches whose checks are read: the newest commits of mine across all repositories.
const BRANCHES: usize = 25;
/// At most this many branches of one repository are read.
const PER_REPO: usize = 3;
/// Of them, the ones with checks that the island keeps.
const WITH_CI: usize = 10;

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
    resp.body_mut()
        .read_json::<Value>()
        .map_err(|_| Failure::Net)
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
    let (mut out, picked) = parse_branches(&v, &id).ok_or(Failure::Net)?;
    if !picked.is_empty() {
        let ids: Vec<&str> = picked.iter().map(|c| c.id.as_str()).collect();
        let r = post(token, &json!({"query": ROLLUPS, "variables": {"ids": ids}}))?;
        out.repos = apply_rollups(&picked, &r);
    }
    Ok(out)
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

/// A branch head of mine whose checks are worth reading.
#[derive(Debug, PartialEq)]
struct Pick {
    /// commit node id
    id: String,
    repo: String,
    full: String,
    branch: String,
    committed: f64,
    pushed: f64,
}

/// Step 1 answer -> State without CI (auth "ok") and the newest branches of mine.
/// None = not the shape we expect.
fn parse_branches(v: &Value, me: &str) -> Option<(State, Vec<Pick>)> {
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
        review: parse_review(v),
    };
    let mut picks: Vec<Pick> = Vec::new();
    for r in repos["nodes"].as_array()? {
        let name = r["nameWithOwner"].as_str().unwrap_or("?");
        let short = name.rsplit('/').next().unwrap_or(name).to_owned();
        let pushed = r["pushedAt"].as_str().and_then(parse_time).unwrap_or(0.0);
        let default = r["defaultBranchRef"]["name"].as_str().unwrap_or("");
        for c in r["defaultBranchRef"]["target"]["history"]["nodes"]
            .as_array()
            .into_iter()
            .flatten()
        {
            if let Some(t) = c["committedDate"].as_str().and_then(parse_time) {
                out.commits.push(t);
            }
        }
        for b in r["refs"]["nodes"].as_array().into_iter().flatten() {
            let t = &b["target"];
            // a commit with an email GitHub cannot link to anyone (no user) is still the
            // owner's more often than not; another account's commit is not
            let mine = [&t["author"]["user"]["id"], &t["committer"]["user"]["id"]]
                .iter()
                .any(|u| u.as_str() == Some(me));
            let unlinked = t["author"]["user"].is_null();
            if !mine && !unlinked {
                continue;
            }
            let (Some(id), Some(at)) = (
                t["id"].as_str(),
                t["committedDate"].as_str().and_then(parse_time),
            ) else {
                continue;
            };
            let branch = b["name"].as_str().unwrap_or("?").to_owned();
            // a deploy branch is rewritten by a bot after every push: not my work
            if branch == "gh-pages" {
                continue;
            }
            // two branches at one commit are one CI: the default branch wins
            if let Some(p) = picks.iter_mut().find(|p| p.id == id) {
                if branch == default {
                    p.branch = branch;
                }
                continue;
            }
            picks.push(Pick {
                id: id.to_owned(),
                repo: short.clone(),
                full: name.to_owned(),
                branch,
                committed: at,
                pushed,
            });
        }
    }
    out.commits.sort_by(|a, b| a.total_cmp(b));
    picks.sort_by(|a, b| b.committed.total_cmp(&a.committed));
    // one busy repository must not take every slot
    let mut per_repo: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    picks.retain(|p| {
        let n = per_repo.entry(p.repo.clone()).or_insert(0);
        *n += 1;
        *n <= PER_REPO
    });
    picks.truncate(BRANCHES);
    Some((out, picks))
}

/// Step 2 answer -> one Repo per picked branch, newest check first.
fn apply_rollups(picks: &[Pick], v: &Value) -> Vec<Repo> {
    let nodes: Vec<&Value> = v["data"]["nodes"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let mut out: Vec<Repo> = Vec::new();
    for p in picks {
        let node = nodes
            .iter()
            .find(|n| n["id"].as_str() == Some(p.id.as_str()))
            .copied()
            .unwrap_or(&Value::Null);
        let roll = &node["statusCheckRollup"];
        let oid = node["oid"].as_str().unwrap_or("");
        let sha: String = oid.chars().take(7).collect();
        let title = node["messageHeadline"].as_str().unwrap_or("").to_owned();
        let commit_url = format!("https://github.com/{}/commit/{oid}", p.full);
        let state = match roll["state"].as_str() {
            Some("SUCCESS") => "ok",
            Some("FAILURE" | "ERROR") => "fail",
            Some("PENDING" | "EXPECTED") => "run",
            _ => {
                out.push(Repo {
                    name: p.repo.clone(),
                    branch: p.branch.clone(),
                    state: "none",
                    at: p.committed,
                    pushed: p.pushed,
                    done: 0,
                    total: 0,
                    failed: None,
                    full: p.full.clone(),
                    sha,
                    title,
                    url: commit_url,
                    run_id: None,
                });
                continue;
            }
        };
        let ctx: Vec<&Value> = roll["contexts"]["nodes"]
            .as_array()
            .map(|a| a.iter().collect())
            .unwrap_or_default();
        let total = roll["contexts"]["totalCount"]
            .as_u64()
            .unwrap_or(ctx.len() as u64) as u32;
        let done = (ctx.iter().filter(|c| is_done(c)).count() as u32).min(total);
        let bad = ctx.iter().find(|c| is_failed(c));
        let failed = bad.and_then(|c| {
            c["name"]
                .as_str()
                .or_else(|| c["context"].as_str())
                .map(str::to_owned)
        });
        // only GitHub's own pages: a status context's target can point anywhere
        let url = bad
            .and_then(|c| c["detailsUrl"].as_str().or_else(|| c["targetUrl"].as_str()))
            .filter(|u| u.starts_with("https://github.com/"))
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{commit_url}/checks"));
        let run_id = bad.and_then(|c| c["checkSuite"]["workflowRun"]["databaseId"].as_u64());
        // when the checks ran says more than when the commit was made (re-runs)
        let ran = ctx
            .iter()
            .flat_map(|c| ["completedAt", "startedAt", "createdAt"].map(|k| c[k].as_str()))
            .flatten()
            .filter_map(parse_time)
            .fold(0.0_f64, f64::max);
        out.push(Repo {
            name: p.repo.clone(),
            branch: p.branch.clone(),
            state,
            at: if ran > 0.0 { ran } else { p.committed },
            pushed: p.pushed,
            done,
            total,
            failed,
            full: p.full.clone(),
            sha,
            title,
            url,
            run_id,
        });
    }
    out.sort_by(|a, b| b.at.total_cmp(&a.at));
    // branches without checks only took a slot in the query; they are not shown
    out.retain(|r| r.state != "none");
    // one row per repository: its newest branch
    let mut seen = std::collections::HashSet::new();
    out.retain(|r| seen.insert(r.name.clone()));
    out.truncate(WITH_CI);
    out
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
            let next = match token().filter(|_| crate::modules::is_on("github")) {
                // no token, or the module is switched off: no requests
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
        return Err(crate::lang::t("Пустой токен", "Empty token").into());
    }
    let (login, _) = viewer(token).map_err(|e| match e {
        Failure::Unauthorized => crate::lang::t(
            "GitHub не принял токен - проверьте, что он скопирован целиком и не отозван",
            "GitHub rejected the token - check it was copied in full and hasn't been revoked",
        )
        .to_owned(),
        Failure::Net => crate::lang::t(
            "Нет связи с api.github.com - проверьте интернет и попробуйте ещё раз",
            "No connection to api.github.com - check the connection and try again",
        )
        .to_owned(),
    })?;
    entry().and_then(|e| e.set_password(token)).map_err(|_| {
        crate::lang::t(
            "Не удалось записать токен в Связку ключей. Разрешите доступ, если система спросит, и попробуйте ещё раз",
            "Cannot save the token to the system keychain. Allow access if the system asks, and try again",
        )
        .to_owned()
    })?;
    poke();
    Ok(login)
}

/// "Re-run failed jobs" of an Actions run. The token needs Actions: read and write.
pub fn rerun(full: &str, run_id: u64) -> Result<(), String> {
    let t = token().ok_or_else(|| {
        crate::lang::t("GitHub не подключён", "GitHub is not connected").to_owned()
    })?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into();
    let url =
        format!("https://api.github.com/repos/{full}/actions/runs/{run_id}/rerun-failed-jobs");
    let r = agent
        .post(&url)
        .header("Authorization", format!("Bearer {t}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "almanac-notch")
        .send_empty();
    match r {
        Ok(_) => {
            poke();
            Ok(())
        }
        Err(ureq::Error::StatusCode(403 | 404)) => Err(crate::lang::t(
            "Токену нужен доступ Actions: запись",
            "The token needs Actions: write access",
        )
        .to_owned()),
        Err(_) => Err(crate::lang::t("Нет связи с GitHub", "No connection to GitHub").to_owned()),
    }
}

/// Open a GitHub page in the browser.
/// A PR's "Одобрить": an approving review, as the owner asked for (2026-10-25); the island asks
/// for a second click first. `full` is "owner/name".
pub fn approve(full: &str, number: u64) -> Result<(), String> {
    let t = token().ok_or_else(|| {
        crate::lang::t("GitHub не подключён", "GitHub is not connected").to_owned()
    })?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .provider(ureq::tls::TlsProvider::NativeTls)
                .build(),
        )
        .build()
        .into();
    let url = format!("https://api.github.com/repos/{full}/pulls/{number}/reviews");
    let r = agent
        .post(&url)
        .header("Authorization", format!("Bearer {t}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "almanac-notch")
        .send_json(json!({"event": "APPROVE"}));
    match r {
        Ok(_) => {
            poke();
            Ok(())
        }
        Err(ureq::Error::StatusCode(403 | 404)) => Err(crate::lang::t(
            "Токену нужен доступ Pull requests: запись",
            "The token needs Pull requests: write access",
        )
        .to_owned()),
        Err(ureq::Error::StatusCode(422)) => Err(crate::lang::t(
            "GitHub не принял одобрение (свой PR?)",
            "GitHub refused the approval (your own PR?)",
        )
        .to_owned()),
        Err(_) => Err(crate::lang::t("Нет связи с GitHub", "No connection to GitHub").to_owned()),
    }
}

pub fn open(url: &str) {
    if !url.starts_with("https://github.com/") {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
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
    fn review_list_keeps_github_links_only() {
        let v = json!({"data": {"prs": {"issueCount": 3, "nodes": [
            {"number": 7, "title": "Fix   the\nrail", "url": "https://github.com/me/app/pull/7", "isDraft": false,
             "createdAt": "2026-10-20T10:00:00Z", "author": {"login": "ann"}, "repository": {"nameWithOwner": "me/app"}},
            {"number": 8, "title": "x", "url": "https://evil.example/pull/8", "repository": {"nameWithOwner": "me/app"}},
            {"number": 9, "title": "Draft", "url": "https://github.com/org/lib/pull/9", "isDraft": true,
             "author": null, "repository": {"nameWithOwner": "org/lib"}}
        ]}}});
        let r = parse_review(&v);
        assert_eq!(r.len(), 2);
        assert_eq!(
            (r[0].repo.as_str(), r[0].number, r[0].title.as_str()),
            ("app", 7, "Fix the rail")
        );
        assert_eq!(r[0].author.as_deref(), Some("ann"));
        assert!(r[0].created > 0.0);
        assert!(r[1].draft && r[1].author.is_none());
    }

    #[test]
    fn time_roundtrip() {
        let t = parse_time("2026-10-14T12:30:05Z").unwrap();
        assert_eq!(iso(t), "2026-10-14T12:30:05Z");
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(parse_time("2000-03-01T00:00:00Z"), Some(951_868_800_000.0));
    }

    fn branches() -> Value {
        json!({"data": {
            "viewer": {"login": "sora", "id": "U1", "repositories": {"totalCount": 3, "nodes": [
                {"nameWithOwner": "sora/almanac-app", "pushedAt": "2026-10-14T10:00:00Z",
                 "defaultBranchRef": {"name": "main", "target": {"history": {"nodes": [
                     {"committedDate": "2026-10-13T09:00:00Z"}, {"committedDate": "2026-10-14T10:00:00Z"}]}}},
                 "refs": {"nodes": [
                     {"name": "main", "target": {"id": "C1", "committedDate": "2026-10-10T10:00:00Z", "author": {"user": {"id": "U1"}}}},
                     {"name": "same-as-main", "target": {"id": "C1", "committedDate": "2026-10-10T10:00:00Z", "author": {"user": {"id": "U1"}}}},
                     {"name": "feat", "target": {"id": "C2", "committedDate": "2026-10-14T10:00:00Z", "author": {"user": {"id": "U1"}}}},
                     {"name": "gh-pages", "target": {"id": "C5", "committedDate": "2026-10-16T10:00:00Z", "author": {"user": {"id": "U1"}}}},
                     {"name": "theirs", "target": {"id": "C3", "committedDate": "2026-10-15T10:00:00Z", "author": {"user": {"id": "U2"}}}}
                 ]}},
                {"nameWithOwner": "sora/site", "pushedAt": "2026-10-12T10:00:00Z",
                 "defaultBranchRef": {"name": "main", "target": {"history": {"nodes": []}}},
                 "refs": {"nodes": [
                     {"name": "main", "target": {"id": "C4", "committedDate": "2026-10-12T10:00:00Z", "author": {"user": {"id": "U1"}}}}
                 ]}},
                {"nameWithOwner": "org/empty", "pushedAt": null, "defaultBranchRef": null, "refs": {"nodes": []}}
            ]}},
            "prs": {"issueCount": 2}
        }})
    }

    fn rollups() -> Value {
        json!({"data": {"nodes": [
            {"id": "C1", "statusCheckRollup": {"state": "SUCCESS", "contexts": {"totalCount": 1, "nodes": [
                {"__typename": "CheckRun", "name": "ci", "status": "COMPLETED", "conclusion": "SUCCESS",
                 "startedAt": "2026-10-10T10:01:00Z", "completedAt": "2026-10-10T10:05:00Z"}]}}},
            {"id": "C2", "oid": "abcdef1234567", "messageHeadline": "Fix the build", "statusCheckRollup": {"state": "FAILURE", "contexts": {"totalCount": 3, "nodes": [
                {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
                {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "FAILURE",
                 "completedAt": "2026-10-14T11:00:00Z",
                 "detailsUrl": "https://github.com/sora/almanac-app/actions/runs/77/job/9",
                 "checkSuite": {"workflowRun": {"databaseId": 77}}},
                {"__typename": "StatusContext", "context": "ci/x", "state": "PENDING"}]}}},
            {"id": "C4", "statusCheckRollup": null}
        ]}})
    }

    #[test]
    fn picks_my_newest_branches_and_reads_their_checks() {
        let (s, picks) = parse_branches(&branches(), "U1").unwrap();
        assert_eq!((s.auth, s.login.as_deref()), ("ok", Some("sora")));
        assert_eq!((s.repo_count, s.prs), (3, 2));
        // 7-day commits of the default branches, sorted
        assert_eq!(s.commits.len(), 2);
        assert!(s.commits[0] < s.commits[1]);
        // not the other author's branch; two branches at one commit count once, default name wins
        let names: Vec<_> = picks
            .iter()
            .map(|p| (p.repo.as_str(), p.branch.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("almanac-app", "feat"),
                ("site", "main"),
                ("almanac-app", "main")
            ]
        );
        assert!(picks.iter().all(|p| p.branch != "gh-pages"));

        let r = apply_rollups(&picks, &rollups());
        // newest check first: the failed build of the feature branch
        assert_eq!(
            (r[0].name.as_str(), r[0].branch.as_str(), r[0].state),
            ("almanac-app", "feat", "fail")
        );
        assert_eq!((r[0].done, r[0].total), (2, 3));
        assert_eq!(r[0].failed.as_deref(), Some("build"));
        assert_eq!(
            (r[0].sha.as_str(), r[0].title.as_str()),
            ("abcdef1", "Fix the build")
        );
        assert_eq!(r[0].full, "sora/almanac-app");
        assert_eq!(
            r[0].url,
            "https://github.com/sora/almanac-app/actions/runs/77/job/9"
        );
        assert_eq!(r[0].run_id, Some(77));
        // the time of the checks, not of the commit
        assert_eq!(iso(r[0].at), "2026-10-14T11:00:00Z");
        // a branch without checks is dropped
        assert!(r.iter().all(|x| x.name != "site"));
        // one row per repository: the feature branch hides the older main
        assert_eq!(r.len(), 1);
    }

    /// Network: a made-up token must come back as refused, not as "no connection".
    #[test]
    #[ignore]
    fn bogus_token_is_unauthorized() {
        assert!(matches!(
            viewer("ghp_notarealtoken"),
            Err(Failure::Unauthorized)
        ));
    }

    #[test]
    fn wrong_shape_is_none() {
        assert!(parse_branches(&json!({"errors": [{"message": "x"}]}), "U1").is_none());
    }
}
