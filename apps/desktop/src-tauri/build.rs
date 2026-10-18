use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // macOS: the now-playing helper library that runs inside /usr/bin/perl (src/media).
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("libalmanac_media.dylib");
        println!("cargo:rerun-if-changed=media/mediaremote.m");
        let status = Command::new("xcrun")
            .args(["clang", "-dynamiclib", "-fobjc-arc", "-O2", "-Wall"])
            .args(["-framework", "Foundation", "-framework", "AppKit"])
            .args(["-framework", "ImageIO", "-framework", "CoreGraphics"])
            .args([
                "-arch",
                "arm64",
                "-arch",
                "x86_64",
                "-mmacosx-version-min=12.0",
            ])
            .arg("-o")
            .arg(&out)
            .arg("media/mediaremote.m")
            .status()
            .expect("xcrun clang not found");
        assert!(status.success(), "media helper build failed");
    }
    almanac_project();
    tauri_build::build()
}

/// Almanac's project address and public (anon) key: from the environment, or from the
/// gitignored `.env.almanac` (template: `almanac-env.example`). Without them the build simply
/// has no Almanac sign-in (src/almanac.rs).
fn almanac_project() {
    println!("cargo:rerun-if-changed=.env.almanac");
    println!("cargo:rerun-if-env-changed=ALMANAC_URL");
    println!("cargo:rerun-if-env-changed=ALMANAC_KEY");
    let file = std::fs::read_to_string(".env.almanac").unwrap_or_default();
    for name in ["ALMANAC_URL", "ALMANAC_KEY"] {
        let value = env::var(name).ok().filter(|v| !v.is_empty()).or_else(|| {
            file.lines()
                .filter_map(|l| l.split_once('='))
                .find(|(k, _)| k.trim() == name)
                .map(|(_, v)| v.trim().trim_matches('"').to_owned())
        });
        if let Some(v) = value.filter(|v| !v.is_empty()) {
            println!("cargo:rustc-env={name}={v}");
        }
    }
}
