//! App-level preferences (stage 8f): whether the first-run guide was finished, whether to
//! check for updates and whether the island steps aside for full-screen apps. Stored in `<app data>/app.json`. Launch at login lives in the system
//! (LaunchAgent / Run key) via tauri-plugin-autostart, so it is read from there, not stored here.

use std::fs;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Prefs {
    pub onboarded: bool,
    pub updates: bool,
    /// hide the island while a full-screen app (game, video, slideshow) is in front (2026-10-24)
    pub fullscreen_hide: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        // updates on by default (owner, 2026-10-18), with a switch in settings
        Prefs {
            onboarded: false,
            updates: true,
            fullscreen_hide: true,
        }
    }
}

static CACHE: Mutex<Option<Prefs>> = Mutex::new(None);

fn path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("app.json")
}

fn parse(b: &[u8]) -> Prefs {
    serde_json::from_slice(b).unwrap_or_default()
}

pub fn get() -> Prefs {
    let mut c = CACHE.lock().unwrap();
    c.get_or_insert_with(|| fs::read(path()).map(|b| parse(&b)).unwrap_or_default())
        .clone()
}

pub fn set(f: impl FnOnce(&mut Prefs)) -> Result<Prefs, String> {
    let mut p = get();
    f(&mut p);
    let dir = almanac_hook::paths::app_dir();
    fs::create_dir_all(&dir).map_err(crate::lang::save_failed)?;
    let json = serde_json::to_vec_pretty(&p).map_err(|e| e.to_string())?;
    fs::write(path(), json).map_err(crate::lang::save_failed)?;
    *CACHE.lock().unwrap() = Some(p.clone());
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_broken_file_means_first_run_with_updates() {
        assert_eq!(parse(b""), Prefs::default());
        assert_eq!(parse(b"{oops"), Prefs::default());
        let p = parse(br#"{"onboarded":true}"#);
        assert!(p.onboarded && p.updates);
        assert!(!parse(br#"{"updates":false}"#).updates);
    }
}
