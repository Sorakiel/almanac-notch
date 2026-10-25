//! Adds our hooks to Claude Code's settings.json and removes them again.
//!
//! Other hooks (other apps, the user's own) are kept as they are. Ours are recognised by the
//! hook client's file name in the command. Nothing is written without a plan: the caller
//! shows `Plan::diff`, and `apply` makes a backup and writes atomically, refusing if the
//! file changed since the plan was made.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

use crate::HOLD_MAX_SECS;

/// Marker of our entries in a hook command.
const MARK: &str = "almanac-hook";

/// Slack over the app's own limit, so the app always releases a held prompt before Claude Code
/// kills the hook.
const HOLD_SLACK: u64 = 60;

/// (event, timeout in seconds). Answering hooks wait for the island: 30 s a question while it
/// is visible, up to HOLD_MAX_SECS while a full-screen app hides it. The rest return in
/// milliseconds and get a short cap in case the app hangs.
pub const EVENTS: [(&str, u64); 9] = [
    ("UserPromptSubmit", 10),
    // a held AskUserQuestion
    ("PreToolUse", HOLD_MAX_SECS + HOLD_SLACK),
    ("PermissionRequest", HOLD_MAX_SECS + HOLD_SLACK),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SessionEnd", 10),
];

#[derive(Debug, Clone)]
pub struct Plan {
    pub path: PathBuf,
    pub before: String,
    pub after: String,
    /// Unified-style line diff, empty when nothing changes.
    pub diff: String,
}

impl Plan {
    pub fn changed(&self) -> bool {
        self.before != self.after
    }
}

fn is_ours(hook: &Value) -> bool {
    hook.get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(MARK))
}

fn read(path: &Path) -> Result<(String, Map<String, Value>), String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("не читается {}: {e}", path.display())),
    };
    if text.trim().is_empty() {
        return Ok((text, Map::new()));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Ok((text, m)),
        Ok(_) => Err(format!("{}: ожидался объект JSON", path.display())),
        Err(e) => Err(format!(
            "{}: JSON не разбирается ({e}), файл не изменён",
            path.display()
        )),
    }
}

/// Drop our hook commands everywhere; matcher groups left empty are dropped too,
/// events left empty are removed, and an empty "hooks" object is removed.
fn strip_ours(root: &mut Map<String, Value>) {
    let Some(Value::Object(hooks)) = root.get_mut("hooks") else {
        return;
    };
    for groups in hooks.values_mut() {
        if let Value::Array(groups) = groups {
            for g in groups.iter_mut() {
                if let Some(Value::Array(list)) = g.get_mut("hooks") {
                    list.retain(|h| !is_ours(h));
                }
            }
            groups.retain(|g| {
                g.get("hooks")
                    .and_then(Value::as_array)
                    .is_none_or(|l| !l.is_empty())
            });
        }
    }
    hooks.retain(|_, v| v.as_array().is_none_or(|a| !a.is_empty()));
    if hooks.is_empty() {
        root.remove("hooks");
    }
}

fn render(root: &Map<String, Value>, like: &str) -> String {
    let mut s = serde_json::to_string_pretty(root).unwrap_or_default();
    if like.is_empty() || like.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// Settings with our hooks (re)added for the hook client at `hook`.
pub fn plan_install(path: &Path, hook: &Path) -> Result<Plan, String> {
    let (before, mut root) = read(path)?;
    strip_ours(&mut root);
    let command = format!("\"{}\"", hook.display());
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(hooks) = hooks else {
        return Err("\"hooks\" в settings.json не объект, файл не изменён".into());
    };
    for (event, timeout) in EVENTS {
        let groups = hooks
            .entry(event)
            .or_insert_with(|| Value::Array(Vec::new()));
        let Value::Array(groups) = groups else {
            return Err(format!("hooks.{event} не массив, файл не изменён"));
        };
        groups.push(json!({
            "hooks": [{ "type": "command", "command": command, "timeout": timeout }]
        }));
    }
    let after = render(&root, &before);
    Ok(make_plan(path, before, after))
}

/// Settings without our hooks.
pub fn plan_uninstall(path: &Path) -> Result<Plan, String> {
    let (before, mut root) = read(path)?;
    strip_ours(&mut root);
    let after = if before.is_empty() && root.is_empty() {
        String::new()
    } else {
        render(&root, &before)
    };
    // Do not reformat a file that has none of our hooks.
    let after = if installed_in(&before) {
        after
    } else {
        before.clone()
    };
    Ok(make_plan(path, before, after))
}

/// Hooks installed by an older build keep their old timeouts (45 s for PermissionRequest),
/// and Claude Code would kill a prompt held behind a full-screen app. This only brings the
/// timeouts of our own entries to EVENTS; nothing else in the file changes, and a file
/// without our hooks is left alone. Running sessions pick the edit up (Claude Code watches
/// its settings files).
pub fn plan_refresh(path: &Path) -> Result<Plan, String> {
    let (before, mut root) = read(path)?;
    let mut changed = false;
    if let Some(Value::Object(hooks)) = root.get_mut("hooks") {
        for (event, timeout) in EVENTS {
            let Some(Value::Array(groups)) = hooks.get_mut(event) else {
                continue;
            };
            for g in groups.iter_mut() {
                let Some(Value::Array(list)) = g.get_mut("hooks") else {
                    continue;
                };
                for h in list.iter_mut().filter(|h| is_ours(h)) {
                    if h.get("timeout").and_then(Value::as_u64) != Some(timeout) {
                        h["timeout"] = timeout.into();
                        changed = true;
                    }
                }
            }
        }
    }
    let after = if changed {
        render(&root, &before)
    } else {
        before.clone()
    };
    Ok(make_plan(path, before, after))
}

fn make_plan(path: &Path, before: String, after: String) -> Plan {
    let diff = if before == after {
        String::new()
    } else {
        diff(&before, &after, &path.display().to_string())
    };
    Plan {
        path: path.to_path_buf(),
        before,
        after,
        diff,
    }
}

fn installed_in(text: &str) -> bool {
    let Ok(Value::Object(mut root)) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    let had = serde_json::to_string(&root).unwrap_or_default();
    strip_ours(&mut root);
    serde_json::to_string(&root).unwrap_or_default() != had
}

/// Are any of our hooks in the settings file?
pub fn is_installed(path: &Path) -> bool {
    fs::read_to_string(path).is_ok_and(|t| installed_in(&t))
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Write the planned settings: backup of the current file, then tmp + rename.
/// Returns the backup path (None when there was no file).
pub fn apply(plan: &Plan) -> Result<Option<PathBuf>, String> {
    let (now, _) = read(&plan.path)?;
    if now != plan.before {
        return Err("settings.json изменился после показа диффа, повторите установку".into());
    }
    if !plan.changed() {
        return Ok(None);
    }
    let backup = if plan.before.is_empty() {
        None
    } else {
        let b = plan
            .path
            .with_file_name(format!("settings.json.bak-almanac-{}", unix_now()));
        fs::copy(&plan.path, &b).map_err(|e| format!("бэкап не записан: {e}"))?;
        Some(b)
    };
    if let Some(dir) = plan.path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = plan.path.with_file_name("settings.json.almanac-tmp");
    fs::write(&tmp, &plan.after).map_err(|e| format!("не записан {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &plan.path).map_err(|e| format!("не записан settings.json: {e}"))?;
    Ok(backup)
}

/// Put the hook client at its fixed place. Copy + rename, so a hook that is running
/// right now keeps its old file and macOS never sees a signed binary change in place.
pub fn copy_client(from: &Path, to: &Path) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = to.with_extension("tmp");
    fs::copy(from, &tmp).map_err(|e| format!("не скопирован {}: {e}", from.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, to).map_err(|e| e.to_string())
}

/// Line diff with 3 lines of context (LCS; settings files are small).
pub fn diff(a: &str, b: &str, name: &str) -> String {
    let x: Vec<&str> = a.lines().collect();
    let y: Vec<&str> = b.lines().collect();
    let (n, m) = (x.len(), y.len());
    // ops: ' ' keep, '-' remove, '+' add
    let mut ops: Vec<(char, &str)> = Vec::new();
    if n * m > 4_000_000 {
        ops.extend(x.iter().map(|l| ('-', *l)));
        ops.extend(y.iter().map(|l| ('+', *l)));
    } else {
        let mut l = vec![0u32; (n + 1) * (m + 1)];
        let at = |i: usize, j: usize| i * (m + 1) + j;
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                l[at(i, j)] = if x[i] == y[j] {
                    l[at(i + 1, j + 1)] + 1
                } else {
                    l[at(i + 1, j)].max(l[at(i, j + 1)])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < n || j < m {
            if i < n && j < m && x[i] == y[j] {
                ops.push((' ', x[i]));
                i += 1;
                j += 1;
            } else if j < m && (i == n || l[at(i, j + 1)] >= l[at(i + 1, j)]) {
                ops.push(('+', y[j]));
                j += 1;
            } else {
                ops.push(('-', x[i]));
                i += 1;
            }
        }
    }
    let mut out = format!("--- {name}\n+++ {name} (новый)\n");
    let keep: Vec<bool> = (0..ops.len())
        .map(|k| {
            let lo = k.saturating_sub(3);
            let hi = (k + 3).min(ops.len() - 1);
            (lo..=hi).any(|q| ops[q].0 != ' ')
        })
        .collect();
    let mut gap = false;
    for (k, (op, line)) in ops.iter().enumerate() {
        if keep[k] {
            if gap {
                out.push_str("@@\n");
                gap = false;
            }
            out.push(*op);
            out.push(' ');
            out.push_str(line);
            out.push('\n');
        } else {
            gap = true;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("almanac-hook-test-{name}-{}", unix_now()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        fs::write(&p, body).unwrap();
        p
    }

    const OTHER: &str = r#"{
  "model": "opus",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/other-hook"
          }
        ]
      }
    ]
  }
}
"#;

    #[test]
    fn install_keeps_other_hooks_and_is_idempotent() {
        let p = tmp("install", OTHER);
        let hook = Path::new("/x/almanac-hook");
        let plan = plan_install(&p, hook).unwrap();
        assert!(plan.changed());
        assert!(plan.after.contains("/usr/local/bin/other-hook"));
        assert!(plan.diff.contains("+ "));
        let backup = apply(&plan).unwrap().unwrap();
        assert_eq!(fs::read_to_string(&backup).unwrap(), OTHER);
        assert!(is_installed(&p));
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(v["model"], "opus");
        // second install: same file
        let again = plan_install(&p, hook).unwrap();
        assert!(!again.changed(), "{}", again.diff);
        // uninstall restores the original content
        let un = plan_uninstall(&p).unwrap();
        apply(&un).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), OTHER);
        assert!(!is_installed(&p));
    }

    #[test]
    fn refuses_when_file_changed_or_broken() {
        let p = tmp("changed", OTHER);
        let plan = plan_install(&p, Path::new("/x/almanac-hook")).unwrap();
        fs::write(&p, "{}").unwrap();
        assert!(apply(&plan).is_err());
        fs::write(&p, "{ not json").unwrap();
        assert!(plan_install(&p, Path::new("/x/almanac-hook")).is_err());
    }

    #[test]
    fn refresh_updates_only_our_timeouts() {
        let p = tmp("refresh", OTHER);
        assert!(!plan_refresh(&p).unwrap().changed(), "no hooks of ours");
        apply(&plan_install(&p, Path::new("/x/almanac-hook")).unwrap()).unwrap();
        // an install by an older build: 45 s on PermissionRequest
        let old = fs::read_to_string(&p).unwrap().replacen(
            &format!("\"timeout\": {}", HOLD_MAX_SECS + HOLD_SLACK),
            "\"timeout\": 45",
            2,
        );
        fs::write(&p, &old).unwrap();
        let plan = plan_refresh(&p).unwrap();
        assert!(plan.changed());
        apply(&plan).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(
            v["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"],
            HOLD_MAX_SECS + HOLD_SLACK
        );
        let other = &v["hooks"]["PreToolUse"][0]["hooks"][0];
        assert_eq!(other["command"], "/usr/local/bin/other-hook");
        assert!(
            other.get("timeout").is_none(),
            "other hooks are not touched"
        );
        assert!(!plan_refresh(&p).unwrap().changed());
    }

    #[test]
    fn missing_file_is_created() {
        let p = tmp("missing", "");
        fs::remove_file(&p).unwrap();
        let plan = plan_install(&p, Path::new("/x/almanac-hook")).unwrap();
        assert_eq!(apply(&plan).unwrap(), None);
        assert!(is_installed(&p));
    }
}
