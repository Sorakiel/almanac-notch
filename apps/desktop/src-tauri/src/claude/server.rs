//! Local HTTP endpoint for the hook client: 127.0.0.1 only, random port, per-launch token.
//!
//! Hardening, since any local process and any web page can reach a localhost port:
//! - the token (32 random bytes) lives only in a 0600 file in the app dir and in memory;
//!   it is compared in constant time;
//! - requests with an Origin header (browsers always send one on cross-site POST) and
//!   requests whose Host is not our loopback address (DNS rebinding) are refused;
//! - headers are capped at 16 KB, bodies at 1 MB, reads time out after 5 s, and at most
//!   64 connections are served at once.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use almanac_hook::{paths, TOKEN_HEADER};
use serde_json::{json, Value};

const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 1 << 20;
const MAX_CONNS: usize = 64;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Called with a parsed hook payload and a probe "is the hook client still there";
/// returns the JSON body for the hook client ("" = no decision). May block while the
/// island waits for the user.
pub type Handler = Arc<dyn Fn(Value, &dyn Fn() -> bool) -> String + Send + Sync>;

/// Claude Code kills a hook whose decision is no longer needed (the user answered in the
/// terminal or the Desktop prompt), which closes our socket: peek sees EOF.
fn client_alive(s: &TcpStream) -> bool {
    if s.set_nonblocking(true).is_err() {
        return true;
    }
    let r = s.peek(&mut [0u8; 1]);
    let _ = s.set_nonblocking(false);
    match r {
        Ok(0) => false,
        Ok(_) => true,
        Err(e) => e.kind() == std::io::ErrorKind::WouldBlock,
    }
}

pub struct Server {
    pub port: u16,
}

fn token() -> Result<String, String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|e| e.to_string())?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Write {port, token, pid} readable by this user only.
fn write_connection_file(port: u16, token: &str) -> Result<(), String> {
    let dir = paths::app_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = paths::connection_file();
    let tmp = path.with_extension("tmp");
    let body = json!({ "port": port, "token": token, "pid": std::process::id() }).to_string();
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        opts.mode(0o600);
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
    f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    drop(f);
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Remove the connection file if it is still ours (another instance may have replaced it).
pub fn remove_connection_file(port: u16) {
    let path = paths::connection_file();
    let ours = fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .is_some_and(|v| v.get("port").and_then(Value::as_u64) == Some(u64::from(port)));
    if ours {
        let _ = fs::remove_file(path);
    }
}

pub fn start(handler: Handler) -> Result<Server, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = Arc::new(token()?);
    write_connection_file(port, &token)?;
    let active = Arc::new(AtomicUsize::new(0));
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if active.load(Ordering::SeqCst) >= MAX_CONNS {
                let _ = respond(stream, 503, "");
                continue;
            }
            active.fetch_add(1, Ordering::SeqCst);
            let (handler, token, active) = (handler.clone(), token.clone(), active.clone());
            thread::spawn(move || {
                serve(stream, port, &token, &handler);
                active.fetch_sub(1, Ordering::SeqCst);
            });
        }
    });
    Ok(Server { port })
}

fn respond(mut s: TcpStream, code: u16, body: &str) -> std::io::Result<()> {
    let reason = match code {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Service Unavailable",
    };
    let _ = s.set_write_timeout(Some(IO_TIMEOUT));
    write!(
        s,
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn serve(stream: TcpStream, port: u16, token: &str, handler: &Handler) {
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut r = BufReader::new(read_half.take((MAX_HEAD + MAX_BODY) as u64));
    let mut line = String::new();
    if r.read_line(&mut line).is_err() {
        return;
    }
    let request_line = line.trim_end().to_string();
    let mut head_len = line.len();
    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        line.clear();
        match r.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(n) => head_len += n,
        }
        if head_len > MAX_HEAD {
            let _ = respond(stream, 413, "");
            return;
        }
        let l = line.trim_end();
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    if request_line != "POST /hook HTTP/1.1" {
        let _ = respond(stream, 404, "");
        return;
    }
    let host_ok = headers
        .get("host")
        .is_some_and(|h| *h == format!("127.0.0.1:{port}") || *h == format!("localhost:{port}"));
    let token_ok = headers
        .get(&TOKEN_HEADER.to_ascii_lowercase())
        .is_some_and(|t| same(t.as_bytes(), token.as_bytes()));
    if !host_ok || !token_ok || headers.contains_key("origin") {
        let _ = respond(stream, 403, "");
        return;
    }
    let len: usize = match headers.get("content-length").and_then(|v| v.parse().ok()) {
        Some(n) if n <= MAX_BODY => n,
        _ => {
            let _ = respond(stream, 413, "");
            return;
        }
    };
    let mut body = vec![0u8; len];
    if r.read_exact(&mut body).is_err() {
        let _ = respond(stream, 400, "");
        return;
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&body) else {
        let _ = respond(stream, 400, "");
        return;
    };
    let answer = handler(payload, &|| client_alive(&stream));
    let _ = respond(stream, 200, &answer);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send(port: u16, extra: &str, body: &str) -> String {
        let mut s = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        write!(
            s,
            "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra}Content-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn token_origin_and_body_checks() {
        let dir = std::env::temp_dir().join(format!("almanac-srv-{}", std::process::id()));
        std::env::set_var("HOME", &dir);
        std::env::set_var("APPDATA", &dir);
        let srv = start(Arc::new(|v: Value, _: &dyn Fn() -> bool| {
            json!({ "echo": v["x"] }).to_string()
        }))
        .unwrap();
        let conn: Value =
            serde_json::from_str(&fs::read_to_string(paths::connection_file()).unwrap()).unwrap();
        let tok = conn["token"].as_str().unwrap().to_string();
        assert_eq!(conn["port"].as_u64(), Some(u64::from(srv.port)));

        let ok = send(
            srv.port,
            &format!("{TOKEN_HEADER}: {tok}\r\n"),
            r#"{"x":1}"#,
        );
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.ends_with(r#"{"echo":1}"#), "{ok}");

        let bad = send(
            srv.port,
            &format!("{TOKEN_HEADER}: {}\r\n", "0".repeat(64)),
            "{}",
        );
        assert!(bad.starts_with("HTTP/1.1 403"));
        let none = send(srv.port, "", "{}");
        assert!(none.starts_with("HTTP/1.1 403"));
        let web = send(
            srv.port,
            &format!("{TOKEN_HEADER}: {tok}\r\nOrigin: https://evil.example\r\n"),
            "{}",
        );
        assert!(web.starts_with("HTTP/1.1 403"));
        let junk = send(srv.port, &format!("{TOKEN_HEADER}: {tok}\r\n"), "not json");
        assert!(junk.starts_with("HTTP/1.1 400"));

        remove_connection_file(srv.port);
        assert!(!paths::connection_file().exists());
    }
}
