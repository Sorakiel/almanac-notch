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
    tauri_build::build()
}
