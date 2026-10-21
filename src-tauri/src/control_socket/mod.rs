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
//! agent is refused (`caller.rs`), unless that agent is a supervisor, which is
//! admitted in its own narrow scope (`supervised.rs`, ADR 0004). The write
//! sandbox would not stop one — it leaves reads and network open.

pub mod caller;
mod link_policy;
mod link_spawn;
pub mod pingback;
mod process_activity;
pub mod projects;
pub mod protocol;
pub mod spawn_log;
mod stall_watchdog;
mod supervised;
pub(crate) use link_spawn::LinkSpawn;

use crate::agents::awaiting_input::awaits_input;
use crate::agents::output_buffer::OutputBuffers;
use crate::agents::run_results::{RunResult, RunResults, CONSOLE_TAIL_ANSWER_BYTES};
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use crate::provider_policy::ProviderPolicy;
use crate::providers::ModelOption;
use crate::supervisor::policy::{ProviderModes, SupervisorPolicy};
use protocol::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
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

/// How often `await_result` with `untilInput` looks at the console again.
const INPUT_POLL: Duration = Duration::from_millis(500);
/// How much of the console tail is searched for a prompt.
const INPUT_TAIL_BYTES: u64 = 4096;

/// A request line longer than this is refused and the connection closed. The
/// largest legitimate one is a spawn prompt; a megabyte leaves ample room.
const MAX_LINE_BYTES: u64 = 1024 * 1024;

/// What the dispatcher needs from the running app. Implemented over Tauri
/// state in `TauriBackend`, and by a fake in the tests.
pub trait ControlBackend: Send + Sync {
    fn agents(&self) -> Vec<AgentInfo>;
    /// PIDs of the running agents' processes with the agent's id and role,
    /// for the caller check.
    fn agent_pids(&self) -> HashMap<u32, (String, AgentRole)>;
    /// Write to the agent's PTY, the same path as the console's keystrokes.
    fn write_input(&self, agent_id: &str, data: &str) -> Result<(), String>;
    fn emit_input_sent(&self, event: &AgentInputSentEvent);
    fn emit_control_request(&self, event: &ControlRequestEvent) -> Result<(), String>;
    fn projects(&self) -> Vec<ProjectEntry>;
    /// The supervisor policy as the file says now, project keys canonical.
    /// Missing or broken: a policy that allows nothing.
    fn supervisor_policy(&self) -> SupervisorPolicy;
    /// What each installed provider offers now, in its own order.
    fn offered_models(&self) -> BTreeMap<String, Vec<ModelOption>>;
    /// The provider policy of the project rooted at `project_root`.
    fn project_provider_policy(&self, project_root: &Path) -> ProviderPolicy;
    /// Per installed provider: its default permission mode and which modes
    /// (of those it lists, its default and those `policy` names) skip the
    /// permission prompts (`supervisor::provider_modes`).
    fn provider_modes(&self, policy: &SupervisorPolicy) -> BTreeMap<String, ProviderModes>;
    /// Finished runs per provider id in the project at `project_root` that
    /// started at or after `since` (RFC 3339), from its `pm_agent_usage`.
    fn recent_runs(&self, project_root: &Path, since: &str) -> BTreeMap<String, u32>;
    /// The app data directory, where the supervisor link policy and its
    /// proposals live. `None`: `link_policy_*` answers `internal`.
    fn app_data_dir(&self) -> Option<PathBuf> {
        None
    }
    /// Drops a notification into the inbox (a policy proposal).
    fn notify(&self, _input: crate::notifications::NotificationInput) {}
    /// Whether the human is halfway through a message in the agent's
    /// console (`agents/human_draft.rs`); the pingback waits for it.
    fn human_drafting(&self, _agent_id: &str) -> bool {
        false
    }
}

/// Who sent a request, as the kernel's peer PID says (`Dispatcher::admit`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Caller {
    /// No IDE agent among the ancestors: every method, every agent.
    External,
    /// A running supervisor agent: its own children only (`supervised.rs`).
    Supervisor { agent_id: String },
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
    run_results: Arc<RunResults>,
    frontend_timeout: Duration,
    /// Held across a supervisor's policy check and its spawn, so two spawns
    /// on two connections cannot both pass a limit that only one fits under.
    supervisor_spawn_gate: Mutex<()>,
    /// Agent id → working directory of every agent this socket started in a
    /// worktree, so `remove_worktree` still finds the folder after the IDE
    /// cleared the agent's card. In memory only: a worktree left over from
    /// before a restart stays in the Git panel's worktree list for a person.
    worktrees: Mutex<HashMap<String, String>>,
    /// `INPUT_QUIET_SECONDS`, shorter in tests.
    input_quiet: Duration,
    watchdog: Mutex<stall_watchdog::Watchdog>,
}

pub(crate) type Outcome = Result<Value, ControlError>;

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
        run_results: Arc<RunResults>,
        frontend_timeout: Duration,
    ) -> Self {
        Self {
            backend,
            buffers,
            pending,
            run_results,
            frontend_timeout,
            supervisor_spawn_gate: Mutex::new(()),
            worktrees: Mutex::new(HashMap::new()),
            input_quiet: Duration::from_secs(INPUT_QUIET_SECONDS),
            watchdog: Mutex::new(stall_watchdog::Watchdog::default()),
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
    ///
    /// The one agent let through is a supervisor (ADR 0004), recognised by its
    /// process: the nearest agent among the peer's ancestors has that role.
    /// Nothing the peer sends can make it one.
    pub fn admit(&self, stream: &UnixStream) -> Result<Caller, ControlError> {
        self.admit_peer(caller::peer_pid(stream), caller::parent_pid)
    }

    /// `admit` for a peer PID (`None`: unreadable) and a parent lookup.
    pub fn admit_peer(
        &self,
        peer: Option<u32>,
        parent_of: impl Fn(u32) -> Option<u32>,
    ) -> Result<Caller, ControlError> {
        let Some(peer) = peer else {
            return Err(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                "the connecting process could not be identified",
            ));
        };
        let agents = self.backend.agent_pids();
        let pids: HashSet<u32> = agents.keys().copied().collect();
        let matched = match caller::nearest_agent(peer, &pids, parent_of) {
            caller::Ancestry::NoAgent => return Ok(Caller::External),
            caller::Ancestry::Agent(pid) => pid,
            caller::Ancestry::Untraceable => {
                return Err(ControlError::new(
                    ErrorCode::ForbiddenAgentCaller,
                    format!(
                        "the ancestry of process {peer} could not be traced to launchd; \
                         it is refused like an agent"
                    ),
                ))
            }
        };
        match agents.get(&matched) {
            Some((agent_id, AgentRole::Supervisor)) => Ok(Caller::Supervisor {
                agent_id: agent_id.clone(),
            }),
            _ => Err(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                format!(
                    "process {peer} runs inside an IDE agent; \
                     agents may not steer other agents"
                ),
            )),
        }
    }

    /// Answer one request line with one response line (no trailing newline).
    pub fn handle_line(&self, caller: &Caller, line: &str) -> String {
        let response = match parse_request(line) {
            Ok((id, request)) => match self.dispatch(caller, request) {
                Ok(result) => ok_response(&id, result),
                Err(error) => error_response(&id, &error),
            },
            Err(rejected) => error_response(&rejected.id, &rejected.error),
        };
        response.to_string()
    }

    fn dispatch(&self, caller: &Caller, request: Request) -> Outcome {
        let Caller::Supervisor { agent_id } = caller else {
            return self.dispatch_external(request);
        };
        self.dispatch_supervised(agent_id, request)
    }

    /// Answers `request` with every right an external caller has. The
    /// supervisor link calls this only after its own, narrower scope check.
    pub(crate) fn dispatch_external(&self, request: Request) -> Outcome {
        match request {
            Request::ListAgents(_) => self.list_agents(|_| true),
            Request::ReadOutput(params) => self.read_output(params),
            Request::SendInput(params) => self.send_input(self.input_target(params)?),
            Request::Kill(params) => self.kill(params),
            Request::Spawn(params) => {
                self.ensure_key_free(&params)?;
                self.spawn(FrontendSpawnParams {
                    params,
                    spawned_by_agent_id: None,
                    run_source: None,
                })
            }
            Request::ListProjects(params) => self.list_projects(params.project.as_deref()),
            Request::AwaitResult(params) => self.await_result(params),
            Request::RemoveWorktree(params) => self.remove_worktree(params),
            Request::Dismiss(params) => self.dismiss(params),
            Request::LinkPolicyGet(_) | Request::LinkPolicyPropose(_) => {
                Err(link_policy::supervisors_only())
            }
        }
    }

    /// Every project the IDE lists, or only those `wanted` names.
    fn list_projects(&self, wanted: Option<&str>) -> Outcome {
        let mut projects = self.backend.projects();
        if let Some(wanted) = wanted {
            projects.retain(|entry| supervised::names_project(entry, wanted));
            if projects.is_empty() {
                return Err(supervised::unknown_project(wanted));
            }
        }
        to_value(ListProjectsResult {
            projects,
            catalog: None,
        })
    }

    fn list_agents(&self, keep: impl Fn(&AgentInfo) -> bool) -> Outcome {
        let agents = self
            .summaries()
            .into_iter()
            .filter(|summary| keep(&summary.info))
            .collect();
        to_value(ListAgentsResult { agents })
    }

    /// Every agent the IDE lists, with its running output offset.
    pub(crate) fn summaries(&self) -> Vec<AgentSummary> {
        self.backend
            .agents()
            .into_iter()
            .map(|info| AgentSummary {
                output_bytes: self.buffers.total_bytes(&info.id),
                stall: if info.status == AgentStatus::Running
                    && self.run_results.get(&info.id).is_none()
                {
                    self.stall_metrics(&info.id)
                } else {
                    Default::default()
                },
                info,
            })
            .collect()
    }

    /// Finished agents whose result and listing are still kept, newest first.
    pub(crate) fn finished_agents(&self) -> Vec<AgentInfo> {
        self.run_results.finished_agents()
    }

    /// The result booked for a finished agent, while it is still kept. Its
    /// `exitCode` is `None` when the agent was killed.
    pub(crate) fn run_result(&self, agent_id: &str) -> Option<RunResult> {
        self.run_results.get(agent_id)
    }

    /// The status a finished agent's output buffer was closed with.
    pub(crate) fn final_status(&self, agent_id: &str) -> Option<AgentStatus> {
        self.buffers.read(agent_id, 0, None)?.final_status
    }

    /// The live supervisor that carries `key`, as the IDE lists it now.
    pub(crate) fn supervisor_by_key(&self, key: &str) -> Option<AgentInfo> {
        crate::supervisor::several::live_supervisor_with_key(&self.backend.agents(), key).cloned()
    }

    /// `send_input` addressed by key: the key is resolved now, at the call,
    /// so a resumed or restarted supervisor (a new agent id) is still reached.
    pub(crate) fn input_target(
        &self,
        mut params: SendInputParams,
    ) -> Result<SendInputParams, ControlError> {
        if let Some(key) = params.supervisor.take() {
            let supervisor = self
                .supervisor_by_key(&key)
                .ok_or_else(|| unknown_supervisor(&key))?;
            params.agent_id = supervisor.id;
        }
        Ok(params)
    }

    /// A supervisor spawn under a key a live supervisor carries is refused
    /// here, before the frontend builds anything. Rust's `admit_spawn` holds
    /// the same rule for every other route.
    fn ensure_key_free(&self, params: &SpawnParams) -> Result<(), ControlError> {
        let Some(key) = params.supervisor_key.as_deref() else {
            return Ok(());
        };
        match self.supervisor_by_key(key) {
            Some(holder) => Err(ControlError::new(
                ErrorCode::SupervisorKeyInUse,
                crate::supervisor::several::key_in_use_message(key, &holder.id),
            )),
            None => Ok(()),
        }
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
        // Long or multi-line text goes in as one bracketed paste, or the TUI
        // swallows the Enter and cuts the text at its read boundaries.
        let data = crate::agents::terminal_input::compose_message(
            &params.text,
            params.enter,
            self.buffers.bracketed_paste(&agent.id),
        );
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

    /// Clears a finished agent from the IDE, as the card's Dismiss button
    /// does, and forgets its kept result. A running or queued agent is
    /// refused: dismissing is not stopping.
    fn dismiss(&self, params: AgentIdParams) -> Outcome {
        let agent_id = params.agent_id.as_str();
        match self.find_agent(agent_id) {
            Some(agent) if matches!(agent.status, AgentStatus::Running | AgentStatus::Queued) => {
                return Err(ControlError::new(
                    ErrorCode::InvalidParams,
                    format!("{agent_id} is still running; await or kill it first"),
                ));
            }
            Some(_) => {}
            None if self.run_results.get(agent_id).is_some() || self.buffers.knows(agent_id) => {}
            None => return Err(Self::unknown(agent_id)),
        }
        let params_value = to_value(&params)?;
        self.via_frontend("dismiss", params_value)?;
        self.run_results.forget(agent_id);
        to_value(DismissResult {
            agent_id: params.agent_id,
            dismissed: true,
        })
    }

    /// Waits up to `waitSeconds` for the agent's result. The connection's idle
    /// timeout only covers reading the next request, so a long wait here does
    /// not close it.
    fn await_result(&self, params: AwaitResultParams) -> Outcome {
        let agent_id = params.agent_id.as_str();
        let live = self.find_agent(agent_id);
        let finished = self
            .run_results
            .get(agent_id)
            .or_else(|| self.result_from_buffers(agent_id));
        if let Some(result) = finished {
            return to_value(AwaitOutcome::done(result));
        }
        if live.is_none() && !self.buffers.knows(agent_id) {
            return Err(Self::unknown(agent_id));
        }
        let wait = Duration::from_secs(params.wait_seconds.unwrap_or(DEFAULT_AWAIT_SECONDS));
        let deadline = Instant::now() + wait;
        // Headless agents read no input, so there is nothing to wake for.
        let watch_input = params.until_input && live.as_ref().is_some_and(|agent| !agent.headless);
        let mut waiting_for_input = false;
        if watch_input {
            loop {
                if self.input_awaited(agent_id, params.since_offset) {
                    waiting_for_input = true;
                    break;
                }
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                if let Some(result) = self
                    .run_results
                    .wait_for(agent_id, deadline.min(now + INPUT_POLL))
                {
                    return to_value(AwaitOutcome::done(result));
                }
            }
        } else if let Some(result) = self.run_results.wait_for(agent_id, deadline) {
            return to_value(AwaitOutcome::done(result));
        }
        let status = self
            .find_agent(agent_id)
            .map_or(AgentStatus::Running, |agent| agent.status);
        let stall = if status == AgentStatus::Running {
            self.stall_metrics(agent_id)
        } else {
            Default::default()
        };
        to_value(AwaitOutcome::pending(
            agent_id,
            status,
            self.buffers.total_bytes(agent_id),
            waiting_for_input,
            stall,
        ))
    }

    /// Whether a running agent now waits on an answer it printed past
    /// `since_offset`: a prompt in its console tail, or a console that has
    /// been silent for `input_quiet`. Output up to `since_offset` was
    /// already seen by the caller and wakes nothing.
    fn input_awaited(&self, agent_id: &str, since_offset: Option<u64>) -> bool {
        if !self
            .find_agent(agent_id)
            .is_some_and(|agent| agent.status == AgentStatus::Running)
        {
            return false;
        }
        let total = self.buffers.total_bytes(agent_id);
        if total <= since_offset.unwrap_or(0) {
            return false;
        }
        let prompt = self
            .buffers
            .read(agent_id, INPUT_TAIL_BYTES, None)
            .is_some_and(|slice| awaits_input(&slice.text));
        prompt
            || self
                .buffers
                .silent_for(agent_id)
                .is_some_and(|quiet| quiet >= self.input_quiet)
    }

    #[cfg(test)]
    pub(crate) fn set_input_quiet(&mut self, input_quiet: Duration) {
        self.input_quiet = input_quiet;
    }

    /// A finished agent whose result is no longer kept (or predates the
    /// store) still has its console: answer from that rather than waiting
    /// for a result that will never come.
    fn result_from_buffers(&self, agent_id: &str) -> Option<RunResult> {
        let slice = self
            .buffers
            .read(agent_id, CONSOLE_TAIL_ANSWER_BYTES, None)?;
        let status = slice.final_status.clone()?;
        // The buffer keeps no finish time; now is the closest honest bound.
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |at| at.as_millis() as u64);
        Some(RunResult::from_finish(
            agent_id,
            status,
            None,
            None,
            || Some(slice.text),
            now,
        ))
    }

    fn spawn(&self, spawn: FrontendSpawnParams) -> Outcome {
        let params = &spawn.params;
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
        let result = self.via_frontend("spawn", to_value(&spawn)?)?;
        let agent_id = result
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                ControlError::new(
                    ErrorCode::Internal,
                    format!("the IDE answered spawn without an agentId: {result}"),
                )
            })?;
        if params.worktree == Some(true) {
            self.remember_worktree(agent_id);
        }
        to_value(SpawnResult {
            agent_id: agent_id.to_string(),
        })
    }

    fn worktrees(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.worktrees
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The frontend created the worktree before the spawn returned, so the
    /// new agent's working directory is it.
    fn remember_worktree(&self, agent_id: &str) {
        if let Some(cwd) = self.find_agent(agent_id).and_then(|agent| agent.repo_path) {
            self.worktrees().insert(agent_id.to_string(), cwd);
        }
    }

    /// Removes the worktree an agent ran in, but only when nothing in it would
    /// be lost. Never merges, never forces: a worktree with work in it is
    /// answered with `removed: false` and stays for a person. The folder is
    /// the agent's own working directory, never a path the caller names.
    fn remove_worktree(&self, params: AgentIdParams) -> Outcome {
        let agent_id = params.agent_id;
        let live = self.find_agent(&agent_id);
        if live
            .as_ref()
            .is_some_and(|agent| matches!(agent.status, AgentStatus::Running | AgentStatus::Queued))
        {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                format!("{agent_id} still runs: await its result or kill it first"),
            ));
        }
        let known = live.is_some() || self.buffers.knows(&agent_id);
        let cwd = live
            .and_then(|agent| agent.repo_path)
            .or_else(|| self.worktrees().get(&agent_id).cloned());
        let Some(cwd) = cwd else {
            return Err(if known {
                Self::no_worktree(&agent_id)
            } else {
                Self::unknown(&agent_id)
            });
        };
        if !Path::new(&cwd).is_dir() {
            self.worktrees().remove(&agent_id);
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                format!("{agent_id}'s worktree {cwd} is gone already (merged or removed)"),
            ));
        }
        let worktree = crate::git::git_worktree_remove_unless_work_impl(&cwd).map_err(|error| {
            if error.contains("Auric-managed") {
                Self::no_worktree(&agent_id)
            } else {
                ControlError::new(
                    ErrorCode::Internal,
                    format!("could not remove {agent_id}'s worktree: {error}"),
                )
            }
        })?;
        if worktree.removed {
            self.worktrees().remove(&agent_id);
        }
        to_value(RemoveWorktreeResult { agent_id, worktree })
    }

    fn no_worktree(agent_id: &str) -> ControlError {
        ControlError::new(
            ErrorCode::InvalidParams,
            format!("{agent_id} did not run in a worktree; there is nothing to remove"),
        )
    }

    /// Emit `control-request` and wait for `control_respond`.
    fn via_frontend(&self, method: &str, params: Value) -> Outcome {
        frontend_outcome(method, self.via_frontend_raw(method, params)?)
    }

    /// Hands `method` to the frontend and returns its answer as given, for a
    /// caller with error codes of its own (the supervisor link). Only the
    /// transport failures are mapped here.
    pub(crate) fn via_frontend_raw(
        &self,
        method: &str,
        params: Value,
    ) -> Result<FrontendReply, ControlError> {
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
        Ok(reply)
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
    let caller = match dispatcher.admit(reader.get_ref()) {
        Ok(caller) => caller,
        Err(error) => {
            refuse(&mut reader, &mut writer, &error);
            return;
        }
    };
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
            Ok(_) => dispatcher.handle_line(&caller, line.trim_end()),
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

    fn agent_pids(&self) -> HashMap<u32, (String, AgentRole)> {
        use tauri::Manager;
        let state = self.app.state::<crate::agents::AgentManagerState>();
        let manager = state.blocking_lock();
        manager
            .agents
            .values()
            .filter_map(|process| {
                let pid = process.child.process_id()?;
                Some((pid, (process.info.id.clone(), process.info.role)))
            })
            .collect()
    }

    fn supervisor_policy(&self) -> SupervisorPolicy {
        use tauri::Manager;
        match self.app.path().app_data_dir() {
            Ok(dir) => crate::supervisor::current_policy(&dir),
            Err(_) => SupervisorPolicy::default(),
        }
    }

    fn offered_models(&self) -> BTreeMap<String, Vec<ModelOption>> {
        use tauri::Manager;
        self.app
            .try_state::<crate::providers::ProviderRegistryState>()
            .map(|registry| crate::supervisor::offered_models(registry.inner()))
            .unwrap_or_default()
    }

    fn project_provider_policy(&self, project_root: &Path) -> ProviderPolicy {
        crate::provider_policy::policy_for_project(project_root)
    }

    fn recent_runs(&self, project_root: &Path, since: &str) -> BTreeMap<String, u32> {
        crate::agent_usage::store::runs_by_provider_since(project_root, since)
    }

    fn provider_modes(&self, policy: &SupervisorPolicy) -> BTreeMap<String, ProviderModes> {
        use tauri::Manager;
        self.app
            .try_state::<crate::providers::ProviderRegistryState>()
            .map(|registry| crate::supervisor::provider_modes(registry.inner(), policy))
            .unwrap_or_default()
    }

    fn human_drafting(&self, agent_id: &str) -> bool {
        use tauri::Manager;
        self.app
            .try_state::<crate::agents::human_draft::HumanDraftsState>()
            .is_some_and(|drafts| drafts.drafting(agent_id, std::time::Instant::now()))
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

    fn app_data_dir(&self) -> Option<PathBuf> {
        use tauri::Manager;
        self.app.path().app_data_dir().ok()
    }

    fn notify(&self, input: crate::notifications::NotificationInput) {
        use tauri::Manager;
        let Some(state) = self
            .app
            .try_state::<crate::notifications::NotificationsState>()
        else {
            return;
        };
        let Ok(mut conn) = state.conn.lock() else {
            return;
        };
        if let Err(error) = crate::notifications::dispatch_impl(&mut conn, &input) {
            eprintln!("Control socket: could not record a notification: {error}");
        }
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
pub fn start(app: &tauri::AppHandle, dispatcher: Arc<Dispatcher>) {
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
    std::thread::spawn(move || serve(listener, dispatcher, CONNECTION_IDLE_TIMEOUT));
}

/// The one dispatcher of the running app. The control socket and the
/// supervisor link share it, so a supervisor's spawn gate and the worktrees
/// this app started are one set whichever door a request came through.
pub fn dispatcher(app: &tauri::AppHandle) -> Arc<Dispatcher> {
    use tauri::Manager;
    let buffers = app
        .state::<crate::agents::output_buffer::OutputBuffersState>()
        .inner()
        .clone();
    let pending = app.state::<PendingRequestsState>().inner().clone();
    let run_results = app
        .state::<crate::agents::run_results::RunResultsState>()
        .inner()
        .clone();
    let backend = Arc::new(TauriBackend { app: app.clone() });
    Arc::new(Dispatcher::new(
        backend,
        buffers,
        pending,
        run_results,
        FRONTEND_TIMEOUT,
    ))
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
pub(crate) mod tests;

#[cfg(test)]
mod supervisor_attack_tests;
