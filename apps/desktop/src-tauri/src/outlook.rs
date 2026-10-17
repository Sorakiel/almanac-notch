//! Classic Outlook on Windows (stage 7): the default calendar through Outlook's COM object
//! model, late-bound (IDispatch). Nothing leaves the machine; only title and times are read.
//! The new Outlook (a web app) has no COM model; then `Missing` and the settings say so.

use std::mem::ManuallyDrop;

use chrono::{Duration as Span, Local, NaiveDate, NaiveDateTime, TimeZone};
use windows::core::{IUnknown, Interface, BSTR, GUID, HSTRING, PCWSTR};
use windows::Win32::Foundation::{SYSTEMTIME, VARIANT_BOOL};
use windows::Win32::Globalization::{
    GetDateFormatEx, GetTimeFormatEx, DATE_SHORTDATE, TIME_NOSECONDS,
};
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, IDispatch, CLSCTX_LOCAL_SERVER, DISPATCH_FLAGS,
    DISPATCH_METHOD, DISPATCH_PROPERTYGET, DISPATCH_PROPERTYPUT, DISPPARAMS,
};
use windows::Win32::System::Ole::{GetActiveObject, DISPID_PROPERTYPUT};
use windows::Win32::System::Variant::{
    VariantChangeType, VariantClear, VARENUM, VARIANT, VAR_CHANGE_FLAGS, VT_BOOL, VT_BSTR, VT_DATE,
    VT_DISPATCH, VT_I4,
};

use crate::calendar::Event;

/// olFolderCalendar
const FOLDER_CALENDAR: i32 = 9;
/// olMeetingCanceled, olMeetingReceivedAndCanceled
const CANCELED: [i32; 2] = [5, 7];
/// olResponseDeclined
const DECLINED: i32 = 4;
const MAX_ITEMS: usize = 100;

#[derive(Debug)]
pub enum Failure {
    /// No classic Outlook registered on this machine.
    Missing,
    /// Outlook is there but the read failed (profile dialog, busy, closed mid-read).
    Busy(String),
}

/// Owns a VARIANT and clears it (releases BSTRs and interfaces) on drop.
struct Var(VARIANT);

impl Drop for Var {
    fn drop(&mut self) {
        // SAFETY: a VARIANT we own.
        unsafe {
            let _ = VariantClear(&mut self.0);
        }
    }
}

impl Var {
    fn vt(&self) -> VARENUM {
        // SAFETY: reading the tag of an initialised VARIANT.
        unsafe { self.0.Anonymous.Anonymous.vt }
    }
    fn bstr(s: &str) -> Var {
        let mut v = VARIANT::default();
        // SAFETY: tag and payload set together.
        unsafe {
            let inner = &mut *v.Anonymous.Anonymous;
            inner.vt = VT_BSTR;
            inner.Anonymous.bstrVal = ManuallyDrop::new(BSTR::from(s));
        }
        Var(v)
    }
    fn i4(n: i32) -> Var {
        let mut v = VARIANT::default();
        // SAFETY: as above.
        unsafe {
            let inner = &mut *v.Anonymous.Anonymous;
            inner.vt = VT_I4;
            inner.Anonymous.lVal = n;
        }
        Var(v)
    }
    fn boolean(b: bool) -> Var {
        let mut v = VARIANT::default();
        // SAFETY: as above.
        unsafe {
            let inner = &mut *v.Anonymous.Anonymous;
            inner.vt = VT_BOOL;
            inner.Anonymous.boolVal = VARIANT_BOOL(if b { -1 } else { 0 });
        }
        Var(v)
    }
    fn dispatch(&self) -> Option<Disp> {
        if self.vt() != VT_DISPATCH {
            return None;
        }
        // SAFETY: tag checked; clone adds a reference.
        unsafe {
            (*self.0.Anonymous.Anonymous.Anonymous.pdispVal)
                .clone()
                .map(Disp)
        }
    }
    fn coerce(&self, vt: VARENUM) -> Option<Var> {
        let mut out = VARIANT::default();
        // SAFETY: converts into a fresh VARIANT we then own.
        unsafe { VariantChangeType(&mut out, &self.0, VAR_CHANGE_FLAGS(0), vt).ok()? };
        Some(Var(out))
    }
    fn text(&self) -> String {
        match self.coerce(VT_BSTR) {
            // SAFETY: tag is VT_BSTR after the conversion.
            Some(v) => unsafe { v.0.Anonymous.Anonymous.Anonymous.bstrVal.to_string() },
            None => String::new(),
        }
    }
    fn int(&self) -> i32 {
        // SAFETY: tag is VT_I4 after the conversion.
        self.coerce(VT_I4)
            .map(|v| unsafe { v.0.Anonymous.Anonymous.Anonymous.lVal })
            .unwrap_or(0)
    }
    fn flag(&self) -> bool {
        // SAFETY: tag is VT_BOOL after the conversion.
        self.coerce(VT_BOOL)
            .map(|v| unsafe { v.0.Anonymous.Anonymous.Anonymous.boolVal.0 != 0 })
            .unwrap_or(false)
    }
    /// OLE automation date (local wall clock) -> epoch ms
    fn date_ms(&self) -> Option<f64> {
        let v = self.coerce(VT_DATE)?;
        // SAFETY: tag is VT_DATE after the conversion.
        let days = unsafe { v.0.Anonymous.Anonymous.Anonymous.date };
        let base = NaiveDate::from_ymd_opt(1899, 12, 30)?.and_hms_opt(0, 0, 0)?;
        let wall = base + Span::milliseconds((days * 86_400_000.0).round() as i64);
        Local
            .from_local_datetime(&wall)
            .earliest()
            .map(|t| t.timestamp_millis() as f64)
    }
}

struct Disp(IDispatch);

impl Disp {
    fn invoke(
        &self,
        name: &str,
        flags: DISPATCH_FLAGS,
        mut args: Vec<Var>,
    ) -> windows::core::Result<Var> {
        let wide = HSTRING::from(name);
        let names = [PCWSTR(wide.as_ptr())];
        let mut id = 0i32;
        // SAFETY: plain IDispatch calls; `args` outlives the call; DISPPARAMS wants them reversed.
        unsafe {
            self.0
                .GetIDsOfNames(&GUID::zeroed(), names.as_ptr(), 1, 0, &mut id)?;
            args.reverse();
            let mut raw: Vec<VARIANT> = args.iter().map(|a| std::ptr::read(&a.0)).collect();
            let mut put = DISPID_PROPERTYPUT;
            let params = DISPPARAMS {
                rgvarg: raw.as_mut_ptr(),
                rgdispidNamedArgs: if flags == DISPATCH_PROPERTYPUT {
                    &mut put
                } else {
                    std::ptr::null_mut()
                },
                cArgs: raw.len() as u32,
                cNamedArgs: u32::from(flags == DISPATCH_PROPERTYPUT),
            };
            let mut result = VARIANT::default();
            let r = self.0.Invoke(
                id,
                &GUID::zeroed(),
                0,
                flags,
                &params,
                Some(&mut result),
                None,
                None,
            );
            // `raw` are bitwise copies of `args` (VARIANT has no Drop): only `args` frees them
            drop(raw);
            r?;
            Ok(Var(result))
        }
    }
    fn get(&self, name: &str) -> windows::core::Result<Var> {
        self.invoke(name, DISPATCH_PROPERTYGET, Vec::new())
    }
    fn call(&self, name: &str, args: Vec<Var>) -> windows::core::Result<Var> {
        self.invoke(name, DISPATCH_METHOD, args)
    }
    fn put(&self, name: &str, v: Var) -> windows::core::Result<()> {
        self.invoke(name, DISPATCH_PROPERTYPUT, vec![v]).map(|_| ())
    }
    fn child(&self, v: windows::core::Result<Var>) -> Result<Disp, Failure> {
        v.map_err(|e| Failure::Busy(e.message()))?
            .dispatch()
            .ok_or_else(|| Failure::Busy("not an object".into()))
    }
}

fn clsid() -> Option<GUID> {
    // SAFETY: registry lookup.
    unsafe { CLSIDFromProgID(windows::core::w!("Outlook.Application")).ok() }
}

/// Classic Outlook is registered (installed), whether or not it runs.
pub fn installed() -> bool {
    clsid().is_some()
}

/// Outlook is running now: reading then costs nothing extra.
pub fn running() -> bool {
    let Some(id) = clsid() else { return false };
    let mut unk: Option<IUnknown> = None;
    // SAFETY: out-pointer to a local.
    unsafe { GetActiveObject(&id, None, &mut unk).is_ok() && unk.is_some() }
}

/// Outlook's Restrict wants dates the way the user's locale writes them, without seconds.
fn restrict_date(ms: f64) -> String {
    let t = Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|d| d.naive_local())
        .unwrap_or(NaiveDateTime::MIN);
    use chrono::{Datelike, Timelike};
    let st = SYSTEMTIME {
        wYear: t.year() as u16,
        wMonth: t.month() as u16,
        wDayOfWeek: t.weekday().num_days_from_sunday() as u16,
        wDay: t.day() as u16,
        wHour: t.hour() as u16,
        wMinute: t.minute() as u16,
        wSecond: 0,
        wMilliseconds: 0,
    };
    let mut d = [0u16; 64];
    let mut h = [0u16; 64];
    // SAFETY: buffers sized above; null locale = the user's.
    let (nd, nh) = unsafe {
        (
            GetDateFormatEx(
                PCWSTR::null(),
                DATE_SHORTDATE,
                Some(&st),
                PCWSTR::null(),
                Some(&mut d),
                PCWSTR::null(),
            ),
            GetTimeFormatEx(
                PCWSTR::null(),
                TIME_NOSECONDS,
                Some(&st),
                PCWSTR::null(),
                Some(&mut h),
            ),
        )
    };
    let s = |b: &[u16], n: i32| String::from_utf16_lossy(&b[..(n.max(1) - 1) as usize]);
    format!("{} {}", s(&d, nd), s(&h, nh))
}

/// Timed events of the default calendar overlapping [from, to). COM must be initialised
/// (apartment-threaded) on the calling thread. Starts Outlook headless when it is not running;
/// the caller decides how often that is worth it.
pub fn read(from: f64, to: f64) -> Result<Vec<Event>, Failure> {
    let id = clsid().ok_or(Failure::Missing)?;
    // SAFETY: COM activation; an existing Outlook answers, otherwise one starts without UI.
    let app: IDispatch = unsafe { CoCreateInstance(&id, None, CLSCTX_LOCAL_SERVER) }
        .map_err(|e| Failure::Busy(e.message()))?;
    let app = Disp(
        app.cast()
            .map_err(|e: windows::core::Error| Failure::Busy(e.message()))?,
    );
    let ns = app.child(app.call("GetNamespace", vec![Var::bstr("MAPI")]))?;
    let folder = ns.child(ns.call("GetDefaultFolder", vec![Var::i4(FOLDER_CALENDAR)]))?;
    let items = folder.child(folder.get("Items"))?;
    // order matters: Sort, then IncludeRecurrences, then Restrict (Outlook docs)
    items
        .call("Sort", vec![Var::bstr("[Start]")])
        .map_err(|e| Failure::Busy(e.message()))?;
    items
        .put("IncludeRecurrences", Var::boolean(true))
        .map_err(|e| Failure::Busy(e.message()))?;
    let filter = format!(
        "[Start] < '{}' AND [End] > '{}'",
        restrict_date(to),
        restrict_date(from)
    );
    let found = items.child(items.call("Restrict", vec![Var::bstr(&filter)]))?;
    let mut out = Vec::new();
    let mut next = found
        .call("GetFirst", Vec::new())
        .ok()
        .and_then(|v| v.dispatch());
    while let Some(item) = next {
        if out.len() >= MAX_ITEMS {
            break;
        }
        let all_day = item.get("AllDayEvent").map(|v| v.flag()).unwrap_or(false);
        let status = item.get("MeetingStatus").map(|v| v.int()).unwrap_or(0);
        let response = item.get("ResponseStatus").map(|v| v.int()).unwrap_or(0);
        if !all_day && !CANCELED.contains(&status) && response != DECLINED {
            let start = item.get("Start").ok().and_then(|v| v.date_ms());
            let end = item.get("End").ok().and_then(|v| v.date_ms());
            if let (Some(start), Some(end)) = (start, end) {
                if end > from && start < to {
                    out.push(Event {
                        title: item.get("Subject").map(|v| v.text()).unwrap_or_default(),
                        start,
                        end,
                    });
                }
            }
        }
        next = found
            .call("GetNext", Vec::new())
            .ok()
            .and_then(|v| v.dispatch());
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(out)
}
