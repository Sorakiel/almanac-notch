//! iCal link (stage 7): any calendar that publishes a secret .ics address - Google, Outlook.com,
//! iCloud, Yandex, Nextcloud. One GET every few minutes to the address the user pasted, nothing
//! else; the address is a secret and lives in the system credential store.
//!
//! The parser takes only what the island needs: timed events (no all-day ones), title, start,
//! end, repeats (RRULE, EXDATE, RDATE, moved instances), cancelled and - when the calendar
//! names its owner - declined ones.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use chrono::{DateTime, FixedOffset, NaiveDateTime, TimeZone, Utc};
use rrule::{RRule, Tz, Unvalidated};

use crate::calendar::{self, Event};

/// Big personal calendars run to a few MB; anything larger is not an .ics we can use.
const MAX_BYTES: u64 = 32 << 20;
/// Repeats expanded per event inside the window; a daily stand-up needs 3.
const MAX_REPEATS: u16 = 64;

#[derive(Debug, PartialEq)]
pub enum Failure {
    /// The address answered but is not a calendar (wrong link, revoked, 4xx).
    Bad(String),
    /// No answer; keep the last good copy.
    Net,
}

/// `webcal://` is the same address over https; plain http would send the secret in clear.
pub fn normalize(url: &str) -> Result<String, String> {
    let u = url.trim();
    let u = match u.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => u.to_string(),
    };
    if !u.starts_with("https://") || u.len() < 12 || u.contains(char::is_whitespace) {
        return Err(crate::lang::t(
            "Нужна ссылка https:// или webcal://",
            "The link must start with https:// or webcal://",
        )
        .into());
    }
    Ok(u)
}

pub fn fetch(url: &str) -> Result<String, Failure> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .http_status_as_error(false)
        .build()
        .new_agent();
    let mut resp = agent.get(url).call().map_err(|_| Failure::Net)?;
    let code = resp.status().as_u16();
    if code >= 500 {
        return Err(Failure::Net);
    }
    if code >= 400 {
        return Err(Failure::Bad(if crate::lang::en() {
            format!("The server answered {code}: the link is wrong or revoked")
        } else {
            format!("Сервер ответил {code}: ссылка неверна или отозвана")
        }));
    }
    let text = resp
        .body_mut()
        .with_config()
        .limit(MAX_BYTES)
        .read_to_string()
        .map_err(|_| Failure::Net)?;
    if !text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("BEGIN:VCALENDAR")
    {
        return Err(Failure::Bad(
            crate::lang::t(
                "По ссылке не календарь (нет BEGIN:VCALENDAR)",
                "The link is not a calendar (no BEGIN:VCALENDAR)",
            )
            .into(),
        ));
    }
    Ok(text)
}

// ---------- parsing ----------

struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, k: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(k))
            .map(|(_, v)| v.as_str())
    }
}

/// RFC 5545 3.1: a line starting with a space or tab continues the previous one.
fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(rest) = line.strip_prefix([' ', '\t']) {
            if let Some(last) = out.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        out.push(line.to_string());
    }
    out
}

/// NAME;P1=v;P2="v:w":value - colons inside quoted parameter values do not end the name part.
fn split_prop(line: &str) -> Option<Prop> {
    let mut quoted = false;
    let mut cut = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ':' if !quoted => {
                cut = Some(i);
                break;
            }
            _ => {}
        }
    }
    let i = cut?;
    let (head, value) = (&line[..i], &line[i + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string()))
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_string(),
    })
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') | Some('N') => out.push(' '),
                Some(x) => out.push(x),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Where a wall-clock time lives.
#[derive(Clone, Copy)]
enum Zone {
    Named(Tz),
    /// A VTIMEZONE we cannot name: its standard offset (summer time is lost).
    Fixed(FixedOffset),
}

/// Outlook.com and Exchange write Windows zone names; these are the common ones.
const WINDOWS_ZONES: [(&str, &str); 40] = [
    ("UTC", "UTC"),
    ("GMT Standard Time", "Europe/London"),
    ("Greenwich Standard Time", "Atlantic/Reykjavik"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("Central Europe Standard Time", "Europe/Budapest"),
    ("Central European Standard Time", "Europe/Warsaw"),
    ("Romance Standard Time", "Europe/Paris"),
    ("E. Europe Standard Time", "Europe/Chisinau"),
    ("FLE Standard Time", "Europe/Kiev"),
    ("GTB Standard Time", "Europe/Bucharest"),
    ("Russian Standard Time", "Europe/Moscow"),
    ("Belarus Standard Time", "Europe/Minsk"),
    ("Kaliningrad Standard Time", "Europe/Kaliningrad"),
    ("Russia Time Zone 3", "Europe/Samara"),
    ("Ekaterinburg Standard Time", "Asia/Yekaterinburg"),
    ("Omsk Standard Time", "Asia/Omsk"),
    ("N. Central Asia Standard Time", "Asia/Novosibirsk"),
    ("North Asia Standard Time", "Asia/Krasnoyarsk"),
    ("North Asia East Standard Time", "Asia/Irkutsk"),
    ("Yakutsk Standard Time", "Asia/Yakutsk"),
    ("Vladivostok Standard Time", "Asia/Vladivostok"),
    ("Magadan Standard Time", "Asia/Magadan"),
    ("Russia Time Zone 11", "Asia/Kamchatka"),
    ("Turkey Standard Time", "Europe/Istanbul"),
    ("Israel Standard Time", "Asia/Jerusalem"),
    ("Arabian Standard Time", "Asia/Dubai"),
    ("Georgian Standard Time", "Asia/Tbilisi"),
    ("Caucasus Standard Time", "Asia/Yerevan"),
    ("Central Asia Standard Time", "Asia/Almaty"),
    ("India Standard Time", "Asia/Kolkata"),
    ("China Standard Time", "Asia/Shanghai"),
    ("Singapore Standard Time", "Asia/Singapore"),
    ("Tokyo Standard Time", "Asia/Tokyo"),
    ("Korea Standard Time", "Asia/Seoul"),
    ("AUS Eastern Standard Time", "Australia/Sydney"),
    ("Eastern Standard Time", "America/New_York"),
    ("Central Standard Time", "America/Chicago"),
    ("Mountain Standard Time", "America/Denver"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("SA Pacific Standard Time", "America/Bogota"),
];

fn named(id: &str) -> Option<Tz> {
    let id = id.trim().trim_start_matches('/');
    let iana = WINDOWS_ZONES
        .iter()
        .find(|(w, _)| w.eq_ignore_ascii_case(id))
        .map_or(id, |(_, i)| *i);
    iana.parse::<chrono_tz::Tz>().ok().map(Tz::Tz)
}

/// "+0300" / "-0530" -> offset
fn offset(s: &str) -> Option<FixedOffset> {
    let s = s.trim();
    let sign = match s.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let h: i32 = s.get(1..3)?.parse().ok()?;
    let m: i32 = s.get(3..5)?.parse().ok()?;
    FixedOffset::east_opt(sign * (h * 3600 + m * 60))
}

struct Ctx {
    /// VTIMEZONE TZID -> standard offset, for zones with names we do not know
    fixed: HashMap<String, FixedOffset>,
}

impl Ctx {
    fn zone(&self, tzid: Option<&str>) -> Zone {
        match tzid {
            None => Zone::Named(Tz::LOCAL),
            Some(id) => named(id)
                .map(Zone::Named)
                .or_else(|| self.fixed.get(id).copied().map(Zone::Fixed))
                .unwrap_or(Zone::Named(Tz::LOCAL)),
        }
    }

    /// A DATE-TIME value; None for a DATE (all-day) or garbage.
    fn time(&self, value: &str, tzid: Option<&str>) -> Option<DateTime<Tz>> {
        let v = value.trim();
        if v.len() < 15 {
            return None;
        }
        if let Some(utc) = v.strip_suffix(['Z', 'z']) {
            let n = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
            return Some(Utc.from_utc_datetime(&n).with_timezone(&Tz::UTC));
        }
        let n = NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok()?;
        match self.zone(tzid) {
            Zone::Named(tz) => tz.from_local_datetime(&n).earliest(),
            Zone::Fixed(off) => off
                .from_local_datetime(&n)
                .earliest()
                .map(|d| d.with_timezone(&Tz::UTC)),
        }
    }
}

/// "P1DT2H30M", "PT45M", "P1W", "-PT5M" -> seconds
fn duration(s: &str) -> Option<i64> {
    let (neg, s) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let s = s.strip_prefix('P')?;
    let mut total = 0i64;
    let mut num = String::new();
    for c in s.chars() {
        match c {
            '0'..='9' => num.push(c),
            'T' => {}
            'W' | 'D' | 'H' | 'M' | 'S' => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match c {
                    'W' => 7 * 86400,
                    'D' => 86400,
                    'H' => 3600,
                    'M' => 60,
                    _ => 1,
                };
            }
            _ => return None,
        }
    }
    Some(if neg { -total } else { total })
}

#[derive(Default)]
struct Vevent {
    props: Vec<Prop>,
}

impl Vevent {
    fn get(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }
    fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Prop> + 'a {
        self.props.iter().filter(move |p| p.name == name)
    }
}

/// Timed events overlapping [from, to) (epoch ms), sorted by start.
pub fn parse(text: &str, from: f64, to: f64) -> Vec<Event> {
    let mut ctx = Ctx {
        fixed: HashMap::new(),
    };
    let mut events: Vec<Vevent> = Vec::new();
    let mut owner: Option<String> = None;
    // VTIMEZONE: TZID and the STANDARD part's TZOFFSETTO
    let (mut tz_id, mut in_std): (Option<String>, bool) = (None, false);
    let mut cur: Option<Vevent> = None;
    for line in unfold(text) {
        let Some(p) = split_prop(&line) else { continue };
        match (p.name.as_str(), p.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => cur = Some(Vevent::default()),
            ("END", "VEVENT") => events.extend(cur.take()),
            ("BEGIN", "VTIMEZONE") => tz_id = None,
            ("BEGIN", "STANDARD") => in_std = true,
            ("END", "STANDARD") => in_std = false,
            ("BEGIN", "VALARM") | ("END", "VALARM") => {}
            _ => {
                if let Some(ev) = cur.as_mut() {
                    ev.props.push(p);
                } else if p.name == "TZID" {
                    tz_id = Some(p.value.clone());
                } else if p.name == "TZOFFSETTO" && in_std {
                    if let (Some(id), Some(off)) = (&tz_id, offset(&p.value)) {
                        ctx.fixed.insert(id.clone(), off);
                    }
                } else if p.name == "X-WR-CALNAME" && p.value.contains('@') {
                    // Google names a primary calendar after its owner's address
                    owner = Some(p.value.trim().to_ascii_lowercase());
                }
            }
        }
    }

    let declined = |ev: &Vevent| -> bool {
        let Some(me) = &owner else { return false };
        ev.all("ATTENDEE").any(|a| {
            a.value.to_ascii_lowercase().trim_start_matches("mailto:") == me
                && a.param("PARTSTAT")
                    .is_some_and(|s| s.eq_ignore_ascii_case("DECLINED"))
        })
    };
    let cancelled = |ev: &Vevent| {
        ev.get("STATUS")
            .is_some_and(|s| s.value.eq_ignore_ascii_case("CANCELLED"))
    };
    let start_of = |ev: &Vevent| -> Option<DateTime<Tz>> {
        let p = ev.get("DTSTART")?;
        if p.param("VALUE")
            .is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
        {
            return None;
        }
        ctx.time(&p.value, p.param("TZID"))
    };
    // seconds; an event without an end is a moment
    let length = |ev: &Vevent, start: &DateTime<Tz>| -> i64 {
        if let Some(e) = ev
            .get("DTEND")
            .and_then(|p| ctx.time(&p.value, p.param("TZID")))
        {
            return (e.timestamp() - start.timestamp()).max(0);
        }
        ev.get("DURATION")
            .and_then(|p| duration(&p.value))
            .unwrap_or(0)
            .max(0)
    };
    let title = |ev: &Vevent| {
        ev.get("SUMMARY")
            .map(|p| unescape(&p.value))
            .unwrap_or_default()
    };

    // moved or cancelled single instances: UID -> their original starts
    let mut moved: HashMap<String, HashSet<i64>> = HashMap::new();
    for ev in &events {
        if let (Some(uid), Some(rid)) = (ev.get("UID"), ev.get("RECURRENCE-ID")) {
            if let Some(t) = ctx.time(&rid.value, rid.param("TZID")) {
                moved
                    .entry(uid.value.clone())
                    .or_default()
                    .insert(t.timestamp());
            }
        }
    }

    // the place and the call: Google puts its Meet link in X-GOOGLE-CONFERENCE and the description
    let extra = |ev: &Vevent| {
        let get = |n: &str| ev.get(n).map(|p| unescape(&p.value)).unwrap_or_default();
        let location = get("LOCATION");
        let link = calendar::call_link(&[
            &get("X-GOOGLE-CONFERENCE"),
            &get("URL"),
            &location,
            &get("DESCRIPTION"),
        ]);
        (calendar::place_of(Some(&location)), link)
    };

    let mut out = Vec::new();
    let push =
        |out: &mut Vec<Event>, t: &str, x: &(Option<String>, Option<String>), s: i64, len: i64| {
            let (start, end) = (s as f64 * 1000.0, (s + len) as f64 * 1000.0);
            if end > from && start < to {
                out.push(Event {
                    title: t.to_string(),
                    start,
                    end,
                    place: x.0.clone(),
                    link: x.1.clone(),
                });
            }
        };
    for ev in &events {
        if cancelled(ev) || declined(ev) {
            continue;
        }
        let Some(start) = start_of(ev) else { continue };
        let len = length(ev, &start);
        let t = title(ev);
        let x = extra(ev);
        let rules: Vec<&Prop> = ev.all("RRULE").collect();
        if ev.get("RECURRENCE-ID").is_some() || (rules.is_empty() && ev.get("RDATE").is_none()) {
            push(&mut out, &t, &x, start.timestamp(), len);
            continue;
        }
        let skip = ev
            .get("UID")
            .and_then(|u| moved.get(&u.value))
            .cloned()
            .unwrap_or_default();
        let mut set = rrule::RRuleSet::new(start);
        for r in &rules {
            if let Ok(rule) = r.value.parse::<RRule<Unvalidated>>() {
                if let Ok(rule) = rule.validate(start) {
                    set = set.rrule(rule);
                }
            }
        }
        for p in ev.all("RDATE").chain(ev.all("EXDATE")) {
            for v in p.value.split(',') {
                if let Some(d) = ctx.time(v, p.param("TZID")) {
                    set = if p.name == "RDATE" {
                        set.rdate(d)
                    } else {
                        set.exdate(d)
                    };
                }
            }
        }
        // from - len: an instance that began earlier may still be running
        let lo = Utc
            .timestamp_millis_opt(from as i64 - len * 1000)
            .single()
            .map(|d| d.with_timezone(&Tz::UTC));
        let hi = Utc
            .timestamp_millis_opt(to as i64)
            .single()
            .map(|d| d.with_timezone(&Tz::UTC));
        let (Some(lo), Some(hi)) = (lo, hi) else {
            continue;
        };
        let dates = set.after(lo).before(hi).all(MAX_REPEATS).dates;
        for d in dates {
            if !skip.contains(&d.timestamp()) {
                push(&mut out, &t, &x, d.timestamp(), len);
            }
        }
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(s: &str) -> f64 {
        DateTime::parse_from_rfc3339(s).unwrap().timestamp_millis() as f64
    }

    const CAL: &str = "BEGIN:VCALENDAR\r\n\
VERSION:2.0\r\n\
X-WR-CALNAME:me@example.com\r\n\
BEGIN:VTIMEZONE\r\n\
TZID:Custom Zone\r\n\
BEGIN:STANDARD\r\n\
TZOFFSETTO:+0300\r\n\
END:STANDARD\r\n\
END:VTIMEZONE\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
DTSTART;TZID=Europe/Moscow:20261012T100000\r\n\
DTEND;TZID=Europe/Moscow:20261012T101500\r\n\
RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR\r\n\
EXDATE;TZID=Europe/Moscow:20261020T100000\r\n\
SUMMARY:Стендап\\, команда\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
RECURRENCE-ID;TZID=Europe/Moscow:20261021T100000\r\n\
DTSTART;TZID=Europe/Moscow:20261021T120000\r\n\
DTEND;TZID=Europe/Moscow:20261021T121500\r\n\
SUMMARY:Стендап (перенесён)\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:one\r\n\
DTSTART:20261019T140000Z\r\n\
DURATION:PT1H\r\n\
SUMMARY:Созвон с очень длинным назва\r\n\x20нием\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:allday\r\n\
DTSTART;VALUE=DATE:20261019\r\n\
SUMMARY:Отпуск\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:cancelled\r\n\
DTSTART:20261019T150000Z\r\n\
STATUS:CANCELLED\r\n\
SUMMARY:Отменили\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:declined\r\n\
DTSTART:20261019T160000Z\r\n\
ATTENDEE;CN=Me;PARTSTAT=DECLINED:mailto:ME@example.com\r\n\
SUMMARY:Отклонил\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:win\r\n\
DTSTART;TZID=Russian Standard Time:20261019T180000\r\n\
DTEND;TZID=Russian Standard Time:20261019T190000\r\n\
SUMMARY:Outlook.com\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:fixed\r\n\
DTSTART;TZID=Custom Zone:20261019T200000\r\n\
DTEND;TZID=Custom Zone:20261019T203000\r\n\
SUMMARY:Свой пояс\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn events_in_window() {
        // Mon 19 Oct 00:00 MSK .. Thu 22 Oct 00:00 MSK
        let ev = parse(
            CAL,
            ms("2026-10-19T00:00:00+03:00"),
            ms("2026-10-22T00:00:00+03:00"),
        );
        let got: Vec<(&str, f64)> = ev.iter().map(|e| (e.title.as_str(), e.start)).collect();
        assert_eq!(
            got,
            vec![
                ("Стендап, команда", ms("2026-10-19T10:00:00+03:00")),
                (
                    "Созвон с очень длинным названием",
                    ms("2026-10-19T17:00:00+03:00")
                ),
                ("Outlook.com", ms("2026-10-19T18:00:00+03:00")),
                ("Свой пояс", ms("2026-10-19T20:00:00+03:00")),
                // 20 Oct excluded, 21 Oct moved to noon
                ("Стендап (перенесён)", ms("2026-10-21T12:00:00+03:00")),
            ]
        );
        assert_eq!(ev[0].end - ev[0].start, 15.0 * 60_000.0);
        assert_eq!(ev[1].end - ev[1].start, 3_600_000.0);
    }

    #[test]
    fn running_instance_is_kept() {
        // 10:05 MSK: the 10:00 stand-up is still on
        let ev = parse(
            CAL,
            ms("2026-10-19T10:05:00+03:00"),
            ms("2026-10-19T12:00:00+03:00"),
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].start, ms("2026-10-19T10:00:00+03:00"));
    }

    #[test]
    fn helpers() {
        assert_eq!(duration("P1DT2H30M"), Some(86400 + 9000));
        assert_eq!(duration("P1W"), Some(604800));
        assert_eq!(duration("-PT5M"), Some(-300));
        assert_eq!(
            normalize("webcal://p01.example.com/x.ics").unwrap(),
            "https://p01.example.com/x.ics"
        );
        assert!(normalize("http://example.com/x.ics").is_err());
        assert!(
            normalize("  https://calendar.google.com/calendar/ical/x/private-y/basic.ics ").is_ok()
        );
        let p = split_prop("ATTENDEE;CN=\"A: B\";PARTSTAT=ACCEPTED:mailto:a@b.c").unwrap();
        assert_eq!(
            (p.param("CN"), p.value.as_str()),
            (Some("A: B"), "mailto:a@b.c")
        );
    }
}
