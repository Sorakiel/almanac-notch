//! Almanac Notch Setup.exe (stage 8g, owner 2026-10-18): our installer window in the style of the
//! first-run guide (setup.html, src/setup.ts), with Tauri's NSIS installer embedded and run
//! silently underneath (`/S /D=folder`). So removal from "Apps", the shortcuts and the updater stay
//! Tauri's tested ones; the updater finds the folder by itself (NSIS remembers it in HKCU).
//!
//! No WebView2 in the system (an old Windows 10): no window of ours is possible, so the embedded
//! NSIS installer runs as the usual wizard - it installs WebView2 itself.

// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewUrl, WebviewWindowBuilder};

include!(concat!(env!("OUT_DIR"), "/consts.rs"));

/// Tauri's NSIS installer of this very version (build.rs); empty in a demo build.
static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));

const PRODUCT: &str = "Almanac Notch";
const MAIN_EXE: &str = "almanac-notch.exe";

/// The window's language comes from the page (the system's UI language); Rust only words errors.
fn t(en: bool, ru: &'static str, en_text: &'static str) -> &'static str {
    if en {
        en_text
    } else {
        ru
    }
}

/// Our temp folder: the extracted NSIS installer and the window's webview data.
fn temp_dir() -> PathBuf {
    env::temp_dir().join("Almanac Notch Setup")
}

/// %LOCALAPPDATA%\Programs\Almanac Notch - per user, no admin rights (like VS Code, Discord...).
fn default_dir() -> PathBuf {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir)
        .join("Programs")
        .join(PRODUCT)
}

/// A picked folder gets our own subfolder, unless it already is one: picking "D:\Apps" must not
/// scatter our files among others.
fn with_app_folder(p: PathBuf) -> PathBuf {
    if p.file_name().is_some_and(|n| n == PRODUCT) {
        p
    } else {
        p.join(PRODUCT)
    }
}

#[derive(Serialize)]
struct Info {
    version: String,
    dir: String,
    /// the version already installed; its folder is kept (moving would orphan the autostart
    /// entry and the shortcuts) - the page hides "Change" then
    installed: Option<String>,
    /// the desktop shortcut switch starts as it is now (off for a new install)
    desktop: bool,
}

#[tauri::command]
fn setup_info(app: AppHandle) -> Info {
    let found = sys::installed();
    let dir = found.as_ref().map(|f| f.0.clone()).unwrap_or_else(default_dir);
    Info {
        version: app.package_info().version.to_string(),
        dir: dir.display().to_string(),
        installed: found.map(|f| f.1),
        desktop: sys::desktop_link().is_some_and(|l| l.exists()),
    }
}

#[tauri::command]
async fn setup_pick(app: AppHandle, dir: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let start = Path::new(&dir)
        .ancestors()
        .find(|p| p.is_dir())
        .map(Path::to_path_buf);
    let mut dialog = app.dialog().file();
    if let Some(s) = start {
        dialog = dialog.set_directory(s);
    }
    let picked = dialog.blocking_pick_folder()?.into_path().ok()?;
    Some(with_app_folder(picked).display().to_string())
}

/// Can we write there without admin rights? Creates the folder if needed.
fn check_writable(dir: &Path, en: bool) -> Result<(), String> {
    let probe = dir.join(".almanac-setup-probe");
    let res = fs::create_dir_all(dir).and_then(|_| fs::write(&probe, b"")).map(|_| {
        let _ = fs::remove_file(&probe);
    });
    match res {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(t(
            en,
            "В эту папку можно писать только с правами администратора - выберите другую, например в своей папке пользователя",
            "This folder needs administrator rights - pick another one, for example in your user folder",
        )
        .into()),
        Err(e) => Err(format!("{}: {e}", t(en, "Папка недоступна", "The folder is not available"))),
    }
}

#[tauri::command]
async fn setup_install(app: AppHandle, dir: String, desktop: bool, en: bool) -> Result<(), String> {
    let dir = PathBuf::from(dir.trim());
    if !dir.is_absolute() {
        return Err(t(en, "Выберите папку на диске", "Pick a folder on a disk").into());
    }
    check_writable(&dir, en)?;
    sys::install(&app, &dir, desktop, en)
}

#[tauri::command]
fn setup_open(app: AppHandle, dir: String) {
    let exe = Path::new(&dir).join(MAIN_EXE);
    if let Err(e) = std::process::Command::new(&exe).current_dir(&dir).spawn() {
        eprintln!("[setup] {} not started: {e}", exe.display());
    }
    quit(&app);
}

#[tauri::command]
fn setup_quit(app: AppHandle) {
    quit(&app);
}

fn quit(app: &AppHandle) {
    sys::schedule_temp_cleanup();
    app.exit(0);
}

fn progress(app: &AppHandle, p: f64) {
    let _ = app.emit("setup://progress", p);
}

fn main() {
    if !sys::has_webview2() {
        sys::run_wizard();
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            setup_info,
            setup_pick,
            setup_install,
            setup_open,
            setup_quit
        ])
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "setup", WebviewUrl::App("setup.html".into()))
                .title("Almanac Notch")
                .inner_size(560.0, 480.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .center()
                .background_color(tauri::window::Color(7, 7, 8, 255));
            // webview files in our temp folder, not in a leftover %LOCALAPPDATA%\<id>
            #[cfg(windows)]
            let builder = builder.data_directory(temp_dir().join("webview"));
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the installer");
}

#[cfg(windows)]
mod sys {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::time::SystemTime;

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Almanac Notch";
    const WEBVIEW2: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    fn reg_string(root: HKEY, key: &str, value: &str) -> Option<String> {
        let (key, value) = (HSTRING::from(key), HSTRING::from(value));
        let mut buf = vec![0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        let res = unsafe {
            RegGetValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR(value.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if res.is_err() {
            return None;
        }
        let len = (size as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..len.min(buf.len())]))
    }

    /// The evergreen runtime registers its version in one of these (Microsoft's documented check).
    pub fn has_webview2() -> bool {
        let keys = [
            (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2}")),
            (HKEY_LOCAL_MACHINE, format!(r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2}")),
            (HKEY_CURRENT_USER, format!(r"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW2}")),
        ];
        keys.iter().any(|(root, key)| {
            reg_string(*root, key, "pv").is_some_and(|v| !v.is_empty() && v != "0.0.0.0")
        })
    }

    /// (folder, version) of the current installation, from its "Apps" entry.
    pub fn installed() -> Option<(PathBuf, String)> {
        let dir = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "InstallLocation")?;
        let dir = PathBuf::from(dir.trim_matches('"'));
        if !dir.join(MAIN_EXE).exists() {
            return None;
        }
        let version = reg_string(HKEY_CURRENT_USER, UNINSTALL_KEY, "DisplayVersion").unwrap_or_default();
        Some((dir, version))
    }

    pub fn desktop_link() -> Option<PathBuf> {
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        unsafe {
            let p = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).ok()?;
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const _));
            s.map(|d| PathBuf::from(d).join(format!("{PRODUCT}.lnk")))
        }
    }

    fn write_payload() -> std::io::Result<PathBuf> {
        let dir = temp_dir();
        fs::create_dir_all(&dir)?;
        let path = dir.join("almanac-notch-nsis.exe");
        fs::write(&path, PAYLOAD)?;
        Ok(path)
    }

    /// Without WebView2: Tauri's own wizard (folder page included), which installs WebView2.
    pub fn run_wizard() {
        if PAYLOAD.is_empty() {
            return;
        }
        if let Ok(nsis) = write_payload() {
            let mut cmd = std::process::Command::new(nsis);
            if installed().is_none() {
                // `/D=` must be last and unquoted
                cmd.raw_arg(format!("/D={}", default_dir().display()));
            }
            let _ = cmd.spawn();
        }
    }

    /// Bytes of our files that NSIS has written since `since` (files from an earlier
    /// installation don't count, so a reinstall starts from zero too).
    fn written(dir: &Path, since: SystemTime) -> u64 {
        [MAIN_EXE, "almanac-hook.exe"]
            .iter()
            .filter_map(|f| fs::metadata(dir.join(f)).ok())
            .filter(|m| m.modified().is_ok_and(|t| t >= since))
            .map(|m| m.len())
            .sum()
    }

    pub fn install(app: &AppHandle, dir: &Path, desktop: bool, en: bool) -> Result<(), String> {
        if PAYLOAD.is_empty() {
            return Err(t(en, "В этой сборке нет установщика", "This build has no installer inside").into());
        }
        let nsis = write_payload().map_err(|e| {
            format!("{}: {e}", t(en, "Не удалось распаковать установщик", "Could not unpack the installer"))
        })?;
        let since = SystemTime::now() - Duration::from_secs(2);
        let mut cmd = std::process::Command::new(&nsis);
        cmd.raw_arg("/S");
        if !desktop {
            cmd.raw_arg("/NODESKTOP");
        }
        // `/D=` must be the last argument and unquoted, even with spaces
        cmd.raw_arg(format!("/D={}", dir.display()));
        let mut child = cmd.creation_flags(CREATE_NO_WINDOW).spawn().map_err(|e| {
            format!("{}: {e}", t(en, "Установщик не запустился", "The installer did not start"))
        })?;
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                break s;
            }
            // 0 = size unknown at build time: the bar then waits at its start
            if let Some(total) = std::num::NonZeroU64::new(INSTALL_BYTES) {
                let p = written(dir, since) as f64 / total.get() as f64;
                progress(app, (p * 0.95).min(0.95));
            }
            std::thread::sleep(Duration::from_millis(120));
        };
        let _ = fs::remove_file(&nsis);
        if !status.success() {
            return Err(format!(
                "{} ({})",
                t(
                    en,
                    "Установка не удалась. Закройте Almanac Notch, если он запущен, и попробуйте снова",
                    "Installation failed. Quit Almanac Notch if it is running and try again"
                ),
                status.code().unwrap_or(-1)
            ));
        }
        if !dir.join(MAIN_EXE).exists() {
            return Err(t(en, "Файлы не появились в папке", "The files did not appear in the folder").into());
        }
        progress(app, 1.0);
        Ok(())
    }

    /// The temp folder can't go while we run: a short-lived cmd removes it after we exit.
    pub fn schedule_temp_cleanup() {
        let _ = std::process::Command::new("cmd")
            .raw_arg(format!(
                "/c ping 127.0.0.1 -n 4 > nul & rmdir /s /q \"{}\"",
                temp_dir().display()
            ))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

/// Mac and Linux: a demo of the window (development only; Setup.exe is a Windows program).
#[cfg(not(windows))]
mod sys {
    use super::*;

    pub fn has_webview2() -> bool {
        true
    }
    pub fn run_wizard() {}
    pub fn installed() -> Option<(PathBuf, String)> {
        env::var("ALMANAC_SETUP_DEMO_OVER")
            .ok()
            .map(|v| (default_dir(), v))
    }
    pub fn desktop_link() -> Option<PathBuf> {
        None
    }
    pub fn install(app: &AppHandle, _dir: &Path, _desktop: bool, _en: bool) -> Result<(), String> {
        let _ = PAYLOAD;
        let _ = INSTALL_BYTES;
        for i in 1..=20 {
            std::thread::sleep(Duration::from_millis(90));
            progress(app, i as f64 / 20.0 * 0.95);
        }
        progress(app, 1.0);
        Ok(())
    }
    pub fn schedule_temp_cleanup() {
        let _ = fs::remove_dir_all(temp_dir());
    }
}
