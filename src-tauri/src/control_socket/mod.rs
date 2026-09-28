//! The agent-control socket: lets a process outside the IDE list, read, type
//! into, kill and start IDE agents (`docs/design-agent-control.md`).
//!
//! Layout: `protocol` is the wire format, `Dispatcher` answers one request
//! against a `ControlBackend`, `serve` runs the unix socket, and
//! `TauriBackend` plus `start` are the thin glue to the running app. Everything
//! but that glue is tested without Tauri.
//!
//! The socket is mode 0600, which keeps other users out. Agents are kept out
//! by `Dispatcher::admit`: a peer that is, or descends from, a running IDE
//! agent is refused (`caller.rs`). The write sandbox would not stop one — it
//! leaves reads and network open.

pub mod caller;
pub mod projects;
pub mod protocol;

use crate::agents::output_buffer::OutputBuffers;
use crate::agents::{AgentInfo, AgentStatus};
use protocol::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const SOCKET_FILE_NAME: &str = "control.sock";
pub const FRONTEND_TIMEOUT: Duration = Duration::from_secs(30);
pub const CONTROL_REQUEST_EVENT: &str = "control-request";
pub const AGENT_INPUT_SENT_EVENT: &str = "agent-input-sent";
/// A connection that sends nothing for this long is closed.
pub const CONNECTION_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// What a terminal sends for the Enter key. `\n` only inserts a line break in
/// Claude Code's input box and never submits.
pub const ENTER: &str = "\r";

/// A request line longer than this is refused and the connection closed. The
/// largest legitimate one is a spawn prompt; a megabyte leaves ample room.
const MAX_LINE_BYTES: u64 = 1024 * 1024;

/// What the dispatcher needs from the running app. Implemented over Tauri
/// state in `TauriBackend`, and by a fake in the tests.
pub trait ControlBackend: Send + Sync {
    fn agents(&self) -> Vec<AgentInfo>;
    /// PIDs of the running agents' processes, for the caller check.
    fn agent_pids(&self) -> std::collections::HashSet<u32>;
    /// Write to the agent's PTY, the same path as the console's keystrokes.
    fn write_input(&self, agent_id: &str, data: &str) -> Result<(), String>;
    fn emit_input_sent(&self, event: &AgentInputSentEvent);
    fn emit_control_request(&self, event: &ControlRequestEvent) -> Result<(), String>;
    fn projects(&self) -> Vec<ProjectEntry>;
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInputSentEvent {
    pub agent_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlRequestEvent {
    pub req_id: String,
    pub method: String,
    pub params: Value,
    /// Milliseconds since the epoch at which Rust stops waiting. The bridge
    /// refuses a request that reaches it later, so a caller who retried after
    /// `frontend_unavailable` does not end up with two agents.
    pub expires_at: u64,
}

/// The frontend's answer to a `control-request`, as `control_respond` takes it.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FrontendError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrontendReply {
    pub ok: bool,
    pub result: Option<Value>,
    pub error: Option<FrontendError>,
}

/// Requests handed to the frontend and not yet answered, keyed by `reqId`.
#[derive(Default)]
pub struct PendingRequests {
    next: AtomicU64,
    waiting: Mutex<HashMap<String, mpsc::Sender<FrontendReply>>>,
    /// Whether the webview's bridge listens for `control-request`. The socket
    /// comes up in setup, before the webview mounts; an event emitted before
    /// the listener exists is lost, so requests wait for this instead.
    ready: Mutex<bool>,
    ready_changed: Condvar,
}

pub type PendingRequestsState = Arc<PendingRequests>;

impl PendingRequests {
    fn register(&self) -> (String, mpsc::Receiver<FrontendReply>) {
        let req_id = format!("ctl-{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let (tx, rx) = mpsc::channel();
        self.lock().insert(req_id.clone(), tx);
        (req_id, rx)
    }

    fn forget(&self, req_id: &str) {
        self.lock().remove(req_id);
    }

    /// Hand the answer to whoever waits for it. `false` when nobody does any
    /// more — the request timed out, or the id was never issued.
    pub fn resolve(&self, req_id: &str, reply: FrontendReply) -> bool {
        match self.lock().remove(req_id) {
            Some(tx) => tx.send(reply).is_ok(),
            None => false,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, mpsc::Sender<FrontendReply>>> {
        self.waiting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Called by `control_ready`: from now on requests are emitted at once.
    pub fn mark_ready(&self) {
        *self
            .ready
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        self.ready_changed.notify_all();
    }

    /// Wait until the bridge is ready or `deadline` passes.
    fn wait_ready(&self, deadline: Instant) -> bool {
        let mut ready = self
            .ready
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while !*ready {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            ready = self
                .ready_changed
                .wait_timeout(ready, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
        true
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().len()
    }
}

pub struct Dispatcher {
    backend: Arc<dyn ControlBackend>,
    buffers: Arc<OutputBuffers>,
    pending: Arc<PendingRequests>,
    frontend_timeout: Duration,
}

type Outcome = Result<Value, ControlError>;

fn to_value(result: impl Serialize) -> Outcome {
    serde_json::to_value(result).map_err(|error| {
        ControlError::new(ErrorCode::Internal, format!("could not serialise: {error}"))
    })
}

impl Dispatcher {
    pub fn new(
        backend: Arc<dyn ControlBackend>,
        buffers: Arc<OutputBuffers>,
        pending: Arc<PendingRequests>,
        frontend_timeout: Duration,
    ) -> Self {
        Self {
            backend,
            buffers,
            pending,
            frontend_timeout,
        }
    }

    /// Refuse a peer that is, or descends from, a running IDE agent, whatever
    /// provider runs it and whatever it passed on in the environment (Codex
    /// hands its MCP servers only a whitelist, so the `AURIC_IDE_AGENT`
    /// marker is the early refusal, this the enforced one). The IDE's
    /// terminal panel is the IDE's child, not an agent's, so a person running
    /// a client there is admitted.
    ///
    /// Fails closed: a peer whose PID cannot be read is refused, because it
    /// cannot be told apart from an agent.
    pub fn admit(&self, stream: &UnixStream) -> Result<(), ControlError> {
        let Some(peer) = caller::peer_pid(stream) else {
            return Err(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                "the connecting process could not be identified",
            ));
        };
        let agents = self.backend.agent_pids();
        if caller::descends_from_agent(peer, &agents, caller::parent_pid) {
            return Err(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                format!(
                    "process {peer} runs inside an IDE agent; \
                     agents may not steer other agents"
                ),
            ));
        }
        Ok(())
    }

    /// Answer one request line with one response line (no trailing newline).
    pub fn handle_line(&self, line: &str) -> String {
        let response = match parse_request(line) {
            Ok((id, request)) => match self.dispatch(request) {
                Ok(result) => ok_response(&id, result),
                Err(error) => error_response(&id, &error),
            },
            Err(rejected) => error_response(&rejected.id, &rejected.error),
        };
        response.to_string()
    }

    fn dispatch(&self, request: Request) -> Outcome {
        match request {
            Request::ListAgents(_) => self.list_agents(),
            Request::ReadOutput(params) => self.read_output(params),
            Request::SendInput(params) => self.send_input(params),
            Request::Kill(params) => self.kill(params),
            Request::Spawn(params) => self.spawn(params),
            Request::ListProjects(_) => to_value(ListProjectsResult {
                projects: self.backend.projects(),
            }),
        }
    }

    fn list_agents(&self) -> Outcome {
        let agents = self
            .backend
            .agents()
            .into_iter()
            .map(|info| AgentSummary {
                output_bytes: self.buffers.total_bytes(&info.id),
                info,
            })
            .collect();
        to_value(ListAgentsResult { agents })
    }

    fn find_agent(&self, agent_id: &str) -> Option<AgentInfo> {
        self.backend.agents().into_iter().find(|a| a.id == agent_id)
    }

    fn unknown(agent_id: &str) -> ControlError {
        ControlError::new(
            ErrorCode::UnknownAgent,
            format!("no agent with id {agent_id} is running or recently finished"),
        )
    }

    fn not_running(agent_id: &str) -> ControlError {
        ControlError::new(
            ErrorCode::AgentNotRunning,
            format!("{agent_id} is not running any more"),
        )
    }

    fn read_output(&self, params: ReadOutputParams) -> Outcome {
        let live = self.find_agent(&params.agent_id);
        let tail = params.tail_bytes.unwrap_or(DEFAULT_TAIL_BYTES);
        let slice = self
            .buffers
            .read(&params.agent_id, tail, params.since_offset);
        let status = match (&live, &slice) {
            (Some(info), _) => info.status.clone(),
            (None, Some(slice)) => slice.final_status.clone().unwrap_or(AgentStatus::Idle),
            (None, None) => return Err(Self::unknown(&params.agent_id)),
        };
        let chunk = match slice {
            Some(slice) => OutputChunk {
                agent_id: params.agent_id,
                status,
                text: slice.text,
                start_offset: slice.start_offset,
                end_offset: slice.end_offset,
                truncated: slice.truncated,
            },
            // Known to the manager but has printed nothing yet.
            None => OutputChunk {
                agent_id: params.agent_id,
                status,
                text: String::new(),
                start_offset: 0,
                end_offset: 0,
                truncated: false,
            },
        };
        to_value(chunk)
    }

    fn send_input(&self, params: SendInputParams) -> Outcome {
        let Some(agent) = self.find_agent(&params.agent_id) else {
            return Err(if self.buffers.knows(&params.agent_id) {
                Self::not_running(&params.agent_id)
            } else {
                Self::unknown(&params.agent_id)
            });
        };
        if agent.headless {
            return Err(ControlError::new(
                ErrorCode::HeadlessNoStdin,
                format!("{} runs headless and does not read input", agent.id),
            ));
        }
        if agent.status != AgentStatus::Running {
            return Err(Self::not_running(&agent.id));
        }
        let mut data = params.text.clone();
        if params.enter {
            data.push_str(ENTER);
        }
        self.backend
            .write_input(&agent.id, &data)
            .map_err(|error| {
                ControlError::new(
                    ErrorCode::AgentNotRunning,
                    format!("{} does not take input: {error}", agent.id),
                )
            })?;
        // A bare Enter nudge is not a message; the feed does not record it.
        if !params.text.trim().is_empty() {
            self.backend.emit_input_sent(&AgentInputSentEvent {
                agent_id: agent.id.clone(),
                text: params.text,
            });
        }
        to_value(SendInputResult {
            agent_id: agent.id,
            bytes_written: data.len(),
        })
    }

    fn kill(&self, params: AgentIdParams) -> Outcome {
        // Refused here rather than after a round trip through the frontend:
        // an id nobody knows must not cost a caller the frontend timeout.
        if self.find_agent(&params.agent_id).is_none() {
            return Err(if self.buffers.knows(&params.agent_id) {
                Self::not_running(&params.agent_id)
            } else {
                Self::unknown(&params.agent_id)
            });
        }
        let params_value = to_value(&params)?;
        self.via_frontend("kill", params_value)?;
        // The frontend's word is checked, not taken: a kill that reported
        // success while the agent still runs would leave the caller wrong.
        if self
            .find_agent(&params.agent_id)
            .is_some_and(|agent| agent.status == AgentStatus::Running)
        {
            return Err(ControlError::new(
                ErrorCode::Internal,
                format!(
                    "the IDE reported {} killed, but it is still running",
                    params.agent_id
                ),
            ));
        }
        to_value(KillResult {
            agent_id: params.agent_id,
            killed: true,
        })
    }

    fn spawn(&self, params: SpawnParams) -> Outcome {
        if !Path::new(&params.project_path).is_dir() {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                format!(
                    "projectPath {} is not an existing directory",
                    params.project_path
                ),
            ));
        }
        if !Path::new(&params.project_path)
            .join(".auric")
            .join("project.db")
            .is_file()
        {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                format!(
                    "{} is not an AuricIDE project (no .auric/project.db); \
                     open it once in AuricIDE, then spawn again",
                    params.project_path
                ),
            ));
        }
        let result = self.via_frontend("spawn", to_value(&params)?)?;
        let agent_id = result
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ControlError::new(
                    ErrorCode::Internal,
                    format!("the IDE answered spawn without an agentId: {result}"),
                )
            })?;
        to_value(SpawnResult {
            agent_id: agent_id.to_string(),
        })
    }

    /// Emit `control-request` and wait for `control_respond`.
    fn via_frontend(&self, method: &str, params: Value) -> Outcome {
        let deadline = Instant::now() + self.frontend_timeout;
        let unanswered = || {
            ControlError::new(
                ErrorCode::FrontendUnavailable,
                format!(
                    "the IDE window did not answer {method} within {} s",
                    self.frontend_timeout.as_secs()
                ),
            )
        };
        // Held, inside the same budget, until the bridge listens.
        if !self.pending.wait_ready(deadline) {
            return Err(unanswered());
        }
        let left = deadline.saturating_duration_since(Instant::now());
        let expires_at = SystemTime::now()
            .checked_add(left)
            .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |at| at.as_millis() as u64);
        let (req_id, rx) = self.pending.register();
        let event = ControlRequestEvent {
            req_id: req_id.clone(),
            method: method.to_string(),
            params,
            expires_at,
        };
        if let Err(error) = self.backend.emit_control_request(&event) {
            self.pending.forget(&req_id);
            return Err(ControlError::new(
                ErrorCode::FrontendUnavailable,
                format!("could not reach the IDE window: {error}"),
            ));
        }
        let reply = match rx.recv_timeout(left) {
            Ok(reply) => reply,
            Err(_) => {
                self.pending.forget(&req_id);
                // An answer that landed between the timeout and `forget` is
                // in the channel already; it still counts.
                match rx.try_recv() {
                    Ok(reply) => reply,
                    Err(_) => return Err(unanswered()),
                }
            }
        };
        frontend_outcome(method, reply)
    }
}

fn frontend_outcome(method: &str, reply: FrontendReply) -> Outcome {
    if reply.ok {
        return Ok(reply.result.unwrap_or(Value::Null));
    }
    let Some(error) = reply.error else {
        return Err(ControlError::new(
            ErrorCode::Internal,
            format!("the IDE refused {method} without saying why"),
        ));
    };
    // The frontend may only use codes the contract knows; anything else is
    // reported as internal with its code kept in the message.
    match serde_json::from_value::<ErrorCode>(Value::String(error.code.clone())) {
        Ok(code) => Err(ControlError::new(code, error.message)),
        Err(_) => Err(ControlError::new(
            ErrorCode::Internal,
            format!("{}: {}", error.code, error.message),
        )),
    }
}

/// Bind the socket at `path`. A file left there by an app that is gone is
/// removed first; one that still answers belongs to a running AuricIDE (the
/// dev and the installed build share the directory), which keeps it.
pub fn bind(path: &Path) -> Result<UnixListener, String> {
    if path.exists() {
        if UnixStream::connect(path).is_ok() {
            return Err(format!(
                "{} is served by another running AuricIDE",
                path.display()
            ));
        }
        std::fs::remove_file(path)
            .map_err(|error| format!("could not remove stale {}: {error}", path.display()))?;
    }
    let listener = UnixListener::bind(path)
        .map_err(|error| format!("could not bind {}: {error}", path.display()))?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("could not restrict {}: {error}", path.display()))?;
    Ok(listener)
}

/// Accept connections until the listener fails, one thread per connection.
pub fn serve(listener: UnixListener, dispatcher: Arc<Dispatcher>, idle_timeout: Duration) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            // Out of file descriptors, typically. Retrying at once would spin
            // a core on the same error.
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let dispatcher = dispatcher.clone();
        std::thread::spawn(move || handle_connection(stream, &dispatcher, idle_timeout));
    }
}

fn handle_connection(stream: UnixStream, dispatcher: &Dispatcher, idle_timeout: Duration) {
    // A client that connects and goes quiet would otherwise hold a thread
    // for as long as the app runs.
    if stream.set_read_timeout(Some(idle_timeout)).is_err() {
        return;
    }
    let Ok(mut writer) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(stream);
    if let Err(error) = dispatcher.admit(reader.get_ref()) {
        refuse(&mut reader, &mut writer, &error);
        return;
    }
    loop {
        let mut line = String::new();
        let read = reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_line(&mut line);
        let response = match read {
            Ok(0) => return,
            Ok(n) if n as u64 > MAX_LINE_BYTES && !line.ends_with('\n') => {
                let error = ControlError::new(
                    ErrorCode::InvalidRequest,
                    format!("request line longer than {MAX_LINE_BYTES} bytes"),
                );
                let _ = writeln!(writer, "{}", error_response(&Value::Null, &error));
                return;
            }
            Ok(_) if line.trim().is_empty() => continue,
            Ok(_) => dispatcher.handle_line(line.trim_end()),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => {
                let error = ControlError::new(ErrorCode::InvalidRequest, "request is not UTF-8");
                let _ = writeln!(writer, "{}", error_response(&Value::Null, &error));
                return;
            }
            // Idle past the timeout, or the peer went away mid-line.
            Err(_) => return,
        };
        if writeln!(writer, "{response}").is_err() || writer.flush().is_err() {
            return;
        }
    }
}

/// Answer the caller's first request with `error` under its own id, so the
/// client reports the refusal rather than a broken connection, then close.
fn refuse(reader: &mut BufReader<UnixStream>, writer: &mut UnixStream, error: &ControlError) {
    let mut line = String::new();
    let _ = reader.by_ref().take(MAX_LINE_BYTES).read_line(&mut line);
    let id = serde_json::from_str::<Value>(line.trim())
        .ok()
        .and_then(|request| request.get("id").cloned())
        .unwrap_or(Value::Null);
    let _ = writeln!(writer, "{}", error_response(&id, error));
    let _ = writer.flush();
}

// ── Tauri glue ──────────────────────────────────────────────────────────────

struct TauriBackend {
    app: tauri::AppHandle,
}

impl ControlBackend for TauriBackend {
    fn agents(&self) -> Vec<AgentInfo> {
        use tauri::Manager;
        let state = self.app.state::<crate::agents::AgentManagerState>();
        tauri::async_runtime::block_on(crate::agents::list_agents_impl(&state)).unwrap_or_default()
    }

    fn agent_pids(&self) -> std::collections::HashSet<u32> {
        use tauri::Manager;
        let state = self.app.state::<crate::agents::AgentManagerState>();
        let manager = state.blocking_lock();
        manager
            .agents
            .values()
            .filter_map(|process| process.child.process_id())
            .collect()
    }

    fn write_input(&self, agent_id: &str, data: &str) -> Result<(), String> {
        use tauri::Manager;
        let terminals = self.app.state::<crate::commands::TerminalState>();
        let session = format!("agent-{agent_id}");
        tauri::async_runtime::block_on(crate::commands::write_to_session(
            &terminals, &session, data,
        ))
    }

    fn emit_input_sent(&self, event: &AgentInputSentEvent) {
        use tauri::Emitter;
        let _ = self.app.emit(AGENT_INPUT_SENT_EVENT, event);
    }

    fn emit_control_request(&self, event: &ControlRequestEvent) -> Result<(), String> {
        use tauri::Emitter;
        self.app
            .emit(CONTROL_REQUEST_EVENT, event)
            .map_err(|error| error.to_string())
    }

    fn projects(&self) -> Vec<ProjectEntry> {
        use tauri::Manager;
        let recent = self
            .app
            .try_state::<crate::recent_projects::RecentProjectsState>()
            .and_then(|state| state.projects.lock().ok().map(|p| p.clone()))
            .unwrap_or_default()
            .into_iter()
            .map(|p| (p.path, p.name, p.opened_at))
            .collect();
        let starred = self
            .app
            .try_state::<crate::recent_projects::StarredProjectsState>()
            .and_then(|state| state.projects.lock().ok().map(|p| p.clone()))
            .unwrap_or_default()
            .into_iter()
            .map(|p| (p.path, p.name, p.description))
            .collect();
        let open = self
            .app
            .try_state::<crate::commands::WatcherState>()
            .and_then(|state| {
                state
                    .watchers
                    .lock()
                    .ok()
                    .map(|w| w.keys().cloned().collect())
            })
            .unwrap_or_default();
        let sources = projects::ProjectSources {
            recent,
            starred,
            open,
            agents: self.agents(),
        };
        projects::list_projects(sources, projects::inspect_folder)
    }
}

pub fn socket_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SOCKET_FILE_NAME)
}

/// Bind and serve on a background thread. A socket that cannot be bound is
/// logged and the IDE opens without it: external control is an extra, not
/// something the editor depends on.
pub fn start(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        eprintln!("Control socket: no app data directory");
        return;
    };
    let path = socket_path_in(&dir);
    let listener = match bind(&path) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Control socket unavailable: {error}");
            return;
        }
    };
    let buffers = app
        .state::<crate::agents::output_buffer::OutputBuffersState>()
        .inner()
        .clone();
    let pending = app.state::<PendingRequestsState>().inner().clone();
    let backend = Arc::new(TauriBackend { app: app.clone() });
    let dispatcher = Arc::new(Dispatcher::new(backend, buffers, pending, FRONTEND_TIMEOUT));
    std::thread::spawn(move || serve(listener, dispatcher, CONNECTION_IDLE_TIMEOUT));
}

/// The frontend's answer to a `control-request`. Returns `false` when the
/// request is no longer waiting (it timed out), so a late answer is visible
/// to the caller instead of vanishing.
#[tauri::command]
pub fn control_respond(
    req_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<FrontendError>,
    pending: tauri::State<'_, PendingRequestsState>,
) -> bool {
    pending.resolve(&req_id, FrontendReply { ok, result, error })
}

/// The bridge listens for `control-request` now; held requests go out.
#[tauri::command]
pub fn control_ready(pending: tauri::State<'_, PendingRequestsState>) {
    pending.mark_ready();
}

#[cfg(test)]
mod tests;
