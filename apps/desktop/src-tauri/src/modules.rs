//! Modules the user switched off in settings, and the chat tab (stage 7). A switched-off module
//! reads nothing it would need the network or a system API for, and the island hides it.
//! At least one module always stays on. At most `MAX_ON` are on at once - the focus card and the
//! 2 × 2 grid of the open island (coucou's MAX_DECLARED plus its main module). Claude Code counts
//! only while it is on: switching it off frees its place (owner 2026-10-19).
//! Stored in `<app data>/modules.json`.

use std::fs;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// The island's module ids (packages/island ModuleId).
pub const ALL: [&str; 8] = [
    "claude", "cal", "music", "github", "almanac", "vercel", "notion", "grafana",
];

/// The main module: never the one switched off to fit an old file.
const MAIN: &str = "claude";
/// Modules on at once: the open island's focus card and its 2 × 2 grid.
pub const MAX_ON: usize = 5;

/// Modules on, Claude Code included when it is on.
fn on_count(off: &[String]) -> usize {
    ALL.iter()
        .filter(|id| !off.iter().any(|o| o == *id))
        .count()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// switched-off module ids
    pub off: Vec<String>,
    /// the chat tab is shown
    pub chat: bool,
}

impl Default for Config {
    fn default() -> Self {
        // a new module starts off: the prototype's five stay as they were
        Config {
            off: vec!["vercel".into(), "notion".into(), "grafana".into()],
            chat: true,
        }
    }
}

static CFG: RwLock<Option<Config>> = RwLock::new(None);

fn path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("modules.json")
}

/// Unknown ids are dropped; an "everything off" file falls back to everything on; too many on
/// (a file from before a module was added) switches off the newest ones.
fn clean(c: Config) -> Config {
    let mut off: Vec<String> = c
        .off
        .into_iter()
        .filter(|id| ALL.contains(&id.as_str()))
        .collect();
    if off.len() >= ALL.len() {
        off.clear();
    }
    for id in ALL.iter().rev() {
        if on_count(&off) <= MAX_ON {
            break;
        }
        if *id != MAIN && !off.iter().any(|o| o == id) {
            off.push((*id).to_owned());
        }
    }
    Config { off, chat: c.chat }
}

pub fn get() -> Config {
    if let Some(c) = CFG.read().unwrap().as_ref() {
        return c.clone();
    }
    let c = fs::read(path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
        .map(clean)
        .unwrap_or_default();
    *CFG.write().unwrap() = Some(c.clone());
    c
}

pub fn is_on(id: &str) -> bool {
    !get().off.iter().any(|o| o == id)
}

/// From the settings window. Refuses to switch every module off.
pub fn set(off: Vec<String>, chat: bool) -> Result<Config, String> {
    if let Some(bad) = off.iter().find(|id| !ALL.contains(&id.as_str())) {
        return Err(format!(
            "{} {bad}",
            crate::lang::t("Неизвестный модуль:", "Unknown module:")
        ));
    }
    if ALL.iter().all(|id| off.iter().any(|o| o == id)) {
        return Err(crate::lang::t(
            "Хотя бы один модуль должен остаться включённым",
            "At least one module must stay on",
        )
        .into());
    }
    if on_count(&off) > MAX_ON {
        return Err(crate::lang::t(
            "Одновременно можно включить не больше 5 модулей - сначала выключите один",
            "At most 5 modules can be on at once - switch one off first",
        )
        .into());
    }
    let c = Config { off, chat };
    fs::create_dir_all(almanac_hook::paths::app_dir()).map_err(crate::lang::save_failed)?;
    fs::write(
        path(),
        serde_json::to_string(&c).map_err(crate::lang::save_failed)?,
    )
    .map_err(|e| e.to_string())?;
    *CFG.write().unwrap() = Some(c.clone());
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_module_on() {
        let all: Vec<String> = ALL.iter().map(|s| s.to_string()).collect();
        assert_eq!(
            clean(Config {
                off: all,
                chat: false
            }),
            Config {
                off: vec!["grafana".into(), "notion".into(), "vercel".into()],
                chat: false
            }
        );
        let c = clean(Config {
            off: vec!["github".into(), "nope".into()],
            chat: true,
        });
        // five others on: the newest goes off
        assert_eq!(
            c.off,
            vec![
                "github".to_string(),
                "grafana".to_string(),
                "notion".to_string()
            ]
        );
    }

    #[test]
    fn claude_off_frees_its_place() {
        // Claude Code off: five others fit, a sixth does not
        let five = clean(Config {
            off: vec!["claude".into(), "almanac".into(), "cal".into()],
            chat: true,
        });
        assert_eq!(on_count(&five.off), 5);
        assert!(five.off.len() == 3);
        let six = clean(Config {
            off: vec!["claude".into(), "almanac".into()],
            chat: true,
        });
        assert_eq!(on_count(&six.off), 5);
        assert!(six.off.contains(&"claude".to_string()));
    }

    #[test]
    fn at_most_five_at_once() {
        // a file from before Vercel: everything on -> the newest modules go off
        let c = clean(Config {
            off: Vec::new(),
            chat: true,
        });
        assert_eq!(
            c.off,
            vec![
                "grafana".to_string(),
                "notion".to_string(),
                "vercel".to_string()
            ]
        );
        assert_eq!(
            Config::default().off,
            vec![
                "vercel".to_string(),
                "notion".to_string(),
                "grafana".to_string()
            ]
        );
        // a file from the Vercel stage, Vercel switched on: Notion and Grafana come in off
        let c = clean(Config {
            off: vec!["almanac".into()],
            chat: true,
        });
        assert_eq!(
            c.off,
            vec![
                "almanac".to_string(),
                "grafana".to_string(),
                "notion".to_string()
            ]
        );
        // a file from the Notion stage, Notion switched on: Grafana comes in off
        let c = clean(Config {
            off: vec!["almanac".into(), "vercel".into()],
            chat: true,
        });
        assert_eq!(
            c.off,
            vec![
                "almanac".to_string(),
                "vercel".to_string(),
                "grafana".to_string()
            ]
        );
        // Claude off frees its place for a fifth other module (owner 2026-10-19)
        let c = clean(Config {
            off: vec!["claude".into()],
            chat: true,
        });
        assert_eq!(
            c.off,
            vec![
                "claude".to_string(),
                "grafana".to_string(),
                "notion".to_string()
            ]
        );
    }
}
