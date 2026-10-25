//! Every module's secrets (tokens, the calendar link, the Almanac refresh token) behind one door.
//!
//! Mac: one keychain item holds them all, as JSON, read once per launch and kept in memory.
//! The app is self-signed (no Apple team), so macOS ties "Always Allow" to this exact binary:
//! after every update it asks again, once per item. With seven items and a read on every poll that
//! was seven password prompts per update, and a fresh one each minute after a plain "Allow".
//! One item read once = at most one prompt per update.
//!
//! Windows: Credential Manager never asks and caps a secret at 2560 bytes, so each secret keeps
//! its own entry there; only the in-memory copy is shared.
//!
//! Debug builds use their own service name, so a test build never touches the user's real
//! secrets (and never asks for them).

use std::collections::BTreeMap;
use std::sync::Mutex;

pub const SERVICE: &str = if cfg!(debug_assertions) {
    "dev.almanac.notch.debug"
} else {
    "dev.almanac.notch"
};

/// Before 0.2.1 each secret was its own item under these accounts (still so on Windows).
pub const ACCOUNTS: [&str; 7] = [
    "almanac-refresh",
    "github-token",
    "vercel-token",
    "notion-token",
    "grafana-token",
    "grafana-url",
    "calendar-ical",
];

#[cfg(target_os = "macos")]
const BUNDLE: &str = "secrets";

enum Cache {
    Unread,
    /// the keychain refused (the prompt was denied): no secrets until a user action asks again
    Refused,
    Read(BTreeMap<String, String>),
}

static CACHE: Mutex<Cache> = Mutex::new(Cache::Unread);

pub fn get(account: &str) -> Option<String> {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(*c, Cache::Unread) {
        *c = load();
    }
    match &*c {
        Cache::Read(m) => m.get(account).filter(|v| !v.is_empty()).cloned(),
        _ => None,
    }
}

/// Keep `value` for `account`. A refused keychain is asked once more: this is a user action.
pub fn set(account: &str, value: &str) -> Result<(), String> {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if !matches!(*c, Cache::Read(_)) {
        *c = load();
    }
    let Cache::Read(m) = &mut *c else {
        return Err("keychain refused".into());
    };
    let mut next = m.clone();
    next.insert(account.to_owned(), value.to_owned());
    store(&next, Some(account))?;
    *m = next;
    Ok(())
}

pub fn remove(account: &str) {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Cache::Read(m) = &mut *c {
        if m.remove(account).is_some() {
            let _ = store(m, None);
        }
    }
    #[cfg(not(target_os = "macos"))]
    if let Ok(e) = keyring::Entry::new(SERVICE, account) {
        let _ = e.delete_credential();
    }
}

/// The uninstaller: every item this app ever wrote, old layout included.
pub fn wipe() -> Vec<String> {
    let mut failed = Vec::new();
    #[cfg(target_os = "macos")]
    let names = ACCOUNTS.iter().copied().chain([BUNDLE]);
    #[cfg(not(target_os = "macos"))]
    let names = ACCOUNTS.iter().copied();
    for name in names {
        if let Ok(e) = keyring::Entry::new(SERVICE, name) {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => failed.push(format!("{name}: {err}")),
            }
        }
    }
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Cache::Read(BTreeMap::new());
    failed
}

#[cfg(target_os = "macos")]
fn load() -> Cache {
    let Ok(entry) = keyring::Entry::new(SERVICE, BUNDLE) else {
        return Cache::Refused;
    };
    match entry.get_password() {
        Ok(json) => match serde_json::from_str(&json) {
            Ok(m) => Cache::Read(m),
            Err(_) => Cache::Read(BTreeMap::new()),
        },
        Err(keyring::Error::NoEntry) => migrate(),
        Err(_) => Cache::Refused,
    }
}

/// First launch after the move to one item: gather the old ones, then remove them, so the next
/// update has nothing left to ask about but the one. This launch may still ask once per old item.
/// One refused: nothing is moved, the next launch tries again.
#[cfg(target_os = "macos")]
fn migrate() -> Cache {
    let mut m = BTreeMap::new();
    let mut found = Vec::new();
    for a in ACCOUNTS {
        let Ok(e) = keyring::Entry::new(SERVICE, a) else {
            continue;
        };
        match e.get_password() {
            Ok(v) => {
                if !v.is_empty() {
                    m.insert(a.to_owned(), v);
                }
                found.push(e);
            }
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Cache::Refused,
        }
    }
    if !m.is_empty() && store(&m, None).is_ok() {
        for e in found {
            let _ = e.delete_credential();
        }
    }
    Cache::Read(m)
}

#[cfg(target_os = "macos")]
fn store(m: &BTreeMap<String, String>, _changed: Option<&str>) -> Result<(), String> {
    let e = keyring::Entry::new(SERVICE, BUNDLE).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(m).map_err(|e| e.to_string())?;
    e.set_password(&json).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn load() -> Cache {
    let mut m = BTreeMap::new();
    for a in ACCOUNTS {
        let Ok(e) = keyring::Entry::new(SERVICE, a) else {
            continue;
        };
        match e.get_password() {
            Ok(v) => {
                m.insert(a.to_owned(), v);
            }
            Err(keyring::Error::NoEntry) => {}
            Err(_) => return Cache::Refused,
        }
    }
    Cache::Read(m)
}

#[cfg(not(target_os = "macos"))]
fn store(m: &BTreeMap<String, String>, changed: Option<&str>) -> Result<(), String> {
    let Some(a) = changed else { return Ok(()) };
    let e = keyring::Entry::new(SERVICE, a).map_err(|e| e.to_string())?;
    e.set_password(m.get(a).map(String::as_str).unwrap_or(""))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real keychain, debug service only: `cargo test secrets -- --ignored`.
    #[test]
    #[ignore]
    fn old_items_move_into_one_and_stay_readable() {
        assert_eq!(SERVICE, "dev.almanac.notch.debug");
        wipe();
        *CACHE.lock().unwrap() = Cache::Unread;
        for (a, v) in [("github-token", "gh"), ("grafana-url", "https://g")] {
            keyring::Entry::new(SERVICE, a).unwrap().set_password(v).unwrap();
        }
        assert_eq!(get("github-token").as_deref(), Some("gh"));
        assert_eq!(get("grafana-url").as_deref(), Some("https://g"));
        set("vercel-token", "vc").unwrap();
        remove("github-token");
        // a fresh launch reads what was kept
        *CACHE.lock().unwrap() = Cache::Unread;
        assert_eq!(get("github-token"), None);
        assert_eq!(get("vercel-token").as_deref(), Some("vc"));
        #[cfg(target_os = "macos")]
        {
            let old = keyring::Entry::new(SERVICE, "grafana-url").unwrap().get_password();
            assert!(matches!(old, Err(keyring::Error::NoEntry)), "old item left behind");
        }
        wipe();
    }
}
