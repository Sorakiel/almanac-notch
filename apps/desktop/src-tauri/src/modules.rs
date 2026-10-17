//! Modules the user switched off in settings, and the chat tab (stage 7). A switched-off module
//! reads nothing it would need the network or a system API for, and the island hides it.
//! At least one module always stays on. Stored in `<app data>/modules.json`.

use std::fs;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// The island's module ids (packages/island ModuleId).
pub const ALL: [&str; 5] = ["claude", "cal", "music", "github", "almanac"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// switched-off module ids
    pub off: Vec<String>,
    /// the chat tab is shown
    pub chat: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            off: Vec::new(),
            chat: true,
        }
    }
}

static CFG: RwLock<Option<Config>> = RwLock::new(None);

fn path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("modules.json")
}

/// Unknown ids are dropped; an "everything off" file falls back to everything on.
fn clean(c: Config) -> Config {
    let off: Vec<String> = c
        .off
        .into_iter()
        .filter(|id| ALL.contains(&id.as_str()))
        .collect();
    if off.len() >= ALL.len() {
        return Config {
            off: Vec::new(),
            chat: c.chat,
        };
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
    let c = Config { off, chat };
    fs::create_dir_all(almanac_hook::paths::app_dir()).map_err(|e| e.to_string())?;
    fs::write(
        path(),
        serde_json::to_string(&c).map_err(|e| e.to_string())?,
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
                off: Vec::new(),
                chat: false
            }
        );
        let c = clean(Config {
            off: vec!["github".into(), "nope".into()],
            chat: true,
        });
        assert_eq!(c.off, vec!["github".to_string()]);
    }
}
