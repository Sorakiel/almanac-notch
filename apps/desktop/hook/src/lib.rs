//! Shared by the hook client binary and the desktop app: where files live, the
//! connection file format and the installer of the hooks in Claude Code's settings.

pub mod install;
pub mod paths;

/// Header with the per-launch secret. The server rejects requests without it.
pub const TOKEN_HEADER: &str = "X-Almanac-Token";

/// Hooks that wait for an answer from the island. The island gives up after 30 s
/// (the prototype's attention and question duration); the client waits a little longer.
pub const ANSWER_WAIT_SECS: u64 = 30;

/// AskUserQuestion asks up to this many questions; the island takes them one by one,
/// 30 s each, so the hook may wait that many times longer.
pub const MAX_QUESTIONS: u64 = 4;

/// While a full-screen app hides the island, a held prompt waits for the user to come back
/// (owner, 2026-10-24) - but not forever: after this the question goes to the terminal.
/// The hook's own timeout in settings.json is this plus slack (install::EVENTS). Claude Code
/// has no upper bound on it (`timeout: positive()`, deadline = timeout * 1000 ms).
pub const HOLD_MAX_SECS: u64 = 12 * 60 * 60;

/// While it holds a prompt the app sends a byte this often, so the hook client (which gives
/// up after ANSWER_WAIT_SECS of silence) knows the app is alive and keeps waiting.
pub const HEARTBEAT_SECS: u64 = 2;

/// Is this hook payload one the server holds until the user answers in the island?
/// PermissionRequest = approve or deny a tool; AskUserQuestion = pick an option.
pub fn is_blocking(event: &str, tool: &str) -> bool {
    event == "PermissionRequest" || (event == "PreToolUse" && tool == "AskUserQuestion")
}
