//! Settings window: a regular window with its own page (`settings.html`), opened from the
//! island's settings tab (and the tray). It takes the keyboard like any window; the island panel
//! never does. Secrets typed there go straight to Rust commands, not through the island page.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// `section`: "github", "calendar", ... - the page shown first; None keeps the current one.
pub fn open(app: &AppHandle, section: Option<&str>) {
    let app2 = app.clone();
    // only known section names reach the URL and the event
    let section = section
        .filter(|s| s.chars().all(|c| c.is_ascii_lowercase()) && !s.is_empty())
        .map(str::to_string);
    // window creation belongs to the main thread (commands may run elsewhere)
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window("settings") {
            if let Some(sec) = &section {
                let _ = w.emit("settings://section", sec);
            }
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let builder = WebviewWindowBuilder::new(
            &app2,
            "settings",
            WebviewUrl::App(
                match &section {
                    Some(sec) => format!("settings.html#{sec}"),
                    None => "settings.html".into(),
                }
                .into(),
            ),
        )
        .title("Almanac Notch")
        .inner_size(720.0, 520.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .background_color(tauri::window::Color(17, 17, 19, 255));
        // macOS: the traffic lights sit over the sidebar, no title bar strip (like System Settings)
        #[cfg(target_os = "macos")]
        let builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
        match builder.build() {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => eprintln!("[settings] window not created: {e}"),
        }
    });
}
