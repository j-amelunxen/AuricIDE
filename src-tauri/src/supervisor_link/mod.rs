//! The supervisor link: a WebSocket over a unix socket through which a
//! client of the Supervisor Control API starts, watches and talks to
//! supervisors, reads and proposes documents, and runs jobs in projects
//! (`docs/design-supervisor-link.md`).
//!
//! Layout: `protocol` is the wire format, `Link` answers one request inside
//! the link's scope, `Subscription` turns the agent list, the output buffers
//! and the job register into events, `serve` runs the socket. Agent work goes
//! through the control socket's `Dispatcher` as an external caller, after
//! `Link` has narrowed it to the supervisor tree, so the link never has a
//! right `control.sock` does not already give the same process. `documents`,
//! `jobs` and `policy` are the project half; none of them knows a document
//! format or a job kind of its own.

mod assets;
mod documents;
mod glob;
mod instructions;
pub mod jobs;
pub mod policy;
pub mod proposals;
pub mod protocol;
mod subscription;

#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;

use crate::control_socket::protocol::AgentSummary;
use crate::control_socket::protocol::{
    AgentIdParams, ControlError, ErrorCode, ReadOutputParams, Request, SendInputParams,
    DEFAULT_TAIL_BYTES,
};
use crate::control_socket::{Caller, Dispatcher};
use crate::notifications::NotificationInput;
use documents::{DocumentError, ProposeRequest};
use jobs::Jobs;
use policy::LinkPolicy;
use protocol::*;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
pub use subscription::Subscription;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tungstenite::{Message, WebSocket};

pub const SOCKET_FILE_NAME: &str = "supervisor-link.sock";
pub const REQUEST_PATH: &str = "/v1";
pub const POLL: Duration = Duration::from_millis(250);
pub const PING_EVERY: Duration = Duration::from_secs(30);
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
/// Fixture `jobs.tickMs`: how often running jobs are looked at.
pub const JOB_TICK: Duration = Duration::from_secs(2);
/// How long one read waits before the loop turns to answers and events.
const READ_SLICE: Duration = Duration::from_millis(50);

/// What one link process lets its clients hold at once (fixture `limits`).
/// Every client is a process of the same user, so these are not an access
/// control; they keep one misbehaving client from pinning threads or memory.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Open connections. One more is answered with `busy` and closed.
    pub max_connections: usize,
    /// Requests read but not yet answered, per connection, beyond the one
    /// being worked on. One more is answered with `busy` at once.
    pub max_pending_requests: usize,
    /// From connect to a finished WebSocket handshake.
    pub handshake_timeout: Duration,
    /// How long one outgoing message may wait for a client that does not read.
    pub write_timeout: Duration,
}

pub const LIMITS: Limits = Limits {
    max_connections: 16,
    max_pending_requests: 64,
    handshake_timeout: Duration::from_secs(10),
    write_timeout: Duration::from_secs(10),
};

/// What the link needs from the running app beyond the dispatcher. Over Tauri
/// state in `TauriHost`, by a fake in the tests.
pub trait LinkHost: Send + Sync {
    /// The link policy as the file says now. Missing or broken: nothing visible.
    fn policy(&self) -> LinkPolicy;
    /// Drops a notification into the inbox (a proposal, a job that ended).
    fn notify(&self, input: NotificationInput);
}

/// A subscription change that takes effect when its response is sent, so no
/// event of the new subscription goes out before the answer that started it.
#[derive(Debug)]
pub enum Install {
    Set(Box<Subscription>),
    Clear,
}

#[derive(Debug)]
pub struct Reply {
    pub result: Result<Value, LinkError>,
    pub install: Option<Install>,
}

impl Reply {
    fn of(result: Result<Value, LinkError>) -> Self {
        Self {
            result,
            install: None,
        }
    }
}

pub struct Link {
    dispatcher: Arc<Dispatcher>,
    host: Arc<dyn LinkHost>,
    jobs: Arc<Jobs>,
    /// Held from the quota check to the job's record, so two requests cannot
    /// both take the last slot.
    create_gate: Mutex<()>,
    /// Agent id → when the tick first found a running job's agent gone from
    /// the list with no end booked yet (`job_runner`, `VANISHED_GRACE_MS`).
    vanished: Mutex<std::collections::HashMap<String, u64>>,
}

/// Whether an agent belongs to the supervisor tree: a supervisor, or an agent
/// a supervisor started. Only a supervisor's spawn sets `spawnedByAgentId`, so
/// that field alone is the second half; it also keeps a child in the tree
/// after its supervisor's card was cleared. A job's agent joins through the
/// register (`Link::tree`).
pub fn in_tree(agent: &AgentSummary) -> bool {
    agent.info.role == crate::agents::AgentRole::Supervisor
        || agent.info.spawned_by_agent_id.is_some()
}

fn to_value(result: impl serde::Serialize) -> Result<Value, LinkError> {
    serde_json::to_value(result)
        .map_err(|error| LinkError::new("internal", format!("could not serialise: {error}")))
}

impl From<DocumentError> for LinkError {
    fn from(error: DocumentError) -> Self {
        LinkError::new(error.code.as_str(), error.message)
    }
}

fn project_name(project: &str) -> Option<String> {
    Path::new(project)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

impl Link {
    /// A link whose job register lives in memory only.
    #[cfg(test)]
    pub fn new(dispatcher: Arc<Dispatcher>, host: Arc<dyn LinkHost>) -> Self {
        Self::with_jobs(dispatcher, host, Arc::new(Jobs::default()))
    }

    pub fn with_jobs(
        dispatcher: Arc<Dispatcher>,
        host: Arc<dyn LinkHost>,
        jobs: Arc<Jobs>,
    ) -> Self {
        Self {
            dispatcher,
            host,
            jobs,
            create_gate: Mutex::new(()),
            vanished: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn jobs(&self) -> &Jobs {
        &self.jobs
    }

    /// The supervisor tree as the IDE lists it now, job agents included.
    pub fn tree(&self) -> Vec<AgentSummary> {
        let job_agents: BTreeSet<String> = self.jobs.agent_ids().into_iter().collect();
        self.dispatcher
            .summaries()
            .into_iter()
            .filter(|agent| in_tree(agent) || job_agents.contains(&agent.info.id))
            .collect()
    }

    /// Refuses an id outside the tree exactly like one that does not exist,
    /// so the client learns nothing about agents it may not touch.
    fn ensure_in_tree(&self, agent_id: &str) -> Result<(), LinkError> {
        if self.tree().iter().any(|agent| agent.info.id == agent_id) {
            return Ok(());
        }
        Err(LinkError::new(
            "unknown_agent",
            format!("no agent with id {agent_id} in the supervisor tree"),
        ))
    }

    fn control(&self, request: Request) -> Result<Value, LinkError> {
        self.dispatcher
            .dispatch_external(request)
            .map_err(LinkError::from)
    }

    pub fn handle(&self, request: LinkRequest) -> Reply {
        match request {
            LinkRequest::Subscribe(params) => self.subscribe(params),
            LinkRequest::Unsubscribe => Reply {
                result: Ok(json!({ "subscribed": false })),
                install: Some(Install::Clear),
            },
            other => Reply::of(self.answer(other)),
        }
    }

    fn answer(&self, request: LinkRequest) -> Result<Value, LinkError> {
        match request {
            LinkRequest::Hello(_) => Ok(json!({
                "protocol": PROTOCOL,
                "server": "AuricIDE",
                "methods": METHODS,
                "events": EVENTS,
            })),
            LinkRequest::SpawnSupervisor(params) => self.spawn_supervisor(params),
            LinkRequest::ListAgents => Ok(json!({ "agents": self.tree() })),
            LinkRequest::Read(params) => {
                self.ensure_in_tree(&params.agent_id)?;
                self.control(Request::ReadOutput(ReadOutputParams {
                    agent_id: params.agent_id,
                    tail_bytes: Some(params.tail_bytes.unwrap_or(DEFAULT_TAIL_BYTES)),
                    since_offset: params.since_offset,
                }))
            }
            LinkRequest::Send(params) => {
                self.ensure_in_tree(&params.agent_id)?;
                self.control(Request::SendInput(SendInputParams {
                    agent_id: params.agent_id,
                    text: params.text,
                    enter: params.submit,
                }))
            }
            LinkRequest::Kill(params) => {
                self.ensure_in_tree(&params.agent_id)?;
                self.control(Request::Kill(AgentIdParams {
                    agent_id: params.agent_id,
                }))
            }
            LinkRequest::Subscribe(_) | LinkRequest::Unsubscribe => Err(LinkError::new(
                "internal",
                "subscriptions are handled by Link::handle",
            )),
            other => self.answer_project(other),
        }
    }

    /// Documents and jobs: the methods that work on projects.
    fn answer_project(&self, request: LinkRequest) -> Result<Value, LinkError> {
        let policy = self.host.policy();
        match request {
            LinkRequest::DocumentProjects => {
                to_value(json!({ "projects": documents::visible_projects(&policy) }))
            }
            LinkRequest::DocumentSearch(params) => {
                let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT) as usize;
                let found = documents::search(
                    &policy,
                    params.query.as_deref(),
                    params.project.as_deref(),
                    params.document_type.as_deref(),
                    limit,
                )?;
                to_value(json!({ "documents": found }))
            }
            LinkRequest::DocumentGet(params) => to_value(documents::get(
                &policy,
                &params.project,
                &params.document_type,
                &params.id,
                params.rev.as_deref(),
            )?),
            LinkRequest::DocumentResolve(params) => to_value(documents::resolve(
                &policy,
                &params.project,
                &params.document_type,
                &params.from,
                &params.reference,
                params.rev.as_deref(),
            )?),
            LinkRequest::DocumentAsset(params) => to_value(assets::get(
                &policy,
                &params.project,
                &params.path,
                params.rev.as_deref(),
            )?),
            LinkRequest::DocumentPropose(params) => self.propose(&policy, &params),
            LinkRequest::CreateJob(params) => self.create_job(&policy, params),
            LinkRequest::ListJobs(params) => {
                let limit = params.limit.unwrap_or(DEFAULT_JOBS_LIMIT) as usize;
                let project = params
                    .project
                    .as_deref()
                    .map(crate::supervisor::canonical_project_path);
                to_value(
                    json!({ "jobs": self.jobs.list(project.as_deref(), params.status, limit) }),
                )
            }
            LinkRequest::CancelJob(params) => self.cancel_job(&params.job_id),
            _ => Err(LinkError::new("internal", "not a project method")),
        }
    }

    /// A new supervisor, built by the frontend exactly like one from the
    /// Quick Access tile. The frontend's own codes (`supervisor_unavailable`)
    /// are link codes, so its answer is read raw rather than through the
    /// control socket's mapping.
    fn spawn_supervisor(&self, params: SpawnSupervisorParams) -> Result<Value, LinkError> {
        let reply = self
            .dispatcher
            .via_frontend_raw(SPAWN_SUPERVISOR_METHOD, to_value(&params)?)
            .map_err(LinkError::from)?;
        if !reply.ok {
            let Some(error) = reply.error else {
                return Err(LinkError::new(
                    "internal",
                    "the IDE refused the supervisor without saying why",
                ));
            };
            return Err(LinkError::new(&error.code, error.message));
        }
        let agent_id = reply
            .result
            .as_ref()
            .and_then(|result| result.get("agentId"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                LinkError::new("internal", "the IDE answered the spawn without an agentId")
            })?;
        Ok(json!({ "agentId": agent_id }))
    }

    fn propose(&self, policy: &LinkPolicy, params: &ProposeParams) -> Result<Value, LinkError> {
        let proposal = documents::propose(
            policy,
            &ProposeRequest {
                project: &params.project,
                type_name: &params.document_type,
                id: &params.id,
                document: &params.document,
                base_hash: params.base()?,
                message: params.message.as_deref(),
            },
        )?;
        self.host.notify(proposal_notification(&proposal));
        to_value(proposal)
    }

    fn subscribe(&self, params: SubscribeParams) -> Reply {
        let tree = self.tree();
        if let Some(ids) = &params.agent_ids {
            if let Some(missing) = ids
                .iter()
                .find(|id| !tree.iter().any(|agent| &agent.info.id == *id))
            {
                return Reply::of(Err(LinkError::new(
                    "unknown_agent",
                    format!("no agent with id {missing} in the supervisor tree"),
                )));
            }
        }
        let subscription = Subscription::start(&params, &tree, self.jobs.cursor());
        let agents: Vec<&AgentSummary> = tree
            .iter()
            .filter(|agent| subscription.covers(&agent.info.id))
            .collect();
        Reply {
            result: to_value(json!({ "agents": agents })),
            install: Some(Install::Set(Box::new(subscription))),
        }
    }

    /// Console text since `since` for one agent, for the event pump.
    pub fn output_since(&self, agent_id: &str, since: u64) -> Option<Value> {
        self.dispatcher
            .dispatch_external(Request::ReadOutput(ReadOutputParams {
                agent_id: agent_id.to_string(),
                tail_bytes: Some(crate::control_socket::protocol::MAX_TAIL_BYTES),
                since_offset: Some(since),
            }))
            .ok()
    }

    /// Who may connect: anyone the control socket admits as external. A
    /// supervisor is admitted there in its own scope, but not here: an agent
    /// must not steer its own supervisor.
    pub fn admit(&self, stream: &UnixStream) -> Result<(), LinkError> {
        self.admit_caller(self.dispatcher.admit(stream))
    }

    pub fn admit_caller(&self, caller: Result<Caller, ControlError>) -> Result<(), LinkError> {
        match caller {
            Ok(Caller::External) => Ok(()),
            Ok(Caller::Supervisor { agent_id }) => Err(LinkError::from(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                format!("{agent_id} is an IDE agent; agents may not use the supervisor link"),
            ))),
            Err(error) => Err(LinkError::from(ControlError::new(
                ErrorCode::ForbiddenAgentCaller,
                error.message.replace(
                    "agents may not steer other agents",
                    "agents may not use the supervisor link",
                ),
            ))),
        }
    }
}

mod job_runner;

/// The control-request method the frontend answers for `supervisors.spawn`.
pub const SPAWN_SUPERVISOR_METHOD: &str = "spawn_supervisor";

fn notification(project: &str, title: String, body: String) -> NotificationInput {
    NotificationInput {
        uid: None,
        project_path: Some(project.to_string()),
        project_name: project_name(project),
        // Not the user's own words: a client of the link caused it.
        source: "mcp".to_string(),
        origin: Some("supervisor-link".to_string()),
        kind: Some("info".to_string()),
        severity: Some("info".to_string()),
        title,
        body: Some(body),
        actions: None,
        dedupe_key: None,
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    }
}

fn short(commit: &str) -> &str {
    &commit[..commit.len().min(12)]
}

fn proposal_notification(proposal: &documents::Proposal) -> NotificationInput {
    let verb = if proposal.created { "new" } else { "change to" };
    notification(
        &proposal.project,
        format!(
            "Proposal: {verb} {} {}",
            proposal.document_type, proposal.id
        ),
        format!(
            "Proposed over the supervisor link as branch {} (commit {}). \
             Nothing in your working tree changed. Review the branch in the Git panel, \
             then merge it or delete it.",
            proposal.branch,
            short(&proposal.commit),
        ),
    )
}

// ---------------------------------------------------------------- transport

pub fn socket_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SOCKET_FILE_NAME)
}

/// Accept connections until the listener fails, one thread per connection.
pub fn serve(listener: UnixListener, link: Arc<Link>) {
    serve_with(listener, link, LIMITS);
}

/// Decrements the open-connection count when a connection ends, however it ends.
struct Open(Arc<AtomicUsize>);

impl Drop for Open {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

pub fn serve_with(listener: UnixListener, link: Arc<Link>, limits: Limits) {
    let open = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let link = link.clone();
        let over = open.fetch_add(1, Ordering::SeqCst) >= limits.max_connections;
        let guard = Open(open.clone());
        std::thread::spawn(move || {
            let _guard = guard;
            handle_connection(stream, &link, limits, over);
        });
    }
}

/// Answers the upgrade only on `REQUEST_PATH`. The error type is tungstenite's
/// own and its size is not ours to change.
#[allow(clippy::result_large_err)]
fn check_path(
    request: &tungstenite::handshake::server::Request,
    response: tungstenite::handshake::server::Response,
) -> Result<tungstenite::handshake::server::Response, tungstenite::handshake::server::ErrorResponse>
{
    if request.uri().path() == REQUEST_PATH {
        return Ok(response);
    }
    let mut refusal = tungstenite::handshake::server::ErrorResponse::new(Some(format!(
        "the supervisor link answers on {REQUEST_PATH}"
    )));
    *refusal.status_mut() = tungstenite::http::StatusCode::NOT_FOUND;
    Err(refusal)
}

/// A client that connects and never finishes the handshake gives up its
/// thread after `timeout`; so does one that stops reading our answers.
fn handshake(stream: UnixStream, limits: &Limits) -> Option<WebSocket<UnixStream>> {
    stream
        .set_read_timeout(Some(limits.handshake_timeout))
        .ok()?;
    stream.set_write_timeout(Some(limits.write_timeout)).ok()?;
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_MESSAGE_BYTES));
    tungstenite::accept_hdr_with_config(stream, check_path, Some(config)).ok()
}

fn send(socket: &mut WebSocket<UnixStream>, value: &Value) -> bool {
    socket.send(Message::text(value.to_string())).is_ok()
}

fn close(socket: &mut WebSocket<UnixStream>, code: CloseCode, reason: &str) {
    let _ = socket.close(Some(CloseFrame {
        code,
        reason: reason.to_string().into(),
    }));
    let _ = socket.flush();
}

/// How long, and how much, the rest of an oversized message is read off
/// after the 1009 close.
const DRAIN_FOR: Duration = Duration::from_secs(2);
const DRAIN_MAX_BYTES: usize = 8 * MAX_MESSAGE_BYTES;

/// Closes with 1009 and then reads off what the client still sends. Over the
/// limit the frame's payload is still unread in the socket, and closing a
/// socket with unread data makes the kernel reset the connection: the client
/// would see 1006 instead of our close frame. Shutting down our write side
/// lets the client end the connection once it has read the close.
fn close_oversized(socket: &mut WebSocket<UnixStream>) {
    close(socket, CloseCode::Size, "message too large");
    let stream = socket.get_mut();
    let _ = stream.shutdown(std::net::Shutdown::Write);
    let _ = stream.set_read_timeout(Some(READ_SLICE));
    let started = Instant::now();
    let mut drained = 0;
    let mut chunk = vec![0u8; 64 * 1024];
    while started.elapsed() < DRAIN_FOR && drained < DRAIN_MAX_BYTES {
        match std::io::Read::read(stream, &mut chunk) {
            Ok(0) => return,
            Ok(read) => drained += read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock
                        | std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return,
        }
    }
}

/// Hands a request to the worker, or answers `busy` at once when its queue is
/// full. `false`: the connection is over.
fn queue(
    requests: &mpsc::SyncSender<Result<(Value, LinkRequest), Rejected>>,
    message: Result<(Value, LinkRequest), Rejected>,
    socket: &mut WebSocket<UnixStream>,
) -> bool {
    match requests.try_send(message) {
        Ok(()) => true,
        Err(mpsc::TrySendError::Full(message)) => {
            let id = match message {
                Ok((id, _)) => id,
                Err(rejected) => rejected.id,
            };
            let mut busy = LinkError::new(
                "busy",
                "too many requests are waiting for an answer on this connection; \
                 wait for answers before sending more",
            );
            busy.reason = Some("too_many_pending_requests".to_string());
            send(socket, &response_error(&id, &busy))
        }
        Err(mpsc::TrySendError::Disconnected(_)) => false,
    }
}

// code-gate: complexity-cyclomatic, complexity-function-length - the connection's one loop (read, answer, events, ping); its branches are WebSocket frame kinds
fn handle_connection(stream: UnixStream, link: &Arc<Link>, limits: Limits, over_limit: bool) {
    // The peer is checked on the raw socket, before anything it sends is read.
    let admitted = link.admit(&stream);
    let Some(mut socket) = handshake(stream, &limits) else {
        return;
    };
    if let Err(error) = admitted {
        send(&mut socket, &fatal(&error));
        close(&mut socket, CloseCode::Policy, "forbidden_agent_caller");
        return;
    }
    if over_limit {
        let mut busy = LinkError::new(
            "busy",
            format!(
                "the supervisor link already has {} open connections",
                limits.max_connections
            ),
        );
        busy.reason = Some("too_many_connections".to_string());
        send(&mut socket, &fatal(&busy));
        close(&mut socket, CloseCode::Again, "busy");
        return;
    }
    if socket.get_ref().set_read_timeout(Some(READ_SLICE)).is_err() {
        return;
    }

    // Requests run on a worker of their own, in order, so a spawn that waits
    // for the IDE window does not hold the events back. The queue is bounded:
    // a client that sends faster than it is answered gets `busy`, not memory.
    let (request_tx, request_rx) =
        mpsc::sync_channel::<Result<(Value, LinkRequest), Rejected>>(limits.max_pending_requests);
    let (reply_tx, reply_rx) = mpsc::channel::<(Value, Reply)>();
    let worker_link = link.clone();
    std::thread::spawn(move || {
        for message in request_rx {
            let answered = match message {
                Ok((id, request)) => (id, worker_link.handle(request)),
                Err(rejected) => (rejected.id, Reply::of(Err(rejected.error))),
            };
            if reply_tx.send(answered).is_err() {
                return;
            }
        }
    });

    let mut subscription: Option<Subscription> = None;
    let mut seq: u64 = 0;
    let mut last_poll = Instant::now();
    let mut last_ping = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                if !queue(&request_tx, parse_message(text.as_str()), &mut socket) {
                    return;
                }
            }
            Ok(Message::Binary(_)) => {
                let refused = Rejected {
                    id: Value::Null,
                    error: LinkError::new("invalid_request", "binary frames are not read"),
                };
                if !queue(&request_tx, Err(refused), &mut socket) {
                    return;
                }
            }
            Ok(Message::Close(_)) => {
                let _ = socket.flush();
                return;
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(tungstenite::Error::Capacity(_)) => {
                close_oversized(&mut socket);
                return;
            }
            Err(_) => return,
        }

        while let Ok((id, reply)) = reply_rx.try_recv() {
            let message = match &reply.result {
                Ok(result) => response_ok(&id, result.clone()),
                Err(error) => response_error(&id, error),
            };
            if !send(&mut socket, &message) {
                return;
            }
            match reply.install {
                Some(Install::Set(next)) => subscription = Some(*next),
                Some(Install::Clear) => subscription = None,
                None => {}
            }
        }

        if last_poll.elapsed() >= POLL {
            last_poll = Instant::now();
            if let Some(active) = subscription.as_mut() {
                let tree = link.tree();
                let mut events = active.poll(&tree, |id, since| link.output_since(id, since));
                events.extend(active.poll_jobs(link.jobs()));
                for (name, data) in events {
                    seq += 1;
                    if !send(&mut socket, &event(seq, name, data)) {
                        return;
                    }
                }
            }
        }

        if last_ping.elapsed() >= PING_EVERY {
            last_ping = Instant::now();
            if socket.send(Message::Ping(Vec::new().into())).is_err() {
                return;
            }
        }
    }
}

// ---------------------------------------------------------------- Tauri glue

struct TauriHost {
    app: tauri::AppHandle,
    app_data: PathBuf,
}

impl LinkHost for TauriHost {
    fn policy(&self) -> LinkPolicy {
        policy::read_policy(&self.app_data)
    }

    fn notify(&self, input: NotificationInput) {
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
            eprintln!("Supervisor link: could not record a notification: {error}");
        }
    }
}

/// Bind and serve on a background thread, and look at running jobs on
/// another. Like the control socket, a socket that cannot be bound is logged
/// and the IDE opens without it.
pub fn start(app: &tauri::AppHandle, dispatcher: Arc<Dispatcher>) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else {
        eprintln!("Supervisor link: no app data directory");
        return;
    };
    let listener = match crate::control_socket::bind(&socket_path_in(&dir)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Supervisor link unavailable: {error}");
            return;
        }
    };
    let jobs = Arc::new(Jobs::load(jobs::jobs_path_in(&dir), jobs::now_ms()));
    let host = Arc::new(TauriHost {
        app: app.clone(),
        app_data: dir,
    });
    let link = Arc::new(Link::with_jobs(dispatcher, host, jobs));
    let ticker = link.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(JOB_TICK);
        ticker.tick_jobs(jobs::now_ms());
    });
    std::thread::spawn(move || serve(listener, link));
}
