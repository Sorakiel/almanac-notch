//! Now playing and system volume (stage 5).
//!
//! Mac: MediaRemote answers only Apple-signed clients since macOS 15.4, so the helper library
//! (`media/mediaremote.m`, built by build.rs and embedded here) runs inside `/usr/bin/perl`.
//! One long-lived process: JSON lines out (`island://media`), commands in through stdin.
//! Volume is the default output device's main volume (CoreAudio), polled once a second
//! (`island://volume`). Other platforms: nothing starts and the frontend shows an empty module.

use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::sync::Mutex;

use serde_json::Value;

/// Commands the island may send to the player.
const COMMANDS: [&str; 6] = ["toggle", "next", "prev", "seek", "shuffle", "repeat"];

pub struct Media {
    #[cfg(target_os = "macos")]
    stdin: Mutex<Option<std::process::ChildStdin>>,
}

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

impl Media {
    /// "toggle", "next", "prev", "seek <sec>", "shuffle <mode>", "repeat <mode>".
    pub fn command(&self, cmd: &str) {
        let Some(line) = parse(cmd) else { return };
        #[cfg(target_os = "macos")]
        {
            use std::io::Write;
            if let Some(w) = self.stdin.lock().unwrap().as_mut() {
                let _ = writeln!(w, "{line}");
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = line;
    }
}

/// A known command with at most one finite, non-negative number; anything else is dropped.
fn parse(cmd: &str) -> Option<String> {
    let mut parts = cmd.split(' ');
    let name = parts.next()?;
    let arg = parts.next();
    if !COMMANDS.contains(&name) || parts.next().is_some() {
        return None;
    }
    match arg {
        None => Some(name.to_string()),
        Some(a) => match a.parse::<f64>() {
            Ok(v) if v.is_finite() && v >= 0.0 => Some(format!("{name} {v}")),
            _ => None,
        },
    }
}

#[cfg(not(target_os = "macos"))]
pub fn start(_emit: Emit) -> Arc<Media> {
    Arc::new(Media {})
}

#[cfg(not(target_os = "macos"))]
pub fn set_volume(_v: f32) {}

#[cfg(target_os = "macos")]
pub use mac::{set_volume, start};

#[cfg(target_os = "macos")]
mod mac {
    use super::{Emit, Media};
    use std::fs;
    use std::io::{BufRead, BufReader};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    static HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libalmanac_media.dylib"));

    /// Loads the helper into perl and calls it; perl does nothing else.
    const SCRIPT: &str = r#"use DynaLoader;
my $l = DynaLoader::dl_load_file($ARGV[0], 0) or die DynaLoader::dl_error();
my $s = DynaLoader::dl_find_symbol($l, "almanac_media_stream") or die "no symbol";
DynaLoader::dl_install_xsub("main::stream", $s);
stream();"#;

    /// A helper that dies sooner than this after its start counts as a failure.
    const SHORT_RUN: Duration = Duration::from_secs(10);
    /// After this many failures in a row the module stays empty until the next launch.
    const MAX_FAILS: u32 = 3;

    fn install_helper() -> Option<PathBuf> {
        let dir = almanac_hook::paths::app_dir();
        fs::create_dir_all(&dir).ok()?;
        let path = dir.join("libalmanac_media.dylib");
        if fs::read(&path).ok().as_deref() != Some(HELPER) {
            // write + rename: a running helper keeps its mapped copy intact
            let tmp = dir.join("libalmanac_media.dylib.tmp");
            fs::write(&tmp, HELPER).ok()?;
            fs::rename(&tmp, &path).ok()?;
        }
        Some(path)
    }

    pub fn start(emit: Emit) -> Arc<Media> {
        let media = Arc::new(Media {
            stdin: Mutex::new(None),
        });
        let m = media.clone();
        let emit2 = emit.clone();
        thread::spawn(move || {
            let emit = emit2;
            let Some(lib) = install_helper() else {
                eprintln!("[media] helper not installed");
                emit("island://media", json!({ "off": true }));
                return;
            };
            let mut fails = 0;
            while fails < MAX_FAILS {
                let started = Instant::now();
                let child = Command::new("/usr/bin/perl")
                    .arg("-e")
                    .arg(SCRIPT)
                    .arg(&lib)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::null())
                    .spawn();
                let mut child = match child {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[media] perl: {e}");
                        break;
                    }
                };
                *m.stdin.lock().unwrap() = child.stdin.take();
                let mut got = false;
                if let Some(out) = child.stdout.take() {
                    for line in BufReader::new(out).lines() {
                        let Ok(line) = line else { break };
                        match serde_json::from_str::<Value>(&line) {
                            Ok(v) if v.get("error").is_some() => {
                                eprintln!("[media] helper: {v}");
                            }
                            Ok(v) => {
                                got = true;
                                emit("island://media", v);
                            }
                            Err(_) => {}
                        }
                    }
                }
                *m.stdin.lock().unwrap() = None;
                let _ = child.kill();
                let _ = child.wait();
                if got && started.elapsed() > SHORT_RUN {
                    fails = 0;
                } else {
                    fails += 1;
                }
                eprintln!("[media] helper exited ({fails}/{MAX_FAILS})");
                emit("island://media", json!({ "none": true }));
                thread::sleep(Duration::from_secs(2));
            }
            emit("island://media", json!({ "off": true }));
        });
        // Volume: no notification API without a run loop of our own; a 1 Hz read is cheap.
        thread::spawn(move || {
            let mut last: Option<f32> = None;
            loop {
                let v = volume();
                if v.map(|x| (x * 1000.0).round()) != last.map(|x| (x * 1000.0).round()) {
                    last = v;
                    emit("island://volume", json!(v));
                }
                thread::sleep(Duration::from_secs(1));
            }
        });
        media
    }

    // ---------- CoreAudio ----------
    #[repr(C)]
    struct Address {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            id: u32,
            addr: *const Address,
            qual_size: u32,
            qual: *const std::ffi::c_void,
            size: *mut u32,
            data: *mut std::ffi::c_void,
        ) -> i32;
        fn AudioObjectSetPropertyData(
            id: u32,
            addr: *const Address,
            qual_size: u32,
            qual: *const std::ffi::c_void,
            size: u32,
            data: *const std::ffi::c_void,
        ) -> i32;
    }

    const fn fourcc(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }
    const SYSTEM_OBJECT: u32 = 1;
    const DEFAULT_OUTPUT: Address = Address {
        selector: fourcc(b"dOut"),
        scope: fourcc(b"glob"),
        element: 0,
    };
    /// kAudioHardwareServiceDeviceProperty_VirtualMainVolume, the value the menu bar slider shows.
    const MAIN_VOLUME: Address = Address {
        selector: fourcc(b"vmvc"),
        scope: fourcc(b"outp"),
        element: 0,
    };

    fn output_device() -> Option<u32> {
        let mut dev: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        // SAFETY: plain C call with a correctly sized out-buffer.
        let err = unsafe {
            AudioObjectGetPropertyData(
                SYSTEM_OBJECT,
                &DEFAULT_OUTPUT,
                0,
                std::ptr::null(),
                &mut size,
                (&mut dev as *mut u32).cast(),
            )
        };
        (err == 0 && dev != 0).then_some(dev)
    }

    fn volume() -> Option<f32> {
        let dev = output_device()?;
        let mut v: f32 = 0.0;
        let mut size = std::mem::size_of::<f32>() as u32;
        // SAFETY: as above.
        let err = unsafe {
            AudioObjectGetPropertyData(
                dev,
                &MAIN_VOLUME,
                0,
                std::ptr::null(),
                &mut size,
                (&mut v as *mut f32).cast(),
            )
        };
        (err == 0).then_some(v.clamp(0.0, 1.0))
    }

    pub fn set_volume(v: f32) {
        let Some(dev) = output_device() else { return };
        let v = v.clamp(0.0, 1.0);
        // SAFETY: as above.
        unsafe {
            AudioObjectSetPropertyData(
                dev,
                &MAIN_VOLUME,
                0,
                std::ptr::null(),
                std::mem::size_of::<f32>() as u32,
                (&v as *const f32).cast(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_are_whitelisted() {
        assert_eq!(parse("toggle").as_deref(), Some("toggle"));
        assert_eq!(parse("seek 12.5").as_deref(), Some("seek 12.5"));
        for bad in [
            "rm -rf",
            "seek -1",
            "seek nan",
            "next now x",
            "",
            "toggle\nnext",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }
}
