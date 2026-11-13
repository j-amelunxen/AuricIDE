use portable_pty::MasterPty;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

pub type SharedTerminalSession = Arc<AsyncMutex<TerminalSession>>;

#[derive(Clone)]
pub struct TerminalState {
    pub sessions: Arc<Mutex<HashMap<String, SharedTerminalSession>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// The agent behind a console key. Kept permissive for the human-draft tracker.
pub fn agent_of_session(session_id: &str) -> Option<&str> {
    session_id.strip_prefix(AGENT_SESSION_PREFIX)
}

/// The wire key for an agent's console. Shell sessions keep their caller's key.
pub fn agent_session_id(agent_id: &str) -> String {
    format!("{AGENT_SESSION_PREFIX}{agent_id}")
}

/// The agent session owns this registration. The registry holds the published
/// writer/master strongly so removing it keeps the original final-drop behavior:
/// an in-flight write/resize may finish, but this handle never keeps the PTY open.
#[derive(Clone)]
pub struct AgentPty {
    key: String,
    terminals: TerminalState,
}

impl AgentPty {
    pub fn new(agent_id: &str, terminals: &TerminalState) -> Self {
        Self {
            key: agent_session_id(agent_id),
            terminals: terminals.clone(),
        }
    }

    pub fn remove(&self) {
        self.terminals.sessions.lock().unwrap().remove(&self.key);
    }

    pub fn prepare(
        &self,
        writer: Box<dyn Write + Send>,
        master: Box<dyn MasterPty + Send>,
    ) -> PendingAgentPty {
        PendingAgentPty {
            owner: self.clone(),
            session: TerminalSession {
                writer: Some(writer),
                master: Some(master),
                rows: DEFAULT_PTY_ROWS,
                cols: DEFAULT_PTY_COLS,
            },
        }
    }
}

/// Spawn's unpublished writer/master. Publication remains after process spawn;
/// the manager re-check then removes it if an exit/kill already won the race.
pub struct PendingAgentPty {
    owner: AgentPty,
    session: TerminalSession,
}

impl PendingAgentPty {
    pub fn publish(self) -> AgentPty {
        self.owner.terminals.sessions.lock().unwrap().insert(
            self.owner.key.clone(),
            Arc::new(AsyncMutex::new(self.session)),
        );
        self.owner
    }
}

/// The size a PTY has until a view fits it. Agent PTYs always open at it.
pub const DEFAULT_PTY_ROWS: u16 = 24;
pub const DEFAULT_PTY_COLS: u16 = 80;

/// An agent's PTY is registered as `agent-` plus the agent id, and agent ids
/// are themselves `agent-N` — so the key reads `agent-agent-3`.
const AGENT_SESSION_PREFIX: &str = "agent-";
const AGENT_ID_PREFIX: &str = "agent-";
pub const PTY_RESIZED_EVENT: &str = "agent-pty-resized";

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
    pub fn note_resize(
        &mut self,
        session_id: &str,
        rows: u16,
        cols: u16,
    ) -> Option<AgentPtyResized> {
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
    let agent_id = agent_of_session(session_id)
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
            let session_id = agent_session_id(raw["agentId"].as_str().unwrap());
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

#[cfg(test)]
mod session_tests {
    use super::*;
    use portable_pty::{native_pty_system, PtySize};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct Writer {
        bytes: Arc<Mutex<Vec<u8>>>,
        dropped: Arc<AtomicBool>,
        flushes: Arc<AtomicUsize>,
        fail: bool,
    }

    impl Write for Writer {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            if self.fail {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "closed for test",
                ));
            }
            self.bytes.lock().unwrap().extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.flushes.fetch_add(1, Ordering::SeqCst);
            Err(std::io::Error::other("flush is still best effort"))
        }
    }

    impl Drop for Writer {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    struct Probe {
        bytes: Arc<Mutex<Vec<u8>>>,
        dropped: Arc<AtomicBool>,
        flushes: Arc<AtomicUsize>,
    }

    fn pending(owner: &AgentPty, fail: bool) -> (PendingAgentPty, Probe) {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let bytes = Arc::new(Mutex::new(Vec::new()));
        let dropped = Arc::new(AtomicBool::new(false));
        let flushes = Arc::new(AtomicUsize::new(0));
        let probe = Probe {
            bytes: bytes.clone(),
            dropped: dropped.clone(),
            flushes: flushes.clone(),
        };
        let writer = Writer {
            bytes,
            dropped,
            flushes,
            fail,
        };
        (owner.prepare(Box::new(writer), pair.master), probe)
    }

    fn session_reference(
        terminals: &TerminalState,
        id: &str,
    ) -> std::sync::Weak<AsyncMutex<TerminalSession>> {
        let sessions = terminals.sessions.lock().unwrap();
        let session = sessions.get(&agent_session_id(id)).unwrap();
        assert!(session.try_lock().unwrap().master.is_some());
        Arc::downgrade(session)
    }

    fn assert_released(probe: &Probe, terminal: &std::sync::Weak<AsyncMutex<TerminalSession>>) {
        assert!(
            probe.dropped.load(Ordering::SeqCst),
            "runtime registration handle must not retain the writer"
        );
        // Session owns the real native master: no Arc means that box dropped
        // too. A raw-fd probe would race with unrelated tests reusing the fd.
        assert!(
            terminal.upgrade().is_none(),
            "master/writer session must close with its last registry alias"
        );
    }

    #[test]
    fn removing_registration_releases_writer_and_master_while_runtime_handle_survives() {
        let terminals = TerminalState::default();
        let owner = AgentPty::new("agent-261111-4", &terminals);
        let (pending, probe) = pending(&owner, false);
        let registration = pending.publish();
        let terminal = session_reference(&terminals, "agent-261111-4");
        assert!(terminals
            .sessions
            .lock()
            .unwrap()
            .contains_key("agent-agent-261111-4"));
        registration.remove();
        assert_released(&probe, &terminal);
        owner.remove(); // repeated cleanup from the output pump is harmless
    }

    #[tokio::test]
    async fn failed_write_removes_registration_and_releases_both_io_handles() {
        let terminals = TerminalState::default();
        let owner = AgentPty::new("agent-1", &terminals);
        let (pending, probe) = pending(&owner, true);
        pending.publish();
        let terminal = session_reference(&terminals, "agent-1");
        let key = agent_session_id("agent-1");
        assert_eq!(
            write_to_session(&terminals, &key, "hello")
                .await
                .unwrap_err(),
            "Terminal session closed: closed for test"
        );
        assert_released(&probe, &terminal);
        assert_eq!(
            write_to_session(&terminals, &key, "again")
                .await
                .unwrap_err(),
            "Session not found"
        );
        owner.remove();
    }

    #[test]
    fn an_inflight_alias_keeps_io_until_it_finishes_after_removal() {
        let terminals = TerminalState::default();
        let owner = AgentPty::new("agent-1", &terminals);
        let (pending, probe) = pending(&owner, false);
        pending.publish();
        let terminal = session_reference(&terminals, "agent-1");
        let in_flight = terminals
            .sessions
            .lock()
            .unwrap()
            .get(&agent_session_id("agent-1"))
            .unwrap()
            .clone();
        owner.remove();
        assert!(!probe.dropped.load(Ordering::SeqCst));
        drop(in_flight);
        assert_released(&probe, &terminal);
    }

    #[tokio::test]
    async fn writes_keep_bytes_flush_policy_and_other_agents_separate() {
        let terminals = TerminalState::default();
        let first = AgentPty::new("agent-1", &terminals);
        let second = AgentPty::new("agent-2", &terminals);
        let (a, a_probe) = pending(&first, false);
        let (b, b_probe) = pending(&second, false);
        a.publish();
        b.publish();
        write_to_session(&terminals, &agent_session_id("agent-1"), "ß\r")
            .await
            .unwrap();
        assert_eq!(*a_probe.bytes.lock().unwrap(), "ß\r".as_bytes());
        assert_eq!(a_probe.flushes.load(Ordering::SeqCst), 1);
        assert!(b_probe.bytes.lock().unwrap().is_empty());
        first.remove();
        write_to_session(&terminals, &agent_session_id("agent-2"), "second")
            .await
            .unwrap();
        assert_eq!(*b_probe.bytes.lock().unwrap(), b"second");
        second.remove();
    }
}
