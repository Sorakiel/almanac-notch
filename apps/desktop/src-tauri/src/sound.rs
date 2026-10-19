//! Quiet for the island's sounds (stage 9a, docs/CHANGES.md): true while the user is on a call -
//! something records from a microphone or a camera - and on Windows while the system itself holds
//! notifications back (presentation mode, a full-screen game or app). The island keeps showing
//! events; only the sound stays off. Asked by the island every few seconds while sound is on.

#[tauri::command]
pub fn sound_quiet() -> bool {
    imp::mic_in_use() || imp::camera_in_use() || imp::system_busy()
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;

    #[repr(C)]
    struct Addr {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const fn cc(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }
    const SYSTEM: u32 = 1;
    const GLOBAL: u32 = cc(b"glob");
    const INPUT: u32 = cc(b"inpt");

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyDataSize(
            id: u32,
            a: *const Addr,
            qs: u32,
            q: *const c_void,
            size: *mut u32,
        ) -> i32;
        fn AudioObjectGetPropertyData(
            id: u32,
            a: *const Addr,
            qs: u32,
            q: *const c_void,
            size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }
    #[link(name = "CoreMediaIO", kind = "framework")]
    extern "C" {
        fn CMIOObjectGetPropertyDataSize(
            id: u32,
            a: *const Addr,
            qs: u32,
            q: *const c_void,
            size: *mut u32,
        ) -> i32;
        fn CMIOObjectGetPropertyData(
            id: u32,
            a: *const Addr,
            qs: u32,
            q: *const c_void,
            size: u32,
            used: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }

    fn audio_ids(obj: u32, selector: u32, scope: u32) -> Option<Vec<u32>> {
        let a = Addr {
            selector,
            scope,
            element: 0,
        };
        let mut size = 0u32;
        // SAFETY: a valid address and out pointer; the list is read into a buffer of that size
        unsafe {
            if AudioObjectGetPropertyDataSize(obj, &a, 0, std::ptr::null(), &mut size) != 0 {
                return None;
            }
            let mut v = vec![0u32; size as usize / 4];
            if AudioObjectGetPropertyData(
                obj,
                &a,
                0,
                std::ptr::null(),
                &mut size,
                v.as_mut_ptr().cast(),
            ) != 0
            {
                return None;
            }
            v.truncate(size as usize / 4);
            Some(v)
        }
    }

    fn audio_u32(obj: u32, selector: u32, scope: u32) -> Option<u32> {
        let a = Addr {
            selector,
            scope,
            element: 0,
        };
        let (mut v, mut size) = (0u32, 4u32);
        // SAFETY: a 4-byte property into a u32
        let r = unsafe {
            AudioObjectGetPropertyData(
                obj,
                &a,
                0,
                std::ptr::null(),
                &mut size,
                (&mut v as *mut u32).cast(),
            )
        };
        (r == 0).then_some(v)
    }

    extern "C" {
        fn proc_pidpath(pid: i32, buf: *mut c_void, size: u32) -> i32;
    }

    /// An app that can be on a call - not a system service listening all the time ("Hey Siri" is
    /// corespeechd, always recording) and not us. FaceTime lives in /System/Applications.
    fn caller(pid: i32) -> bool {
        if pid == std::process::id() as i32 {
            return false;
        }
        let mut buf = [0u8; 4096];
        // SAFETY: the path is written into the buffer, its length returned
        let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        let path = String::from_utf8_lossy(&buf[..n.max(0) as usize]);
        !(path.starts_with("/System/Library/")
            || path.starts_with("/usr/")
            || path.starts_with("/Library/Apple/"))
    }

    /// macOS 14.2+: any app recording input - exact. Older: an input-only device running.
    pub fn mic_in_use() -> bool {
        if let Some(procs) = audio_ids(SYSTEM, cc(b"prs#"), GLOBAL) {
            return procs.iter().any(|&p| {
                audio_u32(p, cc(b"piri"), GLOBAL) == Some(1)
                    && audio_u32(p, cc(b"ppid"), GLOBAL).is_some_and(|pid| caller(pid as i32))
            });
        }
        audio_ids(SYSTEM, cc(b"dev#"), GLOBAL)
            .unwrap_or_default()
            .into_iter()
            .any(|d| {
                let has_input = audio_ids(d, cc(b"stm#"), INPUT).is_some_and(|s| !s.is_empty());
                // a device with outputs too (headphones) also runs while music plays: input-only ones
                let has_output =
                    audio_ids(d, cc(b"stm#"), cc(b"outp")).is_some_and(|s| !s.is_empty());
                has_input && !has_output && audio_u32(d, cc(b"gone"), GLOBAL) == Some(1)
            })
    }

    pub fn camera_in_use() -> bool {
        let a = Addr {
            selector: cc(b"dev#"),
            scope: GLOBAL,
            element: 0,
        };
        let mut size = 0u32;
        // SAFETY: as for CoreAudio - the device list into a buffer of the reported size
        let devices = unsafe {
            if CMIOObjectGetPropertyDataSize(SYSTEM, &a, 0, std::ptr::null(), &mut size) != 0 {
                return false;
            }
            let mut v = vec![0u32; size as usize / 4];
            let mut used = 0u32;
            if CMIOObjectGetPropertyData(
                SYSTEM,
                &a,
                0,
                std::ptr::null(),
                size,
                &mut used,
                v.as_mut_ptr().cast(),
            ) != 0
            {
                return false;
            }
            v.truncate(used as usize / 4);
            v
        };
        devices.into_iter().any(|d| {
            let a = Addr {
                selector: cc(b"gone"),
                scope: GLOBAL,
                element: 0,
            };
            let (mut on, mut used) = (0u32, 0u32);
            // SAFETY: a 4-byte property into a u32
            let r = unsafe {
                CMIOObjectGetPropertyData(
                    d,
                    &a,
                    0,
                    std::ptr::null(),
                    4,
                    &mut used,
                    (&mut on as *mut u32).cast(),
                )
            };
            r == 0 && on != 0
        })
    }

    #[cfg(test)]
    pub fn debug_inputs() {
        for p in audio_ids(SYSTEM, cc(b"prs#"), GLOBAL).unwrap_or_default() {
            if audio_u32(p, cc(b"piri"), GLOBAL) == Some(1) {
                println!("input pid {:?}", audio_u32(p, cc(b"ppid"), GLOBAL));
            }
        }
    }

    /// Focus / Do not disturb has no public API without an Apple developer account.
    pub fn system_busy() -> bool {
        false
    }
}

#[cfg(windows)]
mod imp {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ,
    };
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    fn open(parent: HKEY, path: PCWSTR) -> Option<HKEY> {
        let mut k = HKEY::default();
        // SAFETY: reading a key under the user's hive
        unsafe { RegOpenKeyExW(parent, path, None, KEY_READ, &mut k) }
            .is_ok()
            .then_some(k)
    }

    fn qword(k: HKEY, name: PCWSTR) -> Option<u64> {
        let (mut v, mut size) = (0u64, 8u32);
        // SAFETY: an 8-byte REG_QWORD into a u64
        unsafe {
            RegQueryValueExW(
                k,
                name,
                None,
                None,
                Some((&mut v as *mut u64).cast()),
                Some(&mut size),
            )
        }
        .is_ok()
        .then_some(v)
    }

    /// Windows records each app's use of a device: a start time without a stop time - in use now.
    fn in_use(k: HKEY) -> bool {
        matches!((qword(k, w!("LastUsedTimeStart")), qword(k, w!("LastUsedTimeStop"))), (Some(a), Some(0)) if a > 0)
    }

    /// every app's entry under the consent store (packaged apps, and NonPackaged one level deeper)
    fn any_in_use(k: HKEY, depth: u32) -> bool {
        let mut i = 0;
        loop {
            let mut name = [0u16; 512];
            let mut len = name.len() as u32;
            // SAFETY: enumerating subkey names into a fixed buffer
            if unsafe {
                RegEnumKeyExW(
                    k,
                    i,
                    Some(windows::core::PWSTR(name.as_mut_ptr())),
                    &mut len,
                    None,
                    None,
                    None,
                    None,
                )
            }
            .is_err()
            {
                return false;
            }
            i += 1;
            if let Some(sub) = open(k, PCWSTR(name.as_ptr())) {
                let hit = in_use(sub) || (depth > 0 && any_in_use(sub, depth - 1));
                // SAFETY: closing the key opened above
                unsafe {
                    let _ = RegCloseKey(sub);
                }
                if hit {
                    return true;
                }
            }
        }
    }

    fn device(path: PCWSTR) -> bool {
        let Some(k) = open(HKEY_CURRENT_USER, path) else {
            return false;
        };
        let hit = any_in_use(k, 1);
        // SAFETY: closing the key opened above
        unsafe {
            let _ = RegCloseKey(k);
        }
        hit
    }

    pub fn mic_in_use() -> bool {
        device(w!(
            r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
        ))
    }

    pub fn camera_in_use() -> bool {
        device(w!(
            r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam"
        ))
    }

    /// The states in which Windows itself holds notifications back.
    pub fn system_busy() -> bool {
        // SAFETY: a plain query
        match unsafe { SHQueryUserNotificationState() } {
            Ok(s) => {
                s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE
            }
            Err(_) => false,
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    pub fn mic_in_use() -> bool {
        false
    }
    pub fn camera_in_use() -> bool {
        false
    }
    pub fn system_busy() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    /// Live: prints what this machine reports now (`cargo test sound_now -- --ignored --nocapture`).
    #[test]
    #[ignore]
    fn sound_now() {
        println!(
            "mic {} camera {} busy {}",
            super::imp::mic_in_use(),
            super::imp::camera_in_use(),
            super::imp::system_busy()
        );
        #[cfg(target_os = "macos")]
        super::imp::debug_inputs();
    }
}
