//! Debug tray menu: fire any island event like the prototype's 1-0 and Q buttons,
//! and force the notch state like its "Состояние" radios. Items are forwarded to the
//! frontend as `island://debug` with the menu id ("ev:<type>" or "nstate:<state>").
//! Also: install / remove the Claude Code hooks (shows the diff first), calendar access.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Wry};

/// Prototype event buttons in order: key, event type, label.
const EVENTS: [(&str, &str, &str); 11] = [
    ("1", "attention", "Внимание - агент ждёт"),
    ("2", "working", "Работает"),
    ("3", "thinking", "Думает"),
    ("4", "searching", "Ищет"),
    ("5", "question", "Вопрос - выбор ответа"),
    ("6", "ratelimit", "Лимит"),
    ("7", "success", "Успех - CI прошёл"),
    ("8", "error", "Ошибка - деплой упал"),
    ("9", "dance", "Праздник"),
    ("0", "greeting", "Привет"),
    ("Q", "sleep", "Сон"),
];

const STATES: [(&str, &str); 4] = [
    ("auto", "Авто"),
    ("closed", "Закрыто"),
    ("half", "Полуоткрыто"),
    ("open", "Открыто"),
];

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    for (key, ev, label) in EVENTS {
        // The key works while the menu is open, like the prototype's keyboard shortcuts.
        let item =
            MenuItem::with_id(app, format!("ev:{ev}"), label, true, Some(key)).or_else(|_| {
                MenuItem::with_id(
                    app,
                    format!("ev:{ev}"),
                    format!("{key}  {label}"),
                    true,
                    None::<&str>,
                )
            })?;
        menu.append(&item)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let mut checks: Vec<CheckMenuItem<Wry>> = Vec::new();
    let states = Submenu::new(app, "Состояние", true)?;
    for (id, label) in STATES {
        let c = CheckMenuItem::with_id(
            app,
            format!("nstate:{id}"),
            label,
            true,
            id == "auto",
            None::<&str>,
        )?;
        states.append(&c)?;
        checks.push(c);
    }
    menu.append(&states)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "hooks:install",
        "Установить хуки Claude Code…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "hooks:uninstall",
        "Удалить хуки Claude Code…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "calendar:access",
        "Доступ к календарю…",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        "Выйти",
        true,
        None::<&str>,
    )?)?;

    let mut tray = TrayIconBuilder::with_id("debug")
        .tooltip("Almanac Notch")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, e| {
            let id = e.id().as_ref();
            if id == "quit" {
                app.exit(0);
                return;
            }
            if id == "calendar:access" {
                crate::calendar::open_access();
                return;
            }
            if let Some(what) = id.strip_prefix("hooks:") {
                crate::claude::hooks_ui::run(app, what == "install");
                return;
            }
            if id.starts_with("nstate:") {
                // Radio behaviour: exactly one state is checked.
                for c in &checks {
                    let _ = c.set_checked(c.id().as_ref() == id);
                }
            }
            let _ = app.emit("island://debug", id);
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
