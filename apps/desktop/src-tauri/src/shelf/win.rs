//! Windows side of the shelf: files dropped through WebView2, the drag out (OLE), the letter
//! (Simple MAPI, the default mail client) and previews from the shell.
//!
//! The drop: Tauri's drag-drop handler is off for the island (lib.rs), WebView2 takes drops the
//! way Edge does and the page hands the File objects back with `postMessageWithAdditionalObjects`;
//! here they turn into real paths. Drags from the classic Explorer folder view never reach wry's
//! drop target (its inner windows belong to msedgewebview2.exe) - coucou found this, PR #240,
//! `webview_drop.rs` (MIT), which this follows.
//!
//! The drag out follows drag-rs (CrabNebula, MIT/Apache-2.0): a shell data object for the paths
//! and DoDragDrop with a minimal drop source.

use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2,
};
use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
use windows::core::{implement, BOOL, HRESULT, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, POINT, RECT, SIZE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::System::Com::{CoInitializeEx, IDataObject, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Mapi::{
    MapiFileDescW, MapiMessageW, LPMAPISENDMAILW, MAPI_DIALOG, MAPI_LOGON_UI, SUCCESS_SUCCESS,
};
use windows::Win32::System::Ole::{
    DoDragDrop, IDropSource, IDropSource_Impl, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_DataObject, ILCreateFromPathW, ILFree, IShellItemArray, IShellItemImageFactory,
    SHCreateItemFromParsingName, SHCreateShellItemArrayFromIDLists, SIIGBF_RESIZETOFIT,
    SIIGBF_THUMBNAILONLY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
use wv2_core::Interface;

use super::{add_paths, take, take_point, Item, Kind};

/// Our own drag out is under way: a drop of it back onto the island is not a new drop.
static DRAGGING_OUT: AtomicBool = AtomicBool::new(false);

fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

pub fn setup(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let result = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            eprintln!("[shelf] no webview for drops");
            return;
        };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            // Tauri's IPC comes through here too; it carries no objects
            let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
                return Ok(());
            };
            let Ok(objects) = args.AdditionalObjects() else {
                return Ok(());
            };
            let mut count = 0u32;
            objects.Count(&mut count)?;
            if count == 0 || DRAGGING_OUT.load(Ordering::Relaxed) {
                return Ok(());
            }
            let mut paths = Vec::new();
            for i in 0..count {
                let Ok(file) = objects.GetValueAtIndex(i)?.cast::<ICoreWebView2File>() else {
                    continue;
                };
                let mut path = wv2_core::PWSTR::null();
                file.Path(&mut path)?;
                paths.push(std::path::PathBuf::from(take_pwstr(path)));
            }
            let point = take_point(&app);
            add_paths(&app, paths, point);
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = core.add_WebMessageReceived(&handler, &mut token) {
            eprintln!("[shelf] cannot listen for drops: {e}");
        }
    });
    if let Err(e) = result {
        eprintln!("[shelf] drops: {e}");
    }
}

/// 1 while the left button is held: the page makes the window take the mouse near the island,
/// so the drag reaches WebView2 and its dragenter starts the carry. Windows cannot tell a file
/// drag from any other press, so never 2 here.
pub fn drag_state() -> u8 {
    // SAFETY: plain input state query.
    let down = unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } < 0;
    u8::from(down && !DRAGGING_OUT.load(Ordering::Relaxed))
}

// ---------- the drag out ----------

#[implement(IDropSource)]
struct DropSource;

#[allow(non_snake_case)]
impl IDropSource_Impl for DropSource_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() {
            DRAGDROP_S_CANCEL
        } else if (keys & MK_LBUTTON) == MODIFIERKEYS_FLAGS(0) {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// Main thread. Files by path; text and links as our .txt / .url files (OLE text would need a
/// data object of our own; a file lands everywhere a file does). Copy only: originals never move.
pub fn drag(app: &AppHandle, window: &WebviewWindow, items: Vec<Item>) {
    let Some(data) = data_object(&items) else {
        return;
    };
    let source: IDropSource = DropSource.into();
    let mut effect = DROPEFFECT::default();
    DRAGGING_OUT.store(true, Ordering::Relaxed);
    // SAFETY: OLE is initialised on the main thread by the webview; DoDragDrop runs its own loop.
    let res = unsafe { DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect) };
    DRAGGING_OUT.store(false, Ordering::Relaxed);
    let _ = app.emit("island://shelf-drag-end", ());
    if res == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE && !over_island(window) {
        take(
            app,
            &items.iter().map(|it| it.id.clone()).collect::<Vec<_>>(),
            "sent",
        );
    }
}

/// a drop back onto the island is not a send
fn over_island(window: &WebviewWindow) -> bool {
    let Ok(h) = window.hwnd() else { return false };
    let mut r = RECT::default();
    let mut p = POINT::default();
    // SAFETY: a live window of ours and local out-params.
    unsafe {
        if GetWindowRect(HWND(h.0), &mut r).is_err() || GetCursorPos(&mut p).is_err() {
            return false;
        }
    }
    p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom
}

fn data_object(items: &[Item]) -> Option<IDataObject> {
    // SAFETY: PIDLs live until freed below; the array copies what it needs.
    unsafe {
        let pidls: Vec<*mut ITEMIDLIST> = items
            .iter()
            .map(|it| ILCreateFromPathW(PCWSTR::from_raw(wide(it.path.as_os_str()).as_ptr())))
            .filter(|p| !p.is_null())
            .collect();
        if pidls.is_empty() {
            return None;
        }
        let list: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| p.cast_const()).collect();
        let arr: Option<IShellItemArray> = SHCreateShellItemArrayFromIDLists(&list).ok();
        for p in pidls {
            ILFree(Some(p));
        }
        arr?.BindToHandler(None, &BHID_DataObject).ok()
    }
}

pub fn quicklook(_app: &AppHandle, _items: Vec<Item>) {}

// ---------- the letter ----------

/// The default mail client's new message (Simple MAPI) with the files attached and text and links
/// in the body. Its own thread: some clients hold the call until the letter is sent or closed.
pub fn mail(app: &AppHandle, items: Vec<Item>) {
    let app = app.clone();
    std::thread::spawn(move || {
        // SAFETY: MAPI32.dll is the system's Simple MAPI stub; every buffer outlives the call.
        unsafe {
            let Ok(lib) = LoadLibraryW(windows::core::w!("MAPI32.DLL")) else {
                return;
            };
            let Some(f) = GetProcAddress(lib, windows::core::s!("MAPISendMailW")) else {
                return;
            };
            let send: LPMAPISENDMAILW = std::mem::transmute(f);
            let Some(send) = send else { return };
            let files: Vec<&Item> = items
                .iter()
                .filter(|it| !matches!(it.kind, Kind::Text | Kind::Link))
                .collect();
            let mut paths: Vec<Vec<u16>> =
                files.iter().map(|it| wide(it.path.as_os_str())).collect();
            let mut descs: Vec<MapiFileDescW> = paths
                .iter_mut()
                .map(|p| MapiFileDescW {
                    nPosition: u32::MAX,
                    lpszPathName: PWSTR(p.as_mut_ptr()),
                    ..Default::default()
                })
                .collect();
            let body: String = items
                .iter()
                .filter_map(|it| {
                    matches!(it.kind, Kind::Text | Kind::Link)
                        .then(|| it.text.clone())
                        .flatten()
                })
                .collect::<Vec<_>>()
                .join("\r\n\r\n");
            let mut body_w = wide(std::ffi::OsStr::new(&body));
            let msg = MapiMessageW {
                lpszNoteText: if body.is_empty() {
                    PWSTR::null()
                } else {
                    PWSTR(body_w.as_mut_ptr())
                },
                nFileCount: descs.len() as u32,
                lpFiles: if descs.is_empty() {
                    std::ptr::null_mut()
                } else {
                    descs.as_mut_ptr()
                },
                ..Default::default()
            };
            let r = send(0, 0, &msg, MAPI_DIALOG | MAPI_LOGON_UI, 0);
            if r == SUCCESS_SUCCESS {
                take(
                    &app,
                    &items.iter().map(|it| it.id.clone()).collect::<Vec<_>>(),
                    "sent",
                );
            } else {
                eprintln!("[shelf] MAPISendMailW: {r}");
            }
        }
    });
}

// ---------- previews ----------

/// The shell's thumbnail (not the icon: without one the island draws its glyph), PNG.
pub fn thumb(path: &Path) -> Option<Vec<u8>> {
    // SAFETY: COM on this worker thread; the bitmap and DC are released before returning.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let p = wide(path.as_os_str());
        let f: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR::from_raw(p.as_ptr()), None).ok()?;
        let hbm = f
            .GetImage(
                SIZE { cx: 108, cy: 108 },
                SIIGBF_THUMBNAILONLY | SIIGBF_RESIZETOFIT,
            )
            .ok()?;
        let mut bm = BITMAP::default();
        GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        );
        let (w, h) = (bm.bmWidth.max(1), bm.bmHeight.max(1));
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let lines = GetDIBits(
            dc,
            hbm,
            0,
            h as u32,
            Some(px.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        if lines == 0 {
            return None;
        }
        // BGRA, premultiplied, alpha 0 everywhere for bitmaps without one
        let opaque = px.chunks(4).all(|c| c[3] == 0);
        for c in px.chunks_mut(4) {
            c.swap(0, 2);
            if opaque {
                c[3] = 255;
            } else if c[3] > 0 && c[3] < 255 {
                let a = c[3] as u32;
                for v in &mut c[..3] {
                    *v = ((*v as u32 * 255) / a).min(255) as u8;
                }
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header().ok()?.write_image_data(&px).ok()?;
        }
        Some(out)
    }
}
