use std::env;
use std::fs;
use std::path::PathBuf;

/// The NSIS installer to embed (`ALMANAC_NSIS`, set by scripts/installer.mjs and the release
/// workflow) and the size of the installed files for the progress bar. Without them the build
/// is a demo: the window works, "Install" only plays the progress (for looking at it on a Mac).
fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    println!("cargo:rerun-if-env-changed=ALMANAC_NSIS");
    println!("cargo:rerun-if-env-changed=ALMANAC_INSTALL_BYTES");
    let payload = out.join("payload.exe");
    match env::var("ALMANAC_NSIS").ok().filter(|p| !p.is_empty()) {
        Some(p) => {
            println!("cargo:rerun-if-changed={p}");
            fs::copy(&p, &payload).unwrap_or_else(|e| panic!("ALMANAC_NSIS {p}: {e}"));
        }
        None => fs::write(&payload, b"").unwrap(),
    }
    let bytes: u64 = env::var("ALMANAC_INSTALL_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    fs::write(
        out.join("consts.rs"),
        format!("/// bytes of the installed app files\npub const INSTALL_BYTES: u64 = {bytes};\n"),
    )
    .unwrap();
    // the exe's own icon (Explorer, taskbar): the app's mascot, not tauri-build's default path
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("setup.manifest"))
        .window_icon_path("../desktop/src-tauri/icons/icon.ico");
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("tauri-build failed");
}
