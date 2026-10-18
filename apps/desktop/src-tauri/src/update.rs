//! Updates (stage 8f, owner 2026-10-18): at launch and once a day, if the "check for updates"
//! switch is on, read `latest.json` of the newest GitHub release (the only request outside the
//! services the user connected - see ARCHITECTURE, privacy). A newer version shows up in the tray
//! and the settings window; installing downloads it, checks its signature (minisign key in
//! tauri.conf.json) and restarts. Nothing is downloaded until the user asks.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::lang::t;

#[derive(Clone, Debug, Default, Serialize)]
pub struct State {
    /// "idle" | "checking" | "latest" | "available" | "downloading" | "error"
    pub state: &'static str,
    /// the newer version, when there is one
    pub version: Option<String>,
    /// download progress 0..1
    pub progress: Option<f32>,
    pub error: Option<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    state: "idle",
    version: None,
    progress: None,
    error: None,
});
static FOUND: Mutex<Option<Update>> = Mutex::new(None);

pub fn state() -> State {
    STATE.lock().unwrap().clone()
}

/// The version on offer, for the tray item.
pub fn available() -> Option<String> {
    let s = STATE.lock().unwrap();
    (s.state == "available")
        .then(|| s.version.clone())
        .flatten()
}

fn publish(app: &AppHandle, f: impl FnOnce(&mut State)) {
    let (now, tray_changed) = {
        let mut s = STATE.lock().unwrap();
        let had = s.state == "available";
        f(&mut s);
        (s.clone(), had != (s.state == "available"))
    };
    let _ = app.emit("app://update", &now);
    if tray_changed {
        crate::tray::relabel(app);
    }
}

/// What the user reads when a check or download fails: what happened and what to do.
fn explain(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => t(
            "Нет связи с GitHub - проверьте интернет и попробуйте позже",
            "Can't reach GitHub - check the connection and try later",
        )
        .into(),
        E::Minisign(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => t(
            "Подпись обновления не сошлась - файл не установлен. Скачайте версию со страницы релизов",
            "The update's signature didn't match - nothing was installed. Download it from the releases page",
        )
        .into(),
        E::ReleaseNotFound => t(
            "На GitHub пока нет опубликованного релиза",
            "No published release on GitHub yet",
        )
        .into(),
        other => format!("{}: {other}", t("Обновление не удалось", "Update failed")),
    }
}

pub async fn check(app: AppHandle) -> State {
    if matches!(state().state, "checking" | "downloading") {
        return state();
    }
    publish(&app, |s| {
        s.state = "checking";
        s.error = None;
    });
    let found = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match found {
        Ok(Some(u)) => {
            let v = u.version.clone();
            *FOUND.lock().unwrap() = Some(u);
            publish(&app, |s| {
                s.state = "available";
                s.version = Some(v);
            });
        }
        Ok(None) => publish(&app, |s| {
            s.state = "latest";
            s.version = None;
        }),
        Err(e) => {
            eprintln!("[update] check failed: {e}");
            publish(&app, |s| {
                s.state = "error";
                s.error = Some(explain(&e));
            });
        }
    }
    state()
}

pub async fn install(app: AppHandle) -> Result<(), String> {
    let Some(u) = FOUND.lock().unwrap().clone() else {
        return Err(t("Сначала проверьте обновления", "Check for updates first").into());
    };
    publish(&app, |s| {
        s.state = "downloading";
        s.progress = Some(0.0);
        s.error = None;
    });
    let mut got = 0usize;
    let progress_app = app.clone();
    let res = u
        .download_and_install(
            move |chunk, total| {
                got += chunk;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let p = got as f32 / total as f32;
                    publish(&progress_app, |s| s.progress = Some(p.min(1.0)));
                }
            },
            || {},
        )
        .await;
    match res {
        Ok(()) => {
            crate::remove_hook_connection(&app);
            app.restart()
        }
        Err(e) => {
            eprintln!("[update] install failed: {e}");
            let msg = explain(&e);
            publish(&app, |s| {
                s.state = "available";
                s.progress = None;
                s.error = Some(msg.clone());
            });
            Err(msg)
        }
    }
}

/// Launch check (after the island settles) and one a day while the switch is on.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(20)).await;
        loop {
            if crate::prefs::get().updates && state().state != "downloading" {
                check(app.clone()).await;
            }
            tokio_sleep(Duration::from_secs(24 * 3600)).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    // a blocking sleep on the blocking pool keeps tokio out of our dependency list
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}
