//! Tray actions: install or remove our hooks in ~/.claude/settings.json.
//! The diff is always shown first; nothing is written without "Записать".

use std::path::PathBuf;

use almanac_hook::{install, paths};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// The hook client binary to copy: next to the app's executable (bundle), or the
/// release build of apps/desktop/hook in a dev checkout.
fn client_source() -> Option<PathBuf> {
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

pub fn run(app: &AppHandle, add: bool) {
    let settings = paths::claude_settings();
    let target = paths::installed_hook();
    let title = if add {
        "Хуки Claude Code: установка"
    } else {
        "Хуки Claude Code: удаление"
    };
    let source = if add {
        match client_source() {
            Some(s) => Some(s),
            None => {
                info(
                    app,
                    title,
                    "Не найден клиент хука almanac-hook. Собери его: npm run hook:build",
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
            "Хуки уже установлены, клиент хука обновлён."
        } else {
            "Наших хуков в settings.json нет."
        };
        return info(app, title, msg, MessageDialogKind::Info);
    }
    let text = format!(
        "Изменения в {}. Другие хуки и настройки не меняются. Перед записью будет сделан бэкап.\n\n{}",
        settings.display(),
        plan.diff
    );
    let app2 = app.clone();
    let title2 = title.to_string();
    app.dialog()
        .message(text)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Записать".into(),
            "Отмена".into(),
        ))
        .show(move |ok| {
            if !ok {
                return;
            }
            if let Some(src) = &source {
                if let Err(e) = install::copy_client(src, &target) {
                    return info(&app2, &title2, &e, MessageDialogKind::Error);
                }
            }
            match install::apply(&plan) {
                Ok(b) => {
                    let backup = b
                        .map(|p| format!("\nБэкап: {}", p.display()))
                        .unwrap_or_default();
                    let what = if source.is_some() {
                        "Хуки установлены. Новые сессии Claude Code уже их используют."
                    } else {
                        "Хуки удалены."
                    };
                    info(
                        &app2,
                        &title2,
                        &format!("{what}{backup}"),
                        MessageDialogKind::Info,
                    );
                }
                Err(e) => info(&app2, &title2, &e, MessageDialogKind::Error),
            }
        });
}
