//! Debug tray menu: fire any island event like the prototype's 1-0 and Q buttons,
//! and force the notch state like its "Состояние" radios. Items are forwarded to the
//! frontend as `island://debug` with the menu id ("ev:<type>" or "nstate:<state>").
//! Also: install / remove the Claude Code hooks (shows the diff first), calendar access, the
//! setup guide and, when a newer version is out, "Update to X" (stage 8f).

use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;

use tauri::{AppHandle, Emitter, Manager, Wry};

/// The state submenu's items, kept so a choice made elsewhere checks the right one.
struct Checks(Mutex<Vec<CheckMenuItem<Wry>>>);

/// The island state last picked (tray or settings window); "auto" at launch.
static STATE: Mutex<&'static str> = Mutex::new("auto");

pub fn state() -> &'static str {
    *STATE.lock().unwrap()
}

/// Tray items and the same actions from the settings window and the island (decision
/// 2026-10-15: everything in the tray is reachable without it). Unknown ids do nothing.
pub fn action(app: &AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "settings" => crate::settings::open(app, None),
        "welcome" => crate::settings::open(app, Some("welcome")),
        // install right away; progress and errors show in the settings window
        "update:install" => {
            crate::settings::open(app, Some("general"));
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::update::install(app).await;
            });
        }
        // Mac: the system access dialog; Windows: the source is picked in settings
        "calendar:access" if cfg!(target_os = "macos") => crate::calendar::open_access(),
        "calendar:access" => crate::settings::open(app, Some("calendar")),
        "hooks:install" | "hooks:uninstall" => {
            crate::claude::hooks_ui::run(app, id == "hooks:install")
        }
        _ => {
            if let Some(st) = id.strip_prefix("nstate:") {
                let Some((known, _)) = STATES.iter().find(|(s, _)| *s == st) else {
                    return;
                };
                *STATE.lock().unwrap() = known;
                // radio behaviour: exactly one state is checked
                if let Some(c) = app.try_state::<Checks>() {
                    for c in c.0.lock().unwrap().iter() {
                        let _ = c.set_checked(c.id().as_ref() == id);
                    }
                }
                let _ = app.emit("island://state", *known);
            } else if !id
                .strip_prefix("ev:")
                .is_some_and(|ev| EVENTS.iter().any(|(_, e, _)| *e == ev))
            {
                return;
            }
            let _ = app.emit("island://debug", id);
        }
    }
}

/// Prototype event buttons in order: key, event type, label (Russian, English).
const EVENTS: [(&str, &str, (&str, &str)); 11] = [
    (
        "1",
        "attention",
        ("Внимание - агент ждёт", "Attention - agent waits"),
    ),
    ("2", "working", ("Работает", "Working")),
    ("3", "thinking", ("Думает", "Thinking")),
    ("4", "searching", ("Ищет", "Searching")),
    (
        "5",
        "question",
        ("Вопрос - выбор ответа", "Question - pick an answer"),
    ),
    ("6", "ratelimit", ("Лимит", "Limit")),
    ("7", "success", ("Успех - CI прошёл", "Success - CI passed")),
    (
        "8",
        "error",
        ("Ошибка - деплой упал", "Error - deploy failed"),
    ),
    ("9", "dance", ("Праздник", "Celebration")),
    ("0", "greeting", ("Привет", "Hello")),
    ("Q", "sleep", ("Сон", "Sleep")),
];

const STATES: [(&str, (&str, &str)); 4] = [
    ("auto", ("Авто", "Auto")),
    ("closed", ("Закрыто", "Closed")),
    ("half", ("Полуоткрыто", "Half-open")),
    ("open", ("Открыто", "Open")),
];

use crate::lang::t;

fn menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, Vec<CheckMenuItem<Wry>>)> {
    let menu = Menu::new(app)?;
    // test events: development builds only, a release menu is for people
    for (key, ev, (ru, en)) in EVENTS.into_iter().filter(|_| cfg!(debug_assertions)) {
        let label = t(ru, en);
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
    if cfg!(debug_assertions) {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let mut checks: Vec<CheckMenuItem<Wry>> = Vec::new();
    let states = Submenu::new(app, t("Состояние", "State"), true)?;
    let now = state();
    for (id, (ru, en)) in STATES {
        let c = CheckMenuItem::with_id(
            app,
            format!("nstate:{id}"),
            t(ru, en),
            true,
            id == now,
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
        t("Установить хуки Claude Code…", "Install Claude Code hooks…"),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "hooks:uninstall",
        t("Удалить хуки Claude Code…", "Remove Claude Code hooks…"),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "calendar:access",
        if cfg!(target_os = "macos") {
            t("Доступ к календарю…", "Calendar access…")
        } else {
            t("Календарь…", "Calendar…")
        },
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "welcome",
        t("Мастер настройки…", "Setup guide…"),
        true,
        None::<&str>,
    )?)?;
    menu.append(&MenuItem::with_id(
        app,
        "settings",
        t("Настройки…", "Settings…"),
        true,
        Some("CmdOrCtrl+,"),
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    if let Some(v) = crate::update::available() {
        let label = format!("{} {v}", t("Обновить до", "Update to"));
        menu.append(&MenuItem::with_id(
            app,
            "update:install",
            label,
            true,
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(
        app,
        "quit",
        t("Выйти", "Quit"),
        true,
        None::<&str>,
    )?)?;
    Ok((menu, checks))
}

/// Rebuild the menu in the current language (the language was changed in settings).
pub fn relabel(app: &AppHandle) {
    let (Some(tray), Ok((menu, checks))) = (app.tray_by_id("debug"), menu(app)) else {
        return;
    };
    let _ = tray.set_menu(Some(menu));
    if let Some(c) = app.try_state::<Checks>() {
        *c.0.lock().unwrap() = checks;
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let (menu, checks) = menu(app)?;
    app.manage(Checks(Mutex::new(checks)));
    let mut tray = TrayIconBuilder::with_id("debug")
        .tooltip("Almanac Notch")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, e| action(app, e.id().as_ref()));
    // the mascot (scripts/icon.mjs): a template image on macOS, so the menu bar tints it for
    // light and dark; the light one elsewhere (dark taskbar)
    #[cfg(target_os = "macos")]
    let png: &[u8] = include_bytes!("../icons/tray-template.png");
    #[cfg(not(target_os = "macos"))]
    let png: &[u8] = include_bytes!("../icons/tray-light.png");
    match tauri::image::Image::from_bytes(png) {
        Ok(icon) => tray = tray.icon(icon).icon_as_template(cfg!(target_os = "macos")),
        Err(_) => {
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
        }
    }
    tray.build(app)?;
    Ok(())
}
