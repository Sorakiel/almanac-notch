//! Interface language (stage 8): "auto" follows the system, or "ru" / "en" picked in settings.
//! Stored in `<app data>/lang.json`. The island and the settings window translate themselves;
//! Rust only needs it for the tray, dialogs and error texts.

use std::fs;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Config {
    /// what the user picked: "auto", "ru" or "en"
    pub pick: String,
    /// what is in effect: "ru" or "en"
    pub lang: String,
}

static PICK: RwLock<Option<String>> = RwLock::new(None);

fn path() -> std::path::PathBuf {
    almanac_hook::paths::app_dir().join("lang.json")
}

#[derive(Deserialize, Serialize)]
struct File {
    pick: String,
}

fn pick() -> String {
    if let Some(p) = PICK.read().unwrap().as_ref() {
        return p.clone();
    }
    let p = fs::read(path())
        .ok()
        .and_then(|b| serde_json::from_slice::<File>(&b).ok())
        .map(|f| f.pick)
        .filter(|p| matches!(p.as_str(), "auto" | "ru" | "en"))
        .unwrap_or_else(|| "auto".into());
    *PICK.write().unwrap() = Some(p.clone());
    p
}

/// Russian if the system's first preferred language is Russian, else English.
#[cfg(target_os = "macos")]
fn system_ru() -> bool {
    objc2_foundation::NSLocale::preferredLanguages()
        .firstObject()
        .is_some_and(|l| l.to_string().starts_with("ru"))
}

#[cfg(windows)]
fn system_ru() -> bool {
    // LANGID: the low 10 bits are the primary language, LANG_RUSSIAN = 0x19
    unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() & 0x3ff == 0x19 }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn system_ru() -> bool {
    std::env::var("LANG").is_ok_and(|l| l.starts_with("ru"))
}

fn resolve(pick: &str, system_ru: bool) -> &'static str {
    match pick {
        "ru" => "ru",
        "en" => "en",
        _ if system_ru => "ru",
        _ => "en",
    }
}

pub fn get() -> Config {
    let p = pick();
    let lang = resolve(&p, system_ru()).to_string();
    Config { pick: p, lang }
}

pub fn en() -> bool {
    get().lang == "en"
}

/// The text in the current language.
pub fn t(ru: &'static str, en: &'static str) -> &'static str {
    if self::en() {
        en
    } else {
        ru
    }
}

pub fn set(pick: &str) -> Result<Config, String> {
    if !matches!(pick, "auto" | "ru" | "en") {
        return Err(format!("unknown language: {pick}"));
    }
    fs::create_dir_all(almanac_hook::paths::app_dir()).map_err(crate::lang::save_failed)?;
    let body = serde_json::to_string(&File { pick: pick.into() }).map_err(|e| e.to_string())?;
    fs::write(path(), body).map_err(crate::lang::save_failed)?;
    *PICK.write().unwrap() = Some(pick.into());
    Ok(get())
}

/// A settings file could not be written: what happened, in the interface language.
pub fn save_failed(e: impl std::fmt::Display) -> String {
    format!(
        "{} ({e})",
        t(
            "Не удалось сохранить настройки - проверьте, что на диске есть место",
            "Could not save settings - check there is free disk space",
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_follows_the_system() {
        assert_eq!(resolve("auto", true), "ru");
        assert_eq!(resolve("auto", false), "en");
        assert_eq!(resolve("ru", false), "ru");
        assert_eq!(resolve("en", true), "en");
    }
}
