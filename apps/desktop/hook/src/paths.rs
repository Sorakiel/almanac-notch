//! File locations, computed the same way by the app and by the hook client.

use std::env;
use std::path::PathBuf;

/// Tauri identifier; Tauri's app data dir on macOS is ~/Library/Application Support/<id>.
pub const APP_ID: &str = "com.almanac.notch";
/// The identifier up to 0.2.0; the app moves what it finds under it (src-tauri identity.rs).
pub const OLD_APP_ID: &str = "dev.almanac.notch";

fn home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// The app's data directory.
pub fn app_dir() -> PathBuf {
    app_dir_for(APP_ID)
}

/// The data directory an app with identifier `id` gets.
pub fn app_dir_for(id: &str) -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support").join(id)
    } else if cfg!(windows) {
        env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Roaming"))
            .join(id)
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local/share"))
            .join(id)
    }
}

/// The hook client inside an app data directory.
pub fn hook_in(dir: &std::path::Path) -> PathBuf {
    dir.join(if cfg!(windows) {
        "almanac-hook.exe"
    } else {
        "almanac-hook"
    })
}

/// Port and token of the running app (mode 0600). Absent = app not running.
pub fn connection_file() -> PathBuf {
    app_dir().join("hook.json")
}

/// Where the installer puts the hook client; settings.json points here.
pub fn installed_hook() -> PathBuf {
    hook_in(&app_dir())
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
