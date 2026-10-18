//! Plan usage from Claude Code's local transcripts. No network.
//!
//! Claude Code writes a synthetic assistant message with `"error": "rate_limit"` when the plan
//! limit is hit ("You've hit your session limit · resets 7pm (Europe/Moscow)"). The newest
//! assistant message across recent transcripts tells whether a limit is in force: a normal
//! reply after it means the limit is over. The reset time is parsed on the frontend (Intl
//! knows the time zones). The plan name comes from ~/.claude.json (`organizationType`).

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, SystemTime};

use almanac_hook::paths;
use serde::Serialize;
use serde_json::Value;

/// Only transcripts touched this recently can hold the current state (5-hour window + slack).
const RECENT: Duration = Duration::from_secs(6 * 3600);
/// Tail of each transcript that is read.
const TAIL: u64 = 256 * 1024;
const SCAN_PERIOD: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Limit {
    /// ISO timestamp of the limit message
    pub at: String,
    /// its text, with the reset time
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Usage {
    pub limit: Option<Limit>,
    /// "Pro", "Max", ... or "" when unknown
    pub plan: String,
}

fn transcripts(root: &Path) -> Vec<PathBuf> {
    let now = SystemTime::now();
    let recent = |p: &Path| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age < RECENT)
    };
    let mut out = Vec::new();
    let Ok(projects) = fs::read_dir(root) else {
        return out;
    };
    for dir in projects.flatten() {
        let Ok(files) = fs::read_dir(dir.path()) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().is_some_and(|e| e == "jsonl") && recent(&p) {
                out.push(p);
            }
        }
    }
    out
}

fn tail(p: &Path) -> Option<String> {
    let mut f = File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// Newest assistant message (timestamp, limit if it is a rate-limit error) in a transcript tail.
fn newest_assistant(text: &str) -> Option<(String, Option<Limit>)> {
    // first line may be cut by the tail; it simply fails to parse
    for line in text.lines().rev() {
        if !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let at = v.get("timestamp").and_then(Value::as_str)?.to_string();
        let limited = v.get("error").and_then(Value::as_str) == Some("rate_limit");
        let limit = limited.then(|| {
            let text = v
                .pointer("/message/content")
                .and_then(Value::as_array)
                .map(|c| {
                    c.iter()
                        .filter_map(|x| x.get("text").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            Limit {
                at: at.clone(),
                text,
            }
        });
        return Some((at, limit));
    }
    None
}

pub fn plan_name(claude_json: &Path) -> String {
    let Ok(t) = fs::read_to_string(claude_json) else {
        return String::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(&t) else {
        return String::new();
    };
    let ty = v
        .pointer("/oauthAccount/organizationType")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = ty.strip_prefix("claude_").unwrap_or(ty);
    let mut c = name.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

pub fn scan(projects: &Path) -> Option<Limit> {
    transcripts(projects)
        .iter()
        .filter_map(|p| tail(p).and_then(|t| newest_assistant(&t)))
        // ISO-8601 UTC timestamps sort as strings
        .max_by(|a, b| a.0.cmp(&b.0))
        .and_then(|(_, limit)| limit)
}

fn claude_json() -> PathBuf {
    // ~/.claude.json sits next to ~/.claude (or inside CLAUDE_CONFIG_DIR when that is set)
    let dir = paths::claude_dir();
    if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() {
        dir.join(".claude.json")
    } else {
        dir.with_file_name(".claude.json")
    }
}

/// Scan every 20 s or when poked; call `publish` when the result changes.
pub fn watch(poke: Receiver<()>, publish: impl Fn(&Usage)) {
    let projects = paths::claude_dir().join("projects");
    let mut last: Option<Usage> = None;
    let mut plan = plan_name(&claude_json());
    let mut scans = 0u32;
    loop {
        scans += 1;
        if scans.is_multiple_of(30) {
            plan = plan_name(&claude_json());
        }
        let now = Usage {
            limit: scan(&projects),
            plan: plan.clone(),
        };
        if last.as_ref() != Some(&now) {
            publish(&now);
            last = Some(now);
        }
        match poke.recv_timeout(SCAN_PERIOD) {
            Ok(()) => {
                // the transcript line lands a moment after the Stop hook
                std::thread::sleep(Duration::from_millis(400));
                while poke.try_recv().is_ok() {}
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limit_then_reply() {
        let lim = r#"{"type":"assistant","timestamp":"2026-07-12T13:29:27.038Z","error":"rate_limit","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"You've hit your session limit · resets 7pm (Europe/Moscow)"}]}}"#;
        let ok = r#"{"type":"assistant","timestamp":"2026-07-12T16:01:00.000Z","message":{"content":[]}}"#;
        let (_, l) = newest_assistant(&format!("garbage\n{lim}\n")).unwrap();
        assert_eq!(
            l.unwrap().text,
            "You've hit your session limit · resets 7pm (Europe/Moscow)"
        );
        let (at, l) = newest_assistant(&format!("{lim}\n{ok}\n")).unwrap();
        assert!(l.is_none());
        assert_eq!(at, "2026-07-12T16:01:00.000Z");
    }

    #[test]
    fn plan_from_claude_json() {
        let p = std::env::temp_dir().join(format!("almanac-cj-{}.json", std::process::id()));
        fs::write(&p, r#"{"oauthAccount":{"organizationType":"claude_max"}}"#).unwrap();
        assert_eq!(plan_name(&p), "Max");
        fs::write(&p, "{}").unwrap();
        assert_eq!(plan_name(&p), "");
    }
}
