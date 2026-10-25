//! Tray actions: install or remove our hooks in ~/.claude/settings.json.
//!
//! The dialog stays short (a full diff in an NSAlert grows past the screen and hides its
//! buttons): it says what changes, and "Показать дифф" opens the full diff in the text
//! editor, then asks again. Nothing is written without "Записать".

use std::path::{Path, PathBuf};
use std::process::Command;

use almanac_hook::{install, paths};
use tauri::AppHandle;
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

use crate::lang::{en, t};

fn write_btn() -> &'static str {
    t("Записать", "Write")
}
fn show_btn() -> &'static str {
    t("Показать дифф", "Show diff")
}
fn cancel_btn() -> &'static str {
    t("Отмена", "Cancel")
}

/// The hook client binary to copy: next to the app's executable (bundle), or the
/// release build of apps/desktop/hook in a dev checkout.
pub(crate) fn client_source() -> Option<PathBuf> {
    let name = paths::installed_hook()
        .file_name()
        .map(PathBuf::from)
        .unwrap_or_default();
    let beside = std::env::current_exe().ok()?.parent()?.join(&name);
    if beside.exists() {
        return Some(beside);
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../hook/target/release")
        .join(&name);
    dev.exists().then_some(dev)
}

fn info(app: &AppHandle, title: &str, text: &str, kind: MessageDialogKind) {
    app.dialog()
        .message(text)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

/// Save the diff next to the app data and open it in the default text editor.
fn open_diff(diff: &str) -> Result<(), String> {
    let path = paths::app_dir().join("claude-settings.diff");
    std::fs::create_dir_all(paths::app_dir()).map_err(|e| e.to_string())?;
    std::fs::write(&path, diff).map_err(|e| e.to_string())?;
    open_text(&path)
}

fn open_text(path: &Path) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg("-t");
        c
    } else if cfg!(windows) {
        Command::new("notepad")
    } else {
        Command::new("xdg-open")
    };
    cmd.arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn pressed(r: &MessageDialogResult, label: &str, std: &MessageDialogResult) -> bool {
    match r {
        MessageDialogResult::Custom(s) => s == label,
        other => other == std,
    }
}

struct Job {
    app: AppHandle,
    title: &'static str,
    plan: install::Plan,
    source: Option<PathBuf>,
    target: PathBuf,
}

fn ask(job: Job) {
    let added = job
        .plan
        .diff
        .lines()
        .filter(|l| l.starts_with("+ "))
        .count();
    let removed = job
        .plan
        .diff
        .lines()
        .filter(|l| l.starts_with("- "))
        .count();
    let what = if job.source.is_some() {
        let events: Vec<&str> = install::EVENTS.iter().map(|(e, _)| *e).collect();
        if en() {
            format!(
                "Almanac Notch hooks will be added for:\n{}.",
                events.join(", ")
            )
        } else {
            format!(
                "Добавятся хуки Almanac Notch для событий:\n{}.",
                events.join(", ")
            )
        }
    } else {
        t(
            "Удалятся хуки Almanac Notch.",
            "Almanac Notch hooks will be removed.",
        )
        .to_string()
    };
    let text = if en() {
        format!(
            "{what}\n\nFile: {}\nLines: +{added} −{removed}. Other hooks and settings stay as they are. A backup is made before writing.",
            job.plan.path.display()
        )
    } else {
        format!(
            "{what}\n\nФайл: {}\nСтрок: +{added} −{removed}. Другие хуки и настройки не меняются. Перед записью будет сделан бэкап.",
            job.plan.path.display()
        )
    };
    let dialog = job
        .app
        .dialog()
        .message(text)
        .title(job.title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            write_btn().into(),
            show_btn().into(),
            cancel_btn().into(),
        ));
    dialog.show_with_result(move |r| {
        if pressed(&r, show_btn(), &MessageDialogResult::No) {
            if let Err(e) = open_diff(&job.plan.diff) {
                return info(&job.app, job.title, &e, MessageDialogKind::Error);
            }
            return ask(job);
        }
        if !pressed(&r, write_btn(), &MessageDialogResult::Yes) {
            return;
        }
        write(job);
    });
}

fn write(job: Job) {
    if let Some(src) = &job.source {
        if let Err(e) = install::copy_client(src, &job.target) {
            return info(&job.app, job.title, &e, MessageDialogKind::Error);
        }
    }
    match install::apply(&job.plan) {
        Ok(b) => {
            let backup = b
                .map(|p| format!("\n{} {}", t("Бэкап:", "Backup:"), p.display()))
                .unwrap_or_default();
            let what = if job.source.is_some() {
                t(
                    "Хуки установлены. Новые сессии Claude Code уже их используют.",
                    "Hooks installed. New Claude Code sessions already use them.",
                )
            } else {
                t("Хуки удалены.", "Hooks removed.")
            };
            info(
                &job.app,
                job.title,
                &format!("{what}{backup}"),
                MessageDialogKind::Info,
            );
        }
        Err(e) => info(&job.app, job.title, &e, MessageDialogKind::Error),
    }
}

pub fn run(app: &AppHandle, add: bool) {
    let settings = paths::claude_settings();
    let target = paths::installed_hook();
    let title = if add {
        t("Хуки Claude Code: установка", "Claude Code hooks: install")
    } else {
        t("Хуки Claude Code: удаление", "Claude Code hooks: remove")
    };
    let source = if add {
        match client_source() {
            Some(s) => Some(s),
            None => {
                info(
                    app,
                    title,
                    t(
                        "Не найден клиент хука almanac-hook. Собери его: npm run hook:build",
                        "The almanac-hook client is missing. Build it: npm run hook:build",
                    ),
                    MessageDialogKind::Error,
                );
                return;
            }
        }
    } else {
        None
    };
    let plan = if add {
        install::plan_install(&settings, &target)
    } else {
        install::plan_uninstall(&settings)
    };
    let plan = match plan {
        Ok(p) => p,
        Err(e) => return info(app, title, &e, MessageDialogKind::Error),
    };
    // The client is refreshed even when settings already have our hooks (new build).
    if !plan.changed() {
        if let Some(src) = &source {
            if let Err(e) = install::copy_client(src, &target) {
                return info(app, title, &e, MessageDialogKind::Error);
            }
        }
        let msg = if add {
            t(
                "Хуки уже установлены, клиент хука обновлён.",
                "Hooks are already installed; the hook client is updated.",
            )
        } else {
            t(
                "Наших хуков в settings.json нет.",
                "No Almanac Notch hooks in settings.json.",
            )
        };
        return info(app, title, msg, MessageDialogKind::Info);
    }
    ask(Job {
        app: app.clone(),
        title,
        plan,
        source,
        target,
    });
}
