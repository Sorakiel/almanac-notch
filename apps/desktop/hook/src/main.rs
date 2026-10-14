//! `almanac-hook` - the command Claude Code runs for each hook.
//!
//! Hook mode (no arguments): forward the hook payload from stdin to the running app and print
//! its answer. The rule: never get in Claude Code's way. No app, no connection file, a closed
//! port, a slow or broken answer - the client prints nothing and exits 0, and Claude Code goes
//! on exactly as if there were no hook.
//!
//! `almanac-hook install [--yes]` / `uninstall [--yes]`: show the diff of ~/.claude/settings.json;
//! with --yes also write it (backup first).

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use almanac_hook::{install, is_blocking, paths, ANSWER_WAIT_SECS, TOKEN_HEADER};
use serde_json::Value;

const MAX_INPUT: u64 = 1 << 20;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Non-answering hooks: the app replies at once; a hung app costs at most this.
const QUICK_TIMEOUT: Duration = Duration::from_secs(2);

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None => {
            hook();
            ExitCode::SUCCESS
        }
        Some("install") => cli(true, args.iter().any(|a| a == "--yes")),
        Some("uninstall") => cli(false, args.iter().any(|a| a == "--yes")),
        Some(_) => {
            eprintln!("usage: almanac-hook [install|uninstall] [--yes]");
            ExitCode::from(64)
        }
    }
}

fn hook() {
    let mut input = String::new();
    if io::stdin()
        .take(MAX_INPUT)
        .read_to_string(&mut input)
        .is_err()
    {
        return;
    }
    if let Some(answer) = forward(&input) {
        let mut out = io::stdout();
        let _ = out.write_all(answer.as_bytes());
        let _ = out.flush();
    }
}

fn forward(input: &str) -> Option<String> {
    let conn: Value =
        serde_json::from_str(&std::fs::read_to_string(paths::connection_file()).ok()?).ok()?;
    let port = u16::try_from(conn.get("port")?.as_u64()?).ok()?;
    let token = conn.get("token")?.as_str()?;

    let payload: Value = serde_json::from_str(input).ok()?;
    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let tool = payload
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let wait = if is_blocking(event, tool) {
        Duration::from_secs(ANSWER_WAIT_SECS + 3)
    } else {
        QUICK_TIMEOUT
    };

    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut s = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok()?;
    s.set_read_timeout(Some(wait)).ok()?;
    s.set_write_timeout(Some(QUICK_TIMEOUT)).ok()?;
    let req = format!(
        "POST /hook HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{TOKEN_HEADER}: {token}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        input.len()
    );
    s.write_all(req.as_bytes()).ok()?;
    s.write_all(input.as_bytes()).ok()?;

    let mut resp = Vec::new();
    s.take(MAX_INPUT).read_to_end(&mut resp).ok()?;
    let resp = String::from_utf8(resp).ok()?;
    let (head, body) = resp.split_once("\r\n\r\n")?;
    if !head.starts_with("HTTP/1.1 200") {
        return None;
    }
    // Only a JSON object is a decision; anything else would be shown to Claude as text.
    let body = body.trim();
    serde_json::from_str::<Value>(body)
        .ok()
        .filter(Value::is_object)
        .map(|_| body.to_string())
}

fn cli(add: bool, yes: bool) -> ExitCode {
    let settings = paths::claude_settings();
    let target = paths::installed_hook();
    let plan = if add {
        install::plan_install(&settings, &target)
    } else {
        install::plan_uninstall(&settings)
    };
    let plan = match plan {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    if !plan.changed() {
        println!("{}: изменений нет", settings.display());
    } else {
        print!("{}", plan.diff);
    }
    if !yes {
        if plan.changed() {
            println!(
                "\nНичего не записано. Чтобы записать: almanac-hook {} --yes",
                if add { "install" } else { "uninstall" }
            );
        }
        return ExitCode::SUCCESS;
    }
    if add {
        let me: PathBuf = match std::env::current_exe() {
            Ok(p) => p,
            Err(e) => {
                eprintln!("{e}");
                return ExitCode::FAILURE;
            }
        };
        if let Err(e) = install::copy_client(&me, &target) {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
        println!("клиент хука: {}", target.display());
    }
    match install::apply(&plan) {
        Ok(Some(b)) => println!("записано, бэкап: {}", b.display()),
        Ok(None) => println!("записано"),
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
