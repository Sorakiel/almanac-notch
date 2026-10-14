//! File locations, computed the same way by the app and by the hook client.

use std::env;
use std::path::PathBuf;

/// Tauri identifier; Tauri's app data dir on macOS is ~/Library/Application Support/<id>.
pub const APP_ID: &str = "dev.almanac.notch";

fn home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// The app's data directory.
pub fn app_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support").join(APP_ID)
    } else if cfg!(windows) {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Roaming"))
            .join(APP_ID)
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local/share"))
            .join(APP_ID)
    }
}

/// Port and token of the running app (mode 0600). Absent = app not running.
pub fn connection_file() -> PathBuf {
    app_dir().join("hook.json")
}

/// Where the installer puts the hook client; settings.json points here.
pub fn installed_hook() -> PathBuf {
    let name = if cfg!(windows) {
        "almanac-hook.exe"
    } else {
        "almanac-hook"
    };
    app_dir().join(name)
}

/// Claude Code's config directory (CLAUDE_CONFIG_DIR overrides ~/.claude).
pub fn claude_dir() -> PathBuf {
    env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".claude"))
}

pub fn claude_settings() -> PathBuf {
    claude_dir().join("settings.json")
}
