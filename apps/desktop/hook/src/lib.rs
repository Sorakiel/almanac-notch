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

/// Is this hook payload one the server holds until the user answers in the island?
/// PermissionRequest = approve or deny a tool; AskUserQuestion = pick an option.
pub fn is_blocking(event: &str, tool: &str) -> bool {
    event == "PermissionRequest" || (event == "PreToolUse" && tool == "AskUserQuestion")
}
