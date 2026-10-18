//! Uninstall (stage 8g, owner 2026-10-18): the "Remove Almanac Notch?" window (`bye.html`).
//!
//! Always: our hooks leave `~/.claude/settings.json` (other hooks stay; otherwise Claude Code keeps
//! calling a deleted hook client), launch at login is turned off, the copied hook client goes.
//! With "remove settings and data": the app's folders and every secret in the Keychain /
//! Credential Manager. Then the app itself goes: Mac - the bundle to the Trash;
//! Windows - Tauri's NSIS uninstaller, run silently (files, shortcuts, the "Apps" entry).
//!
//! Windows entry points (the NSIS hooks in `windows/hooks.nsh` call them):
//! - `almanac-notch.exe --uninstall` - "Apps" and the Start menu. The process copies itself to
//!   %TEMP% and shows the window from there, so the NSIS uninstaller can delete the installed
//!   exe (and does not close our window: it closes only processes of that file).
//! - `almanac-notch.exe --cleanup` - hooks only, silent; the NSIS uninstaller runs it first.

use std::env;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use almanac_hook::{install, paths};

use crate::lang::t;

const SERVICE: &str = "dev.almanac.notch";
/// Every Keychain / Credential Manager entry the app writes (github.rs, vercel.rs, notion.rs,
/// grafana.rs, almanac.rs, calendar.rs).
const SECRETS: [&str; 7] = [
    "github-token",
    "vercel-token",
    "notion-token",
    "grafana-token",
    "grafana-url",
    "almanac-refresh",
    "calendar-ical",
];

/// What the window shows when it is done: problems that did not stop the removal.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Outcome {
    pub warnings: Vec<String>,
}

/// Our hooks out of Claude Code's settings; other hooks and settings stay as they are.
/// Ok(true) when something was removed (a backup of the file is kept next to it).
pub fn remove_hooks() -> Result<bool, String> {
    let path = paths::claude_settings();
    if !path.exists() {
        return Ok(false);
    }
    let plan = install::plan_uninstall(&path)?;
    if !plan.changed() {
        return Ok(false);
    }
    install::apply(&plan)?;
    Ok(true)
}

fn home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Everything the app (and its webviews) keeps on disk.
fn data_paths() -> Vec<PathBuf> {
    let mut v = vec![paths::app_dir()];
    if cfg!(target_os = "macos") {
        let lib = home().join("Library");
        v.push(lib.join("Caches").join(SERVICE));
        v.push(lib.join("WebKit").join(SERVICE));
        v.push(lib.join("HTTPStorages").join(SERVICE));
        v.push(lib.join("Saved Application State").join(format!("{SERVICE}.savedState")));
        v.push(lib.join("Preferences").join(format!("{SERVICE}.plist")));
    } else if cfg!(windows) {
        // the webview's folder (EBWebView) lives in Local, the app data in Roaming
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            v.push(PathBuf::from(local).join(SERVICE));
        }
    }
    v
}

fn remove_path(p: &PathBuf, warnings: &mut Vec<String>) {
    let res = if p.is_dir() {
        fs::remove_dir_all(p)
    } else if p.exists() {
        fs::remove_file(p)
    } else {
        Ok(())
    };
    if let Err(e) = res {
        warnings.push(format!("{} {}: {e}", t("Не удалось удалить", "Could not remove"), p.display()));
    }
}

fn wipe(warnings: &mut Vec<String>) {
    for name in SECRETS {
        if let Ok(e) = keyring::Entry::new(SERVICE, name) {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => warnings.push(format!(
                    "{} {name}: {err}",
                    t("Не удалось удалить секрет", "Could not remove the secret")
                )),
            }
        }
    }
    for p in data_paths() {
        remove_path(&p, warnings);
    }
    // Mac: forget the calendar permission too (it belongs to the app, not to the user's data)
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("/usr/bin/tccutil")
        .args(["reset", "All", SERVICE])
        .output();
}

/// Without "remove data": only what is not the user's - the copied hook client and the
/// connection file (settings and connections stay for a reinstall).
fn remove_client(warnings: &mut Vec<String>) {
    let dir = paths::app_dir();
    for p in [paths::installed_hook(), paths::connection_file(), dir.join("libalmanac_media.dylib")] {
        remove_path(&p, warnings);
    }
}

fn hooks_step(warnings: &mut Vec<String>) {
    if let Err(e) = remove_hooks() {
        warnings.push(format!(
            "{}: {e}. {}",
            t("Хуки Claude Code не сняты", "Claude Code hooks were not removed"),
            t(
                "Уберите записи almanac-hook из ~/.claude/settings.json вручную",
                "Remove the almanac-hook entries from ~/.claude/settings.json by hand"
            )
        ));
    }
}

// ---- the window ----------------------------------------------------------------------------

/// The confirmation window: inside the running app on Mac, the temp copy's only window on Windows.
pub fn open_window(app: &AppHandle) {
    let app2 = app.clone();
    crate::settings::on_ui(app, move || {
        if let Some(w) = app2.get_webview_window("bye") {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let builder = WebviewWindowBuilder::new(&app2, "bye", WebviewUrl::App("bye.html".into()))
            .title(t("Удалить Almanac Notch", "Uninstall Almanac Notch"))
            .inner_size(560.0, 460.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .center()
            .background_color(tauri::window::Color(7, 7, 8, 255));
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
        // Windows: frameless like the installer; the webview keeps its files in our temp folder,
        // so removing the app's data does not trip over an open webview
        #[cfg(windows)]
        let builder = builder
            .decorations(false)
            .data_directory(temp_dir().join("webview"));
        match builder.build() {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => eprintln!("[uninstall] window not created: {e}"),
        }
    });
}

#[derive(Serialize)]
pub struct ByeInfo {
    /// "mac" | "windows"
    platform: &'static str,
    lang: String,
}

#[tauri::command]
pub fn bye_info() -> ByeInfo {
    ByeInfo {
        platform: if cfg!(windows) { "windows" } else { "mac" },
        lang: crate::lang::get().lang,
    }
}

/// "Remove": everything above, then the app itself. `wipe` = "remove settings and data".
#[tauri::command]
pub async fn bye_run(app: AppHandle, wipe: bool) -> Outcome {
    let mut out = Outcome::default();
    hooks_step(&mut out.warnings);
    remove_app(&app, &mut out.warnings);
    if wipe {
        self::wipe(&mut out.warnings);
    } else {
        remove_client(&mut out.warnings);
    }
    out
}

/// "Close" after removal (or "Cancel"): `done` = the app is gone, quit for good.
#[tauri::command]
pub fn bye_quit(app: AppHandle, done: bool) {
    #[cfg(windows)]
    {
        let _ = done;
        schedule_temp_cleanup();
        app.exit(0);
    }
    #[cfg(not(windows))]
    {
        if done {
            crate::remove_hook_connection(&app);
            app.exit(0);
        } else if let Some(w) = app.get_webview_window("bye") {
            let _ = w.close();
        }
    }
}

/// The settings window's "Uninstall Almanac Notch…".
#[tauri::command]
pub fn open_bye(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        // the same path as "Apps": the temp copy's window, the island quits when NSIS removes it
        let _ = app;
        let exe = env::current_exe().map_err(|e| e.to_string())?;
        std::process::Command::new(exe)
            .arg("--uninstall")
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        open_window(&app);
        Ok(())
    }
}

// ---- Mac -----------------------------------------------------------------------------------

#[cfg(not(windows))]
fn remove_app(app: &AppHandle, warnings: &mut Vec<String>) {
    use tauri_plugin_autostart::ManagerExt;
    if let Err(e) = app.autolaunch().disable() {
        // not an error when it was never on
        if app.autolaunch().is_enabled().unwrap_or(false) {
            warnings.push(format!("{}: {e}", t("Запуск при входе не выключен", "Launch at login is still on")));
        }
    }
    #[cfg(target_os = "macos")]
    if let Err(e) = trash_bundle() {
        warnings.push(format!(
            "{}: {e}. {}",
            t("Приложение не перенесено в Корзину", "The app was not moved to the Trash"),
            t("Перетащите его в Корзину сами", "Drag it to the Trash yourself")
        ));
    }
}

#[cfg(target_os = "macos")]
fn trash_bundle() -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|x| x == "app"))
        .ok_or_else(|| t("приложение запущено не из .app", "the app is not running from an .app").to_string())?;
    let path = NSString::from_str(&bundle.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

// ---- Windows -------------------------------------------------------------------------------

/// The uninstall window's own folder in %TEMP%: the copied exe and its webview data.
#[cfg(windows)]
fn temp_dir() -> PathBuf {
    env::temp_dir().join("Almanac Notch Uninstall")
}

#[cfg(windows)]
struct InstallDir(PathBuf);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn reg_delete(args: &[&str]) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("reg")
        .arg("delete")
        .args(args)
        .arg("/f")
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(windows)]
fn remove_app(app: &AppHandle, warnings: &mut Vec<String>) {
    use std::os::windows::process::CommandExt;
    let dir = app.state::<InstallDir>().0.clone();
    let un = dir.join("uninstall.exe");
    if un.exists() {
        // `_?=` runs it in place and waits (without it NSIS copies itself to %TEMP% and returns at
        // once); the path must be the last argument and unquoted, hence raw_arg
        let status = std::process::Command::new(&un)
            .raw_arg("/S")
            .raw_arg(format!("_?={}", dir.display()))
            .status();
        match status {
            Ok(s) if s.success() => {}
            Ok(s) => warnings.push(format!(
                "{} ({})",
                t("Удаление файлов не удалось", "Removing the files failed"),
                s.code().unwrap_or(-1)
            )),
            Err(e) => warnings.push(format!("{}: {e}", t("Удаление файлов не удалось", "Removing the files failed"))),
        }
        // in place it can't delete itself; the folder goes only if nothing else is in it
        let _ = fs::remove_file(&un);
        let _ = fs::remove_dir(&dir);
    } else {
        warnings.push(format!(
            "{} {}",
            t("Не найден деинсталлятор в", "No uninstaller in"),
            dir.display()
        ));
    }
    // launch at login (NSIS removes it too) and the remembered install folder
    reg_delete(&[r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "Almanac Notch"]);
    reg_delete(&[r"HKCU\Software\almanac\Almanac Notch"]);
    let _ = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\almanac"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| {
            // only our key was there: drop the empty vendor key as well
            if o.status.success() && String::from_utf8_lossy(&o.stdout).trim().lines().count() <= 1 {
                reg_delete(&[r"HKCU\Software\almanac"]);
            }
        });
}

/// After the window closes: delete the temp copy (it can't delete itself while running).
#[cfg(windows)]
fn schedule_temp_cleanup() {
    use std::os::windows::process::CommandExt;
    let dir = temp_dir();
    let _ = std::process::Command::new("cmd")
        .raw_arg(format!(
            "/c ping 127.0.0.1 -n 4 > nul & rmdir /s /q \"{}\"",
            dir.display()
        ))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// What the command line asks for, before any window exists.
pub enum Cli {
    /// the normal island
    Run,
    /// done, exit with this code
    Exit(i32),
    /// Windows: show the uninstall window for this install folder
    #[cfg_attr(not(windows), allow(dead_code))]
    Bye(PathBuf),
}

pub fn cli() -> Cli {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--cleanup") => {
            if let Err(e) = remove_hooks() {
                eprintln!("[uninstall] hooks: {e}");
            }
            Cli::Exit(0)
        }
        #[cfg(windows)]
        Some("--uninstall") => Cli::Exit(relaunch_from_temp(&args[1..])),
        #[cfg(windows)]
        Some("--uninstall-ui") => match args.get(1) {
            Some(dir) => Cli::Bye(PathBuf::from(dir)),
            None => Cli::Exit(2),
        },
        _ => Cli::Run,
    }
}

#[cfg(windows)]
fn relaunch_from_temp(rest: &[String]) -> i32 {
    use std::os::windows::process::CommandExt;
    let Ok(exe) = env::current_exe() else { return 1 };
    let Some(dir) = exe.parent().map(PathBuf::from) else { return 1 };
    let un = dir.join("uninstall.exe");
    // NSIS's own reinstall page calls UninstallString with its flags (/P, /UPDATE, _?=...):
    // hand them to uninstall.exe untouched and report its exit code
    if !rest.is_empty() {
        return std::process::Command::new(&un)
            .raw_arg(rest.join(" "))
            .status()
            .ok()
            .and_then(|s| s.code())
            .unwrap_or(1);
    }
    let tmp = temp_dir();
    let _ = fs::remove_dir_all(&tmp);
    let copy = tmp.join("almanac-notch-uninstall.exe");
    let started = fs::create_dir_all(&tmp)
        .and_then(|_| fs::copy(&exe, &copy))
        .and_then(|_| std::process::Command::new(&copy).arg("--uninstall-ui").arg(&dir).spawn());
    match started {
        Ok(_) => 0,
        // no temp folder: the standard NSIS uninstaller still removes everything
        Err(_) => std::process::Command::new(&un).spawn().map(|_| 0).unwrap_or(1),
    }
}

/// The temp copy: only the uninstall window, no island, tray or servers.
#[cfg(windows)]
pub fn run_window(dir: PathBuf, context: tauri::Context<tauri::Wry>) {
    tauri::Builder::default()
        .manage(InstallDir(dir))
        .invoke_handler(tauri::generate_handler![bye_info, bye_run, bye_quit])
        .setup(|app| {
            open_window(app.handle());
            Ok(())
        })
        .run(context)
        .expect("error while running the uninstall window");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uninstall after Claude Code changed the file since install: only our entries go.
    #[test]
    fn remove_hooks_keeps_foreign_hooks() {
        let dir = env::temp_dir().join(format!("almanac-uninstall-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        env::set_var("CLAUDE_CONFIG_DIR", &dir);
        let settings = dir.join("settings.json");
        fs::write(&settings, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        let plan = install::plan_install(&settings, &paths::installed_hook()).unwrap();
        install::apply(&plan).unwrap();
        // a foreign hook and a setting added later, next to ours
        let mut v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        v["hooks"]["Stop"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({ "hooks": [{ "type": "command", "command": "notchbuddy" }] }));
        v["theme"] = "dark".into();
        fs::write(&settings, serde_json::to_string_pretty(&v).unwrap()).unwrap();

        assert!(remove_hooks().unwrap());
        let after: serde_json::Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(!install::is_installed(&settings));
        assert_eq!(after["model"], "opus");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["hooks"]["Stop"][0]["hooks"][0]["command"], "notchbuddy");
        assert_eq!(after["hooks"].as_object().unwrap().len(), 1);
        // nothing of ours left: a second run changes nothing
        assert!(!remove_hooks().unwrap());
        let _ = fs::remove_dir_all(&dir);
    }
}
