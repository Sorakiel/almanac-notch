//! Every module's secrets (tokens, the calendar link, the Almanac refresh token) behind one door,
//! read once per launch and kept in memory.
//!
//! Mac: a file only this user can read, `<app data>/secrets.json` (0600, folder 0700), kept out
//! of Time Machine. Not the Keychain (owner, 2026-10-25): the app is self-signed, without an
//! Apple team, so macOS ties "Always Allow" to the exact binary and asks for the password again
//! after every update, once per item - the owner had typed it 12 times for the GitHub token
//! alone. A file asks nothing; it is open to programs running as the same user, as the Vercel
//! CLI's token file is. With an Apple Developer ID the Keychain would ask once ever.
//!
//! Windows: Credential Manager, which never asks; one entry per secret (it caps a secret at
//! 2560 bytes).
//!
//! What 0.2.0 and earlier kept under the old identifier moves here on the first launch (the Mac
//! Keychain asks one last time per old item; a release build only - a test build never touches
//! the user's Keychain).

use std::collections::BTreeMap;
use std::sync::Mutex;

use almanac_hook::paths;

/// One entry per secret before (Mac Keychain up to 0.2.0) and still (Windows).
pub const ACCOUNTS: [&str; 7] = [
    "almanac-refresh",
    "github-token",
    "vercel-token",
    "notion-token",
    "grafana-token",
    "grafana-url",
    "calendar-ical",
];

static CACHE: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

pub fn get(account: &str) -> Option<String> {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    c.get_or_insert_with(load)
        .get(account)
        .filter(|v| !v.is_empty())
        .cloned()
}

pub fn set(account: &str, value: &str) -> Result<(), String> {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let m = c.get_or_insert_with(load);
    let mut next = m.clone();
    next.insert(account.to_owned(), value.to_owned());
    store(&next, account)?;
    *m = next;
    Ok(())
}

pub fn remove(account: &str) {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let m = c.get_or_insert_with(load);
    if m.remove(account).is_some() {
        let _ = store(m, account);
    }
}

/// The uninstaller: every secret, old places included. Returns what could not be removed.
pub fn wipe() -> Vec<String> {
    let mut failed = Vec::new();
    #[cfg(target_os = "macos")]
    match std::fs::remove_file(file()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            failed.push(format!("secrets.json: {e}"))
        }
        _ => {}
    }
    for id in keyring_services() {
        for a in ACCOUNTS {
            if let Ok(e) = keyring::Entry::new(id, a) {
                match e.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => {}
                    Err(err) => failed.push(format!("{a}: {err}")),
                }
            }
        }
    }
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some(BTreeMap::new());
    failed
}

/// Keyring services that may hold entries: the old identifier, and on Windows the current one.
fn keyring_services() -> Vec<&'static str> {
    if cfg!(target_os = "macos") {
        vec![paths::OLD_APP_ID]
    } else {
        vec![paths::APP_ID, paths::OLD_APP_ID]
    }
}

// ---------- Mac: the file ----------

#[cfg(target_os = "macos")]
fn file() -> std::path::PathBuf {
    paths::app_dir().join("secrets.json")
}

#[cfg(target_os = "macos")]
fn load() -> BTreeMap<String, String> {
    match std::fs::read(file()) {
        Ok(b) => serde_json::from_slice(&b).unwrap_or_default(),
        Err(_) if cfg!(debug_assertions) => BTreeMap::new(),
        Err(_) => from_keychain(),
    }
}

/// 0.2.0 and earlier: one Keychain item per secret under the old identifier. Each read may ask
/// for the password - this one last time; an item read is removed, a refused one stays (the
/// module then asks to be connected again).
#[cfg(target_os = "macos")]
fn from_keychain() -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    let mut read = Vec::new();
    for a in ACCOUNTS {
        let Ok(e) = keyring::Entry::new(paths::OLD_APP_ID, a) else {
            continue;
        };
        if let Ok(v) = e.get_password() {
            if !v.is_empty() {
                m.insert(a.to_owned(), v);
            }
            read.push(e);
        }
    }
    if !m.is_empty() && write_file(&m).is_ok() {
        for e in read {
            let _ = e.delete_credential();
        }
    }
    m
}

#[cfg(target_os = "macos")]
fn store(m: &BTreeMap<String, String>, _account: &str) -> Result<(), String> {
    write_file(m)
}

/// Written whole through a temporary file, so a crash never leaves half a file.
#[cfg(target_os = "macos")]
fn write_file(m: &BTreeMap<String, String>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = paths::app_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    let path = file();
    let fresh = !path.exists();
    let tmp = path.with_extension("tmp");
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    let json = serde_json::to_string(m).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    if fresh {
        // tokens stay off backups; the exclusion is an attribute on the file itself
        let _ = std::process::Command::new("/usr/bin/tmutil")
            .arg("addexclusion")
            .arg(&path)
            .output();
    }
    Ok(())
}

// ---------- Windows (and others): Credential Manager ----------

#[cfg(not(target_os = "macos"))]
fn load() -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    for a in ACCOUNTS {
        let now = keyring::Entry::new(paths::APP_ID, a).ok();
        if let Some(v) = now.as_ref().and_then(|e| e.get_password().ok()) {
            m.insert(a.to_owned(), v);
            continue;
        }
        // kept under the old identifier: move it over
        let Ok(old) = keyring::Entry::new(paths::OLD_APP_ID, a) else {
            continue;
        };
        if let Ok(v) = old.get_password() {
            if now.is_some_and(|e| e.set_password(&v).is_ok()) {
                let _ = old.delete_credential();
            }
            m.insert(a.to_owned(), v);
        }
    }
    m
}

#[cfg(not(target_os = "macos"))]
fn store(m: &BTreeMap<String, String>, account: &str) -> Result<(), String> {
    let e = keyring::Entry::new(paths::APP_ID, account).map_err(|e| e.to_string())?;
    match m.get(account) {
        Some(v) => e.set_password(v).map_err(|e| e.to_string()),
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        },
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// In a made-up home (it sets HOME): `cargo test -- --ignored --test-threads=1`.
    #[test]
    #[ignore]
    fn a_private_file_kept_whole_and_read_back() {
        use std::os::unix::fs::PermissionsExt;
        let home = std::env::temp_dir().join(format!("almanac-secrets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::env::set_var("HOME", &home);
        *CACHE.lock().unwrap() = None;
        assert_eq!(get("github-token"), None);
        set("github-token", "gh").unwrap();
        set("vercel-token", "vc").unwrap();
        remove("github-token");
        let mode = std::fs::metadata(file()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let dir = std::fs::metadata(paths::app_dir())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir, 0o700);
        // the next launch
        *CACHE.lock().unwrap() = None;
        assert_eq!(get("vercel-token").as_deref(), Some("vc"));
        assert_eq!(get("github-token"), None);
        let _ = std::fs::remove_dir_all(&home);
    }
}
