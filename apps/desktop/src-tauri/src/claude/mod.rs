//! Claude Code module: hook server, answers from the island, plan usage from local logs.
//!
//! Every hook payload goes to the frontend as `island://agent` (slimmed: no file contents,
//! no tool output). Two kinds are held until the user answers in the island or 30 s pass:
//! PermissionRequest (approve / deny a tool) and PreToolUse of AskUserQuestion (pick an
//! option). Without an answer the hook gets no decision and Claude Code shows its own prompt.

pub mod hooks_ui;
pub mod server;
pub mod usage;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How often a held hook checks that its client is still there.
const POLL: Duration = Duration::from_millis(200);

use almanac_hook::{is_blocking, ANSWER_WAIT_SECS, MAX_QUESTIONS};
use serde_json::{json, Map, Value};

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

struct Pending {
    tx: Sender<String>,
    /// session_id + agent_id: a subagent's hooks must not cancel the main agent's prompt
    who: String,
}

pub struct Hub {
    emit: Emit,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, Pending>>,
    /// full payloads of held hooks, needed to build the answer (AskUserQuestion input)
    held: Mutex<HashMap<u64, Value>>,
    wait: Duration,
    /// poked on Stop / StopFailure so the limit shows without waiting for the next scan
    pub on_turn_end: Mutex<Option<Box<dyn Fn() + Send>>>,
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

fn clip(t: &str, n: usize) -> String {
    if t.chars().count() <= n {
        t.to_string()
    } else {
        t.chars().take(n).collect::<String>() + "…"
    }
}

fn lines(t: &str) -> usize {
    if t.is_empty() {
        0
    } else {
        t.lines().count()
    }
}

/// +/- line counts of an edit, from the tool input (old_string/new_string, content, edits[]).
fn edit_counts(tool: &str, input: &Value) -> Option<(usize, usize)> {
    match tool {
        "Edit" => Some((lines(s(input, "new_string")), lines(s(input, "old_string")))),
        "Write" => Some((lines(s(input, "content")), 0)),
        "MultiEdit" => {
            let edits = input.get("edits")?.as_array()?;
            Some(edits.iter().fold((0, 0), |(p, m), e| {
                (p + lines(s(e, "new_string")), m + lines(s(e, "old_string")))
            }))
        }
        "NotebookEdit" => Some((lines(s(input, "new_source")), 0)),
        _ => None,
    }
}

/// What the island needs from a hook payload. Strings are clipped; file contents,
/// prompts and tool output never leave this process beyond a short preview.
pub fn slim(p: &Value) -> Value {
    let tool = s(p, "tool_name");
    let mut out = Map::new();
    for k in [
        "hook_event_name",
        "session_id",
        "agent_id",
        "cwd",
        "tool_name",
        "tool_use_id",
        "notification_type",
        "permission_mode",
    ] {
        if let Some(v) = p.get(k).filter(|v| !v.is_null()) {
            out.insert(k.into(), v.clone());
        }
    }
    for (k, n) in [("message", 200), ("error", 200), ("prompt", 120)] {
        if let Some(t) = p.get(k).and_then(Value::as_str) {
            out.insert(k.into(), Value::String(clip(t, n)));
        }
    }
    if let Some(b) = p.get("is_interrupt") {
        out.insert("is_interrupt".into(), b.clone());
    }
    if let Some(input) = p.get("tool_input").and_then(Value::as_object) {
        let mut ti = Map::new();
        for k in [
            "command",
            "description",
            "file_path",
            "notebook_path",
            "path",
            "pattern",
            "glob",
            "query",
            "url",
            "skill",
            "subagent_type",
            "prompt",
        ] {
            if let Some(t) = input.get(k).and_then(Value::as_str) {
                ti.insert(k.into(), Value::String(clip(t, 300)));
            }
        }
        if tool == "AskUserQuestion" {
            if let Some(q) = input.get("questions") {
                ti.insert("questions".into(), q.clone());
            }
        }
        if let Some((plus, minus)) = edit_counts(tool, &Value::Object(input.clone())) {
            ti.insert("plus".into(), plus.into());
            ti.insert("minus".into(), minus.into());
        }
        out.insert("tool_input".into(), Value::Object(ti));
    }
    Value::Object(out)
}

fn who(p: &Value) -> String {
    format!("{}/{}", s(p, "session_id"), s(p, "agent_id"))
}

/// Can the island answer this AskUserQuestion? One single-choice question with options.
/// Can the island answer this AskUserQuestion? 1-4 single-choice questions with options
/// (it asks them one by one). Multi-select stays with Claude Code's own prompt.
fn answerable_question(p: &Value) -> bool {
    let Some(qs) = p.pointer("/tool_input/questions").and_then(Value::as_array) else {
        return false;
    };
    !qs.is_empty()
        && qs.len() as u64 <= MAX_QUESTIONS
        && qs.iter().all(|q| {
            !q.get("multiSelect")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                && q.get("options")
                    .and_then(Value::as_array)
                    .is_some_and(|o| !o.is_empty())
        })
}

fn question_count(p: &Value) -> u32 {
    p.pointer("/tool_input/questions")
        .and_then(Value::as_array)
        .map_or(1, |q| q.len().max(1) as u32)
}

/// The hook output for an island answer. "" = no decision.
pub fn decision(p: &Value, answer: &str) -> String {
    match (s(p, "hook_event_name"), answer) {
        ("PermissionRequest", "approve") => json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "allow" }
            }
        })
        .to_string(),
        ("PermissionRequest", "deny") => json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "deny", "message": "Отклонено в Almanac Notch" }
            }
        })
        .to_string(),
        // "opt:N" for one question, "opts:N,M,..." for each question in order
        ("PreToolUse", a) if a.starts_with("opt:") || a.starts_with("opts:") => {
            let picks: Vec<usize> = match a.split_once(':').map(|(_, l)| {
                l.split(',')
                    .map(str::parse)
                    .collect::<Result<Vec<usize>, _>>()
            }) {
                Some(Ok(v)) => v,
                _ => return String::new(),
            };
            let qs = p
                .pointer("/tool_input/questions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if picks.len() != qs.len() {
                return String::new();
            }
            let mut answers = Map::new();
            for (q, i) in qs.iter().zip(picks) {
                let Some(label) = q
                    .pointer(&format!("/options/{i}/label"))
                    .and_then(Value::as_str)
                else {
                    return String::new();
                };
                answers.insert(s(q, "question").into(), Value::String(label.into()));
            }
            let mut input = p.get("tool_input").cloned().unwrap_or_else(|| json!({}));
            input["answers"] = Value::Object(answers);
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "updatedInput": input
                }
            })
            .to_string()
        }
        _ => String::new(),
    }
}

impl Hub {
    pub fn new(emit: Emit) -> Self {
        Self::with_wait(emit, Duration::from_secs(ANSWER_WAIT_SECS))
    }

    pub fn with_wait(emit: Emit, wait: Duration) -> Self {
        Self {
            emit,
            next: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            held: Mutex::new(HashMap::new()),
            wait,
            on_turn_end: Mutex::new(None),
        }
    }

    /// Drop prompts of `who` that are still open: the user answered in the terminal
    /// (Claude Code moved on), so the island must not keep asking.
    fn cancel_for(&self, who: &str) {
        let ids: Vec<u64> = {
            let mut p = self.pending.lock().unwrap();
            let ids: Vec<u64> = p
                .iter()
                .filter(|(_, x)| x.who == who)
                .map(|(id, _)| *id)
                .collect();
            for id in &ids {
                if let Some(x) = p.remove(id) {
                    let _ = x.tx.send(String::new());
                }
            }
            ids
        };
        for id in ids {
            (self.emit)("island://agent", json!({ "kind": "resolved", "id": id }));
        }
    }

    /// One hook payload in, the hook client's stdout out. `alive` tells whether the hook
    /// client still waits; once it is gone the prompt is taken off the island at once.
    pub fn handle(&self, p: Value, alive: &dyn Fn() -> bool) -> String {
        // module switched off: Claude Code goes on as if the island were not there
        if !crate::modules::is_on("claude") {
            return String::new();
        }
        let event = s(&p, "hook_event_name");
        let tool = s(&p, "tool_name");
        let w = who(&p);
        // Any progress of this agent means its open prompt was answered elsewhere.
        // Notifications are excluded: "Claude needs your permission" comes while it is open.
        if event != "Notification" {
            self.cancel_for(&w);
        }
        if matches!(event, "Stop" | "StopFailure") {
            if let Some(f) = self.on_turn_end.lock().unwrap().as_ref() {
                f();
            }
        }
        let hold =
            is_blocking(event, tool) && (tool != "AskUserQuestion" || answerable_question(&p));
        if !hold {
            (self.emit)(
                "island://agent",
                json!({ "kind": "hook", "hook": slim(&p) }),
            );
            return String::new();
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.pending
            .lock()
            .unwrap()
            .insert(id, Pending { tx, who: w });
        self.held.lock().unwrap().insert(id, p.clone());
        eprintln!("[claude] holding #{id} {event} {tool}");
        (self.emit)(
            "island://agent",
            json!({ "kind": "hook", "id": id, "hook": slim(&p) }),
        );
        let start = Instant::now();
        // the island asks questions one by one, each with the prototype's 30 s
        let wait = self.wait * question_count(&p);
        let answer = loop {
            match rx.recv_timeout(POLL.min(wait)) {
                Ok(a) => break a,
                Err(RecvTimeoutError::Disconnected) => break String::new(),
                Err(RecvTimeoutError::Timeout) => {
                    let gone = !alive();
                    if gone || start.elapsed() >= wait {
                        if gone {
                            eprintln!("[claude] #{id} decided elsewhere, hook closed");
                        }
                        if self.pending.lock().unwrap().remove(&id).is_some() {
                            (self.emit)("island://agent", json!({ "kind": "resolved", "id": id }));
                        }
                        break String::new();
                    }
                }
            }
        };
        self.held.lock().unwrap().remove(&id);
        answer
    }

    /// Answer from the island: "approve", "deny", "opt:N" or anything else for "no decision".
    pub fn answer(&self, id: u64, answer: &str) {
        let Some(x) = self.pending.lock().unwrap().remove(&id) else {
            eprintln!("[claude] answer #{id} {answer}: prompt already closed");
            return;
        };
        eprintln!("[claude] answer #{id} {answer}");
        let out = self
            .held
            .lock()
            .unwrap()
            .get(&id)
            .map(|p| decision(p, answer))
            .unwrap_or_default();
        let _ = x.tx.send(out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    type Log = Arc<Mutex<Vec<Value>>>;

    fn hub(wait_ms: u64) -> (Arc<Hub>, Log) {
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        let l = log.clone();
        let emit: Emit = Arc::new(move |_, v| l.lock().unwrap().push(v));
        (
            Arc::new(Hub::with_wait(emit, Duration::from_millis(wait_ms))),
            log,
        )
    }

    fn perm() -> Value {
        json!({
            "hook_event_name": "PermissionRequest", "session_id": "s1",
            "tool_name": "Bash", "tool_input": { "command": "git push origin main" }
        })
    }

    fn wait_id(log: &Log) -> u64 {
        for _ in 0..200 {
            if let Some(id) = log.lock().unwrap().iter().find_map(|v| v["id"].as_u64()) {
                return id;
            }
            thread::sleep(Duration::from_millis(5));
        }
        panic!("no held hook")
    }

    #[test]
    fn approve_from_island() {
        let (h, log) = hub(5000);
        let h2 = h.clone();
        let t = thread::spawn(move || h2.handle(perm(), &|| true));
        let id = wait_id(&log);
        h.answer(id, "approve");
        let out: Value = serde_json::from_str(&t.join().unwrap()).unwrap();
        assert_eq!(out["hookSpecificOutput"]["decision"]["behavior"], "allow");
    }

    #[test]
    fn timeout_gives_no_decision() {
        let (h, log) = hub(50);
        assert_eq!(h.handle(perm(), &|| true), "");
        assert!(log.lock().unwrap().iter().any(|v| v["kind"] == "resolved"));
    }

    #[test]
    fn killed_hook_closes_the_prompt() {
        let (h, log) = hub(5000);
        let t0 = Instant::now();
        assert_eq!(h.handle(perm(), &|| false), "");
        assert!(t0.elapsed() < Duration::from_secs(1));
        assert!(log.lock().unwrap().iter().any(|v| v["kind"] == "resolved"));
    }

    #[test]
    fn answered_in_terminal_cancels() {
        let (h, log) = hub(5000);
        let h2 = h.clone();
        let t = thread::spawn(move || h2.handle(perm(), &|| true));
        wait_id(&log);
        h.handle(
            json!({ "hook_event_name": "PostToolUse", "session_id": "s1", "tool_name": "Bash" }),
            &|| true,
        );
        assert_eq!(t.join().unwrap(), "");
    }

    #[test]
    fn question_answer_fills_answers() {
        let (h, log) = hub(5000);
        let p = json!({
            "hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "Какой раннер?", "header": "Тесты",
                "options": [{ "label": "Vitest" }, { "label": "Jest" }], "multiSelect": false }] }
        });
        let h2 = h.clone();
        let t = thread::spawn(move || h2.handle(p, &|| true));
        let id = wait_id(&log);
        h.answer(id, "opt:1");
        let out: Value = serde_json::from_str(&t.join().unwrap()).unwrap();
        let o = &out["hookSpecificOutput"];
        assert_eq!(o["permissionDecision"], "allow");
        assert_eq!(o["updatedInput"]["answers"]["Какой раннер?"], "Jest");
        assert_eq!(o["updatedInput"]["questions"][0]["header"], "Тесты");
    }

    #[test]
    fn multi_question_answers_each() {
        let p = json!({
            "hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [
                { "question": "a", "options": [{ "label": "x" }, { "label": "x2" }] },
                { "question": "b", "options": [{ "label": "y" }, { "label": "y2" }] }] }
        });
        assert!(answerable_question(&p));
        let out: Value = serde_json::from_str(&decision(&p, "opts:1,0")).unwrap();
        let ans = &out["hookSpecificOutput"]["updatedInput"]["answers"];
        assert_eq!(ans["a"], "x2");
        assert_eq!(ans["b"], "y");
        assert_eq!(decision(&p, "opts:1"), "", "every question needs an answer");
    }

    #[test]
    fn multi_select_is_not_held() {
        let (h, _) = hub(5000);
        let p = json!({
            "hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "a", "multiSelect": true, "options": [{ "label": "x" }] }] }
        });
        assert_eq!(h.handle(p, &|| true), "");
    }

    #[test]
    fn slim_drops_contents() {
        let v = slim(&json!({
            "hook_event_name": "PreToolUse", "tool_name": "Edit",
            "tool_input": { "file_path": "/a/b.ts", "old_string": "x\ny", "new_string": "1\n2\n3" },
            "tool_response": { "secret": 1 }
        }));
        assert_eq!(v["tool_input"]["plus"], 3);
        assert_eq!(v["tool_input"]["minus"], 2);
        assert!(v["tool_input"].get("new_string").is_none());
        assert!(v.get("tool_response").is_none());
    }
}
