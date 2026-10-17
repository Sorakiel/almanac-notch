//! Calendar: upcoming timed events for the call card.
//!
//! Mac (stage 5): EventKit with full access to events (asked once at launch, again from the tray).
//! A thread reads the next 48 hours every 30 s and sends `island://calendar` when the list or
//! the access changed. The frontend picks the next call and counts the minutes. Only titles
//! and times leave this module; nothing goes to the network.
//! Windows (stage 7): the source picked in settings - classic Outlook (COM, `outlook.rs`),
//! an iCal link (`ical.rs`) or nothing (`mod choice` below). Same message, plus `source`.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Event {
    pub title: String,
    /// epoch ms
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Calendar {
    /// "ok" | "denied" | "unknown" (not asked yet / no answer) | "off" (nothing to read)
    pub access: &'static str,
    /// "system" (Mac EventKit) | "outlook" | "ical" | "none" (not chosen)
    pub source: &'static str,
    pub events: Vec<Event>,
}

impl Calendar {
    fn empty(access: &'static str, source: &'static str) -> Self {
        Calendar {
            access,
            source,
            events: Vec::new(),
        }
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
/// The 48 hours the island looks at, plus the hour a running call may have begun in.
const BACK_MS: f64 = 3600.0 * 1000.0;
#[cfg_attr(target_os = "macos", allow(dead_code))]
const AHEAD_MS: f64 = 48.0 * 3600.0 * 1000.0;

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn window(now_ms: f64) -> (f64, f64) {
    (now_ms - BACK_MS, now_ms + AHEAD_MS)
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// What the settings window shows.
#[derive(Clone, Debug, Serialize)]
pub struct Config {
    /// "macos" | "windows" | "other"
    pub platform: &'static str,
    /// "system" on Mac; otherwise the choice: "outlook" | "ical" | "off"
    pub source: String,
    /// an iCal link is stored
    pub ical: bool,
    /// classic Outlook is registered on this machine
    pub outlook: bool,
}

#[cfg(target_os = "macos")]
pub fn config() -> Config {
    Config {
        platform: "macos",
        source: "system".into(),
        ical: false,
        outlook: false,
    }
}

/// Mac reads the system calendar (it already holds Google, iCloud, Exchange accounts).
#[cfg(target_os = "macos")]
pub fn choose(_source: &str, _url: Option<String>) -> Result<Option<usize>, String> {
    Err(crate::lang::t(
        "На Mac остров читает системный Календарь",
        "On a Mac the island reads the system Calendar",
    )
    .into())
}

#[cfg(not(target_os = "macos"))]
pub use choice::{choose, config, open_access, start};

#[cfg(not(target_os = "macos"))]
mod choice {
    //! Windows (and anything without a system calendar API): the source the user picked in
    //! settings - classic Outlook, an iCal link, or nothing (docs/DECISIONS.md, 2026-10-14).
    //! Choice in `<app data>/calendar.json`; the iCal link (a secret) in the credential store.

    use super::{now_ms, window, Calendar, Config, Event};
    use crate::ical;
    use std::fs;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::Mutex;
    use std::thread;
    use std::time::{Duration, Instant};

    /// Re-filter the window (and read a running Outlook) this often.
    const PERIOD: Duration = Duration::from_secs(30);
    /// The .ics is fetched again after this; Google refreshes it slowly anyway.
    const ICAL_EVERY: Duration = Duration::from_secs(5 * 60);
    /// Outlook that is not running is started headless only this often.
    const OUTLOOK_COLD_EVERY: Duration = Duration::from_secs(5 * 60);

    const SERVICE: &str = "dev.almanac.notch";
    const ACCOUNT: &str = "calendar-ical";

    /// true = fetch the link again now (it was just changed)
    static POKE: Mutex<Option<Sender<bool>>> = Mutex::new(None);

    pub fn poke(refetch: bool) {
        if let Some(tx) = POKE.lock().unwrap().as_ref() {
            let _ = tx.send(refetch);
        }
    }

    // ---------- stored choice ----------

    fn path() -> std::path::PathBuf {
        almanac_hook::paths::app_dir().join("calendar.json")
    }

    fn source() -> String {
        fs::read(path())
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v.get("source")?.as_str().map(str::to_string))
            .filter(|s| matches!(s.as_str(), "outlook" | "ical" | "off"))
            .unwrap_or_else(|| "off".into())
    }

    fn save_source(s: &str) -> Result<(), String> {
        let dir = almanac_hook::paths::app_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(path(), serde_json::json!({ "source": s }).to_string()).map_err(|e| e.to_string())
    }

    fn entry() -> Option<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT).ok()
    }

    fn link() -> Option<String> {
        entry()?.get_password().ok()
    }

    fn outlook_installed() -> bool {
        #[cfg(windows)]
        return crate::outlook::installed();
        #[cfg(not(windows))]
        false
    }

    pub fn config() -> Config {
        Config {
            platform: if cfg!(windows) { "windows" } else { "other" },
            source: source(),
            ical: link().is_some(),
            outlook: outlook_installed(),
        }
    }

    /// From the settings window. Ok(Some(n)) = connected, n events in the next 48 h;
    /// Ok(None) = saved, nothing to count. The iCal link is kept only while it is the source.
    pub fn choose(src: &str, url: Option<String>) -> Result<Option<usize>, String> {
        let (from, to) = window(now_ms());
        let count = match src {
            "ical" => {
                let url = match url.filter(|u| !u.trim().is_empty()) {
                    Some(u) => ical::normalize(&u)?,
                    None => link().ok_or(crate::lang::t(
                        "Вставьте ссылку на календарь",
                        "Paste a calendar link",
                    ))?,
                };
                let text = ical::fetch(&url).map_err(|f| match f {
                    ical::Failure::Bad(m) => m,
                    ical::Failure::Net => crate::lang::t(
                        "Не удалось открыть ссылку: нет связи или сервер не ответил",
                        "Cannot open the link: no connection or the server did not answer",
                    )
                    .into(),
                })?;
                let n = ical::parse(&text, from, to).len();
                entry()
                    .ok_or(crate::lang::t(
                        "Хранилище паролей недоступно",
                        "The credential store is unavailable",
                    ))?
                    .set_password(&url)
                    .map_err(|e| {
                        format!(
                            "{} {e}",
                            crate::lang::t("Не удалось сохранить ссылку:", "Cannot save the link:")
                        )
                    })?;
                Some(n)
            }
            "outlook" => {
                #[cfg(windows)]
                {
                    let _com = com_sta();
                    match crate::outlook::read(from, to) {
                        Ok(ev) => Some(ev.len()),
                        Err(crate::outlook::Failure::Missing) => return Err(crate::lang::t(
                            "Классический Outlook не найден. Новый Outlook не даёт программам \
                                 читать календарь - подключите его через iCal-ссылку",
                            "Classic Outlook not found. The new Outlook does not let apps read \
                                 the calendar - connect it with an iCal link",
                        )
                        .into()),
                        Err(crate::outlook::Failure::Busy(e)) => {
                            eprintln!("[calendar] outlook: {e}");
                            None
                        }
                    }
                }
                #[cfg(not(windows))]
                return Err(crate::lang::t(
                    "Outlook есть только на Windows",
                    "Outlook is Windows only",
                )
                .into());
            }
            "off" => None,
            _ => return Err(crate::lang::t("Неизвестный источник", "Unknown source").into()),
        };
        if src != "ical" {
            if let Some(e) = entry() {
                let _ = e.delete_credential();
            }
        }
        save_source(src)?;
        poke(true);
        Ok(count)
    }

    /// Mac only (the tray item); here the choice lives in settings.
    pub fn open_access() {}

    #[cfg(windows)]
    struct Com;
    #[cfg(windows)]
    impl Drop for Com {
        fn drop(&mut self) {
            // SAFETY: pairs the successful init in com_sta.
            unsafe { windows::Win32::System::Com::CoUninitialize() };
        }
    }
    /// Outlook's object model is apartment-threaded.
    #[cfg(windows)]
    fn com_sta() -> Option<Com> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // SAFETY: per-thread init, undone by the guard.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .is_ok()
                .then_some(Com)
        }
    }

    #[derive(Default)]
    struct Cache {
        ical_text: Option<String>,
        ical_at: Option<Instant>,
        ical_bad: bool,
        outlook: Option<Vec<Event>>,
        outlook_at: Option<Instant>,
    }

    fn step(src: &str, c: &mut Cache, refetch: bool) -> Calendar {
        let (from, to) = window(now_ms());
        let keep = |ev: &[Event]| -> Vec<Event> {
            ev.iter()
                .filter(|e| e.end > from && e.start < to)
                .cloned()
                .collect()
        };
        match src {
            "ical" => {
                let due = refetch || c.ical_at.is_none_or(|t| t.elapsed() >= ICAL_EVERY);
                if due {
                    c.ical_at = Some(Instant::now());
                    match link().map(|u| ical::fetch(&u)) {
                        Some(Ok(text)) => {
                            c.ical_text = Some(text);
                            c.ical_bad = false;
                        }
                        Some(Err(ical::Failure::Bad(m))) => {
                            eprintln!("[calendar] ical: {m}");
                            c.ical_text = None;
                            c.ical_bad = true;
                        }
                        // no answer: the last good copy stays
                        Some(Err(ical::Failure::Net)) => {}
                        None => {
                            c.ical_text = None;
                            c.ical_bad = true;
                        }
                    }
                }
                match &c.ical_text {
                    Some(t) => Calendar {
                        access: "ok",
                        source: "ical",
                        events: ical::parse(t, from, to),
                    },
                    None if c.ical_bad => Calendar::empty("denied", "ical"),
                    None => Calendar::empty("unknown", "ical"),
                }
            }
            "outlook" => {
                #[cfg(windows)]
                {
                    use crate::outlook;
                    let cold = c
                        .outlook_at
                        .is_none_or(|t| t.elapsed() >= OUTLOOK_COLD_EVERY);
                    if refetch || outlook::running() || cold {
                        c.outlook_at = Some(Instant::now());
                        match outlook::read(from, to) {
                            Ok(ev) => c.outlook = Some(ev),
                            Err(outlook::Failure::Missing) => {
                                c.outlook = None;
                                return Calendar::empty("denied", "outlook");
                            }
                            Err(outlook::Failure::Busy(e)) => eprintln!("[calendar] outlook: {e}"),
                        }
                    }
                    match &c.outlook {
                        Some(ev) => Calendar {
                            access: "ok",
                            source: "outlook",
                            events: keep(ev),
                        },
                        None => Calendar::empty("unknown", "outlook"),
                    }
                }
                #[cfg(not(windows))]
                {
                    let _ = (&keep, OUTLOOK_COLD_EVERY);
                    Calendar::empty("denied", "outlook")
                }
            }
            _ => Calendar::empty("off", "none"),
        }
    }

    pub fn start(emit: impl Fn(&Calendar) + Send + 'static) {
        let (tx, rx) = channel::<bool>();
        *POKE.lock().unwrap() = Some(tx);
        thread::spawn(move || {
            #[cfg(windows)]
            let _com = com_sta();
            let mut cache = Cache::default();
            let mut last: Option<Calendar> = None;
            let mut refetch = false;
            loop {
                // switched off: read nothing, as if no source were picked
                let src = if crate::modules::is_on("cal") {
                    source()
                } else {
                    "off".into()
                };
                if src != "ical" {
                    cache.ical_text = None;
                    cache.ical_at = None;
                }
                let cal = step(&src, &mut cache, refetch);
                if last.as_ref() != Some(&cal) {
                    emit(&cal);
                    last = Some(cal);
                }
                refetch = match rx.recv_timeout(PERIOD) {
                    Ok(r) => r,
                    Err(RecvTimeoutError::Timeout) => false,
                    Err(RecvTimeoutError::Disconnected) => return,
                };
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use mac::poke;
#[cfg(not(target_os = "macos"))]
pub fn poke() {
    choice::poke(false);
}

#[cfg(target_os = "macos")]
pub use mac::{open_access, start};

#[cfg(target_os = "macos")]
mod mac {
    use super::{Calendar, Event};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::{sel, AnyThread};
    use objc2_event_kit::{
        EKAuthorizationStatus, EKEntityType, EKEventStatus, EKEventStore, EKParticipantStatus,
    };
    use objc2_foundation::{NSDate, NSError, NSObjectProtocol};

    const PERIOD: Duration = Duration::from_secs(30);
    /// A call that started this long ago is still "now" in the card.
    const BEHIND_S: f64 = 60.0 * 60.0;
    const AHEAD_S: f64 = 48.0 * 3600.0;

    /// Wakes the reader early: access granted, tray item.
    static POKE: Mutex<Option<Sender<()>>> = Mutex::new(None);

    fn status() -> EKAuthorizationStatus {
        // SAFETY: class method without arguments besides a plain enum.
        unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) }
    }

    fn access() -> &'static str {
        match status() {
            EKAuthorizationStatus::FullAccess => "ok",
            EKAuthorizationStatus::NotDetermined => "unknown",
            _ => "denied",
        }
    }

    /// Shows the system prompt the first time; afterwards the answer stays in System Settings.
    fn request_access() {
        if status() != EKAuthorizationStatus::NotDetermined {
            poke();
            return;
        }
        let store = new_store();
        let done = RcBlock::new(|granted: Bool, _err: *mut NSError| {
            eprintln!("[calendar] access granted: {}", granted.as_bool());
            poke();
        });
        // SAFETY: the block lives until EventKit has copied it; the store is kept alive by the call.
        unsafe {
            if store.respondsToSelector(sel!(requestFullAccessToEventsWithCompletion:)) {
                store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&done));
            } else {
                #[allow(deprecated)]
                store.requestAccessToEntityType_completion(
                    EKEntityType::Event,
                    RcBlock::as_ptr(&done),
                );
            }
        }
    }

    /// Tray: ask if never asked; once refused, only System Settings can change it.
    pub fn open_access() {
        if status() == EKAuthorizationStatus::NotDetermined {
            request_access();
        } else {
            let _ = std::process::Command::new("/usr/bin/open")
                .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")
                .status();
            poke();
        }
    }

    pub fn poke() {
        if let Some(tx) = POKE.lock().unwrap().as_ref() {
            let _ = tx.send(());
        }
    }

    fn new_store() -> Retained<EKEventStore> {
        // SAFETY: plain init.
        unsafe { EKEventStore::init(EKEventStore::alloc()) }
    }

    fn read(store: &EKEventStore) -> Vec<Event> {
        let now = NSDate::now();
        let t0 = now.timeIntervalSince1970();
        let mut out = Vec::new();
        // SAFETY: EventKit calls with valid dates; the returned objects are retained.
        unsafe {
            store.refreshSourcesIfNecessary();
            let from = NSDate::dateWithTimeIntervalSinceNow(-BEHIND_S);
            let to = NSDate::dateWithTimeIntervalSinceNow(AHEAD_S);
            let pred = store.predicateForEventsWithStartDate_endDate_calendars(&from, &to, None);
            for ev in store.eventsMatchingPredicate(&pred).iter() {
                if ev.isAllDay() || ev.status() == EKEventStatus::Canceled {
                    continue;
                }
                let declined = ev.attendees().is_some_and(|a| {
                    a.iter().any(|p| {
                        p.isCurrentUser() && p.participantStatus() == EKParticipantStatus::Declined
                    })
                });
                if declined {
                    continue;
                }
                let start = ev.startDate().timeIntervalSince1970();
                let end = ev.endDate().timeIntervalSince1970();
                if end <= t0 {
                    continue;
                }
                out.push(Event {
                    title: ev.title().to_string(),
                    start: start * 1000.0,
                    end: end * 1000.0,
                });
            }
        }
        out.sort_by(|a, b| a.start.total_cmp(&b.start));
        out
    }

    pub fn start(emit: impl Fn(&Calendar) + Send + 'static) {
        let (tx, rx) = channel();
        *POKE.lock().unwrap() = Some(tx);
        thread::spawn(move || {
            let mut store: Option<Retained<EKEventStore>> = None;
            let mut last: Option<Calendar> = None;
            loop {
                let access = access();
                let cal = if !crate::modules::is_on("cal") {
                    // switched off in settings: no reading
                    store = None;
                    Calendar::empty("off", "none")
                } else if access == "ok" {
                    // a store made before access was granted stays empty; make it after
                    let st = store.get_or_insert_with(new_store);
                    Calendar {
                        access,
                        source: "system",
                        events: read(st),
                    }
                } else {
                    store = None;
                    Calendar::empty(access, "system")
                };
                if last.as_ref() != Some(&cal) {
                    emit(&cal);
                    last = Some(cal);
                }
                match rx.recv_timeout(PERIOD) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        });
        request_access();
    }
}
