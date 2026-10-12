use crate::{agents, utf8_stream};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::sync::Mutex as AsyncMutex;

pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, Arc<AsyncMutex<TerminalSession>>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// The size a PTY has until a view fits it. Agent PTYs always open at it.
pub const DEFAULT_PTY_ROWS: u16 = 24;
pub const DEFAULT_PTY_COLS: u16 = 80;

/// An agent's PTY is registered as `agent-` plus the agent id, and agent ids
/// are themselves `agent-N` — so the key reads `agent-agent-3`.
const AGENT_SESSION_PREFIX: &str = "agent-";
const AGENT_ID_PREFIX: &str = "agent-";
const PTY_RESIZED_EVENT: &str = "agent-pty-resized";

pub struct TerminalSession {
    pub writer: Option<Box<dyn Write + Send>>,
    pub master: Option<Box<dyn MasterPty + Send>>,
    /// The size last set, so a resize to the same size can be told apart
    /// from a real one.
    pub rows: u16,
    pub cols: u16,
}

impl TerminalSession {
    /// Books a resize that has just been applied and says what to tell the
    /// windows about it. Remembering the size is what makes the next resize
    /// to the same size a silent one.
    fn note_resize(&mut self, session_id: &str, rows: u16, cols: u16) -> Option<AgentPtyResized> {
        let announcement =
            pty_resize_announcement(session_id, (self.rows, self.cols), (rows, cols));
        self.rows = rows;
        self.cols = cols;
        announcement
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPtyResized {
    pub agent_id: String,
    pub rows: u16,
    pub cols: u16,
}

/// What to tell the windows after a resize, if anything. Each window fits its
/// own view and both feed the announced size back into their mirror; saying
/// nothing for an unchanged size is what keeps the two from answering each
/// other forever. Plain shell sessions live in one window and need no word.
fn pty_resize_announcement(
    session_id: &str,
    last: (u16, u16),
    next: (u16, u16),
) -> Option<AgentPtyResized> {
    let agent_id = session_id
        .strip_prefix(AGENT_SESSION_PREFIX)
        .filter(|rest| rest.len() > AGENT_ID_PREFIX.len() && rest.starts_with(AGENT_ID_PREFIX))?;
    let (rows, cols) = next;
    if next == last || rows == 0 || cols == 0 {
        return None;
    }
    Some(AgentPtyResized {
        agent_id: agent_id.to_string(),
        rows,
        cols,
    })
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn shell_spawn(
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            println!("Session '{}' already exists, skipping spawn", id);
            return Ok(());
        }
    }

    println!("Spawning PTY shell '{}' with id '{}'", command, id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(DEFAULT_PTY_ROWS),
            cols: cols.unwrap_or(DEFAULT_PTY_COLS),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(args);
    if let Some(ref c) = cwd {
        cmd.cwd(c);
    }
    // GUI apps on macOS launch with a minimal PATH — give terminal sessions
    // the same login-shell environment agents get (see agents.rs).
    for (key, value) in agents::cached_login_shell_env().await {
        cmd.env(key, value);
    }
    // Ensure child processes see a proper terminal type.
    // GUI apps on macOS do not inherit TERM from the user's shell.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(pair.master),
        rows: rows.unwrap_or(DEFAULT_PTY_ROWS),
        cols: cols.unwrap_or(DEFAULT_PTY_COLS),
    }));

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.clone(), session);
    }

    let app_stdout = app.clone();
    let id_stdout = id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 16_384];
        let mut decoder = utf8_stream::Utf8StreamDecoder::new();
        let mut accumulated = String::new();
        let mut last_emit = std::time::Instant::now();
        let batch_interval = std::time::Duration::from_millis(16);

        loop {
            let n = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };

            // Decode only complete UTF-8 sequences; the decoder keeps trailing
            // incomplete bytes for the next read.
            accumulated.push_str(&decoder.push(&buffer[..n]));

            // Emit batched output every ~16 ms or when the buffer is large enough
            if last_emit.elapsed() >= batch_interval || accumulated.len() > 32_000 {
                if !accumulated.is_empty() {
                    let batch = std::mem::take(&mut accumulated);
                    let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), batch);
                }
                last_emit = std::time::Instant::now();
            }
        }

        // Flush any remaining data
        accumulated.push_str(&decoder.finish());
        if !accumulated.is_empty() {
            let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), accumulated);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn shell_write(
    id: String,
    data: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    write_to_session(&state, &id, &data).await
}

/// The one way into a PTY session's stdin: the console's keystrokes and the
/// control socket's `send_input` both go through here.
pub async fn write_to_session(state: &TerminalState, id: &str, data: &str) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(id).cloned().ok_or("Session not found")?
    };

    let mut session = session_arc.lock().await;
    if let Some(ref mut writer) = session.writer {
        if let Err(e) = writer.write_all(data.as_bytes()) {
            let err_msg = e.to_string();
            println!("I/O Error writing to session '{}': {}", id, err_msg);
            drop(session);
            let mut sessions = state.sessions.lock().unwrap();
            sessions.remove(id);
            return Err(format!("Terminal session closed: {}", err_msg));
        }
        let _ = writer.flush();
    }
    Ok(())
}

#[tauri::command]
pub async fn shell_resize(
    id: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned().ok_or("Session not found")?
    };

    let mut session = session_arc.lock().await;
    if let Some(ref master) = session.master {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    let announcement = session.note_resize(&id, rows, cols);
    drop(session);
    if let Some(resized) = announcement {
        let _ = app.emit(PTY_RESIZED_EVENT, resized);
    }
    Ok(())
}

#[cfg(test)]
mod resize_tests {
    use super::*;
    use crate::agent_window::tests::fixtures;

    const DEFAULT: (u16, u16) = (DEFAULT_PTY_ROWS, DEFAULT_PTY_COLS);

    #[test]
    fn the_default_size_and_the_event_name_agree_with_the_fixtures() {
        let fixtures = fixtures();
        assert_eq!(fixtures["defaultPtySize"]["rows"], DEFAULT_PTY_ROWS);
        assert_eq!(fixtures["defaultPtySize"]["cols"], DEFAULT_PTY_COLS);
        assert_eq!(fixtures["rustEvents"]["ptyResized"], PTY_RESIZED_EVENT);
    }

    #[test]
    fn a_real_resize_of_an_agent_pty_is_announced_in_the_fixture_shape() {
        let fixtures = fixtures();
        let cases = fixtures["messages"]["ptyResized"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let raw = &case["raw"];
            let session_id = format!("agent-{}", raw["agentId"].as_str().unwrap());
            let next = (
                raw["rows"].as_u64().unwrap() as u16,
                raw["cols"].as_u64().unwrap() as u16,
            );
            let resized = pty_resize_announcement(&session_id, DEFAULT, next);
            assert_eq!(
                serde_json::to_value(resized).unwrap(),
                *raw,
                "{}",
                case["name"]
            );
        }
    }

    fn session() -> TerminalSession {
        TerminalSession {
            writer: None,
            master: None,
            rows: DEFAULT_PTY_ROWS,
            cols: DEFAULT_PTY_COLS,
        }
    }

    #[test]
    fn a_session_announces_each_real_change_once_and_remembers_the_size() {
        let id = "agent-agent-3";
        let mut session = session();

        let first = session.note_resize(id, 50, 160);
        assert_eq!(first.map(|r| (r.rows, r.cols)), Some((50, 160)));
        assert_eq!((session.rows, session.cols), (50, 160));

        // The other window fitting to what the first one just set.
        assert_eq!(session.note_resize(id, 50, 160), None);
        assert_eq!((session.rows, session.cols), (50, 160));

        let third = session.note_resize(id, 30, 100);
        assert_eq!(third.map(|r| (r.rows, r.cols)), Some((30, 100)));
        assert_eq!((session.rows, session.cols), (30, 100));

        // Back to the size it opened at is a change like any other.
        let back = session.note_resize(id, DEFAULT_PTY_ROWS, DEFAULT_PTY_COLS);
        assert_eq!(back.map(|r| (r.rows, r.cols)), Some(DEFAULT));
    }

    #[test]
    fn a_shell_session_remembers_its_size_without_announcing_it() {
        let mut session = session();
        assert_eq!(session.note_resize("terminal-1", 40, 120), None);
        assert_eq!((session.rows, session.cols), (40, 120));
    }

    #[test]
    fn the_same_size_again_is_not_announced() {
        // The second window fitting to the size the first one just set must
        // not start a round of answers.
        assert_eq!(
            pty_resize_announcement("agent-agent-3", (50, 160), (50, 160)),
            None
        );
        assert_eq!(
            pty_resize_announcement("agent-agent-3", DEFAULT, DEFAULT),
            None
        );
    }

    #[test]
    fn one_changed_dimension_is_a_change() {
        let rows_only = pty_resize_announcement("agent-agent-3", (50, 160), (51, 160));
        assert_eq!(rows_only.map(|r| (r.rows, r.cols)), Some((51, 160)));
        let cols_only = pty_resize_announcement("agent-agent-3", (50, 160), (50, 161));
        assert_eq!(cols_only.map(|r| (r.rows, r.cols)), Some((50, 161)));
    }

    #[test]
    fn the_announced_id_is_the_agent_id_without_the_session_prefix() {
        let resized = pty_resize_announcement("agent-agent-12", DEFAULT, (40, 120));
        assert_eq!(resized.map(|r| r.agent_id), Some("agent-12".to_string()));
    }

    #[test]
    fn a_plain_shell_session_announces_nothing() {
        for id in [
            "terminal-1",
            "shell",
            "",
            "agent-",
            "agent-terminal",
            "xagent-agent-1",
        ] {
            assert_eq!(
                pty_resize_announcement(id, DEFAULT, (40, 120)),
                None,
                "{id}"
            );
        }
    }

    #[test]
    fn a_zero_sized_pty_is_never_announced() {
        // The contract rejects it on the other side; better not to send it.
        assert_eq!(
            pty_resize_announcement("agent-agent-1", DEFAULT, (0, 80)),
            None
        );
        assert_eq!(
            pty_resize_announcement("agent-agent-1", DEFAULT, (24, 0)),
            None
        );
    }
}
