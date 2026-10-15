//! Settings window: a regular window with its own page (`settings.html`), opened from the
//! island's settings tab (and the tray). It takes the keyboard like any window; the island panel
//! never does. Secrets typed there go straight to Rust commands, not through the island page.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn open(app: &AppHandle) {
    let app2 = app.clone();
    // window creation belongs to the main thread (commands may run elsewhere)
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window("settings") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        match WebviewWindowBuilder::new(&app2, "settings", WebviewUrl::App("settings.html".into()))
            .title("Almanac Notch")
            .inner_size(680.0, 480.0)
            .resizable(false)
            .maximizable(false)
            .center()
            .build()
        {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => eprintln!("[settings] window not created: {e}"),
        }
    });
}
