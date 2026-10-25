//! The move from the identifier `dev.almanac.notch` (up to 0.2.0) to `com.almanac.notch`.
//!
//! The system knows the app by its identifier: the data folder, the webview's storage (the
//! island's sound, volume, auto-close and module choices live there), the calendar permission.
//! On the first launch under the new one, everything found under the old one moves over, once,
//! before any window or webview exists. The calendar permission can't be carried: macOS asks
//! again. Secrets move separately (secrets.rs). Every step is best effort - a failure leaves the
//! old copy in place and the app starts clean rather than not at all.

use std::fs;
use std::path::{Path, PathBuf};

use almanac_hook::{install, paths};

pub fn migrate() {
    let old = paths::app_dir_for(paths::OLD_APP_ID);
    if old.exists() {
        let new = paths::app_dir();
        merge(&old, &new);
        // a stale connection file and the old client (it looks in the old folder) don't move
        let _ = fs::remove_file(new.join("hook.json"));
        move_hooks(&old, &new);
        let _ = fs::remove_dir_all(&old);
    }
    webview_storage();
}

/// Move every entry of `from` into `to`; an entry already in `to` wins and the old one goes.
fn merge(from: &Path, to: &Path) {
    if !to.exists() {
        if let Some(parent) = to.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::rename(from, to).is_ok() {
            return;
        }
        let _ = fs::create_dir_all(to);
    }
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for e in entries.flatten() {
        let dest = to.join(e.file_name());
        if !dest.exists() {
            let _ = fs::rename(e.path(), &dest);
        }
    }
}

/// Claude Code's settings point at the client in the old folder: install the current client in
/// the new one and point the hooks there. Nothing happens where our hooks were never installed.
fn move_hooks(old: &Path, new: &Path) {
    let settings = paths::claude_settings();
    let old_client = paths::hook_in(old).display().to_string();
    let Ok(text) = fs::read_to_string(&settings) else {
        return;
    };
    // settings.json escapes backslashes (Windows paths)
    if !text.contains(&old_client) && !text.contains(&old_client.replace('\\', "\\\\")) {
        return;
    }
    let Some(source) = crate::claude::hooks_ui::client_source() else {
        eprintln!("[identity] hook client missing, hooks left on the old path");
        return;
    };
    let target = paths::hook_in(new);
    if let Err(e) = install::copy_client(&source, &target) {
        eprintln!("[identity] hook client not copied: {e}");
        return;
    }
    match install::plan_install(&settings, &target).and_then(|p| install::apply(&p)) {
        Ok(b) => eprintln!(
            "[identity] hooks moved to {}, backup: {b:?}",
            target.display()
        ),
        Err(e) => eprintln!("[identity] hooks not moved: {e}"),
    }
}

/// The webview keeps the island's own choices (localStorage) in a folder named by the identifier.
fn webview_storage() {
    for (old, new) in storage_dirs() {
        if old.exists() {
            // A release that moved would have removed the old folder: a new one beside it is a
            // dev or test build's (WebKit ignores HOME), and its empty storage must not win
            // over the person's real one.
            if new.exists() {
                let _ = fs::remove_dir_all(&new);
            }
            merge(&old, &new);
            let _ = fs::remove_dir_all(&old);
        }
    }
    // caches and window state are rebuilt on their own
    #[cfg(target_os = "macos")]
    {
        let lib = home().join("Library");
        let id = paths::OLD_APP_ID;
        let _ = fs::remove_dir_all(lib.join("Caches").join(id));
        let _ = fs::remove_dir_all(lib.join("HTTPStorages").join(id));
        let _ = fs::remove_dir_all(
            lib.join("Saved Application State")
                .join(format!("{id}.savedState")),
        );
        let _ = fs::remove_file(lib.join("Preferences").join(format!("{id}.plist")));
    }
}

fn storage_dirs() -> Vec<(PathBuf, PathBuf)> {
    let mut v = Vec::new();
    if cfg!(target_os = "macos") {
        let w = home().join("Library/WebKit");
        v.push((w.join(paths::OLD_APP_ID), w.join(paths::APP_ID)));
    } else if cfg!(windows) {
        // WebView2's EBWebView lives in Local, under the identifier
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            v.push((local.join(paths::OLD_APP_ID), local.join(paths::APP_ID)));
        }
    }
    v
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_moves_what_is_missing_and_keeps_what_is_there() {
        let root = std::env::temp_dir().join(format!("almanac-identity-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (old, new) = (root.join("old"), root.join("new"));
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("app.json"), "old").unwrap();
        fs::write(old.join("modules.json"), "old").unwrap();
        // the whole folder moves when the new one isn't there
        merge(&old, &new);
        assert_eq!(fs::read_to_string(new.join("app.json")).unwrap(), "old");
        assert!(!old.exists());
        // the new one exists: only missing entries move
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("app.json"), "older").unwrap();
        fs::write(old.join("lang.json"), "old").unwrap();
        merge(&old, &new);
        assert_eq!(fs::read_to_string(new.join("app.json")).unwrap(), "old");
        assert_eq!(fs::read_to_string(new.join("lang.json")).unwrap(), "old");
        let _ = fs::remove_dir_all(&root);
    }

    /// The whole move in a made-up home (it sets HOME): `cargo test identity -- --ignored`.
    #[test]
    #[ignore]
    fn first_launch_moves_data_storage_and_hooks() {
        let home = std::env::temp_dir().join(format!("almanac-home-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        std::env::set_var("HOME", &home);
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        let old = paths::app_dir_for(paths::OLD_APP_ID);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("app.json"), "{}").unwrap();
        fs::write(old.join("hook.json"), "{}").unwrap();
        fs::write(paths::hook_in(&old), "old client").unwrap();
        let kit = home.join("Library/WebKit").join(paths::OLD_APP_ID);
        fs::create_dir_all(kit.join("WebsiteData")).unwrap();
        fs::write(kit.join("WebsiteData/ls"), "volume").unwrap();
        // a test build already made an empty storage under the new identifier
        let kit_dev = home.join("Library/WebKit").join(paths::APP_ID);
        fs::create_dir_all(kit_dev.join("WebsiteData")).unwrap();
        fs::write(kit_dev.join("WebsiteData/ls"), "empty").unwrap();
        let settings = paths::claude_settings();
        fs::create_dir_all(settings.parent().unwrap()).unwrap();
        fs::write(&settings, "{}").unwrap();
        install::apply(&install::plan_install(&settings, &paths::hook_in(&old)).unwrap()).unwrap();

        migrate();

        let new = paths::app_dir();
        assert!(new.ends_with(paths::APP_ID));
        assert!(new.join("app.json").exists());
        assert!(
            !new.join("hook.json").exists(),
            "a stale connection file moved"
        );
        assert!(!old.exists());
        let kit_new = home
            .join("Library/WebKit")
            .join(paths::APP_ID)
            .join("WebsiteData/ls");
        assert_eq!(fs::read_to_string(kit_new).unwrap(), "volume");
        let text = fs::read_to_string(&settings).unwrap();
        assert!(
            text.contains(&paths::hook_in(&new).display().to_string()),
            "{text}"
        );
        assert!(!text.contains(paths::OLD_APP_ID), "{text}");
        assert_ne!(fs::read(paths::hook_in(&new)).unwrap(), b"old client");
        let _ = fs::remove_dir_all(&home);
    }
}
