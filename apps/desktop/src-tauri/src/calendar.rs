//! Calendar (stage 5): upcoming timed events from the system calendar.
//!
//! Mac: EventKit with full access to events (asked once at launch, again from the tray).
//! A thread reads the next 48 hours every 30 s and sends `island://calendar` when the list or
//! the access changed. The frontend picks the next call and counts the minutes. Only titles
//! and times leave this module; nothing goes to the network.
//! Other platforms: `{"access":"off"}`, the module stays empty (docs/DECISIONS.md).

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
    /// "ok" | "denied" | "unknown" (not asked yet) | "off" (no calendar on this platform)
    pub access: &'static str,
    pub events: Vec<Event>,
}

impl Calendar {
    fn empty(access: &'static str) -> Self {
        Calendar {
            access,
            events: Vec::new(),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start(emit: impl Fn(&Calendar) + Send + 'static) {
    emit(&Calendar::empty("off"));
}

#[cfg(not(target_os = "macos"))]
pub fn open_access() {}

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

    fn poke() {
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
                let cal = if access == "ok" {
                    // a store made before access was granted stays empty; make it after
                    let st = store.get_or_insert_with(new_store);
                    Calendar {
                        access,
                        events: read(st),
                    }
                } else {
                    store = None;
                    Calendar::empty(access)
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
