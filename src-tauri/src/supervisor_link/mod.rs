//! The supervisor link: a WebSocket over a unix socket through which a
//! companion app starts, watches and talks to supervisors, and reads
//! and proposes scenes (`docs/design-supervisor-link.md`).
//!
//! Layout: `protocol` is the wire format, `Link` answers one request inside
//! the link's scope, `Subscription` turns the agent list and output buffers
//! into events, `serve` runs the socket. Agent work goes through the control
//! socket's `Dispatcher` as an external caller, after `Link` has narrowed it
//! to the supervisor tree, so the link never has a right `control.sock` does
//! not already give the same process. `scenes` and `policy` are the scene half.

pub mod policy;
pub mod protocol;
pub mod scenes;
mod subscription;

#[cfg(test)]
mod tests;

use crate::control_socket::protocol::AgentSummary;
use crate::control_socket::protocol::{
    AgentIdParams, ControlError, ErrorCode, ReadOutputParams, Request, SendInputParams,
    DEFAULT_TAIL_BYTES,
};
use crate::control_socket::{Caller, Dispatcher};
use crate::notifications::NotificationInput;
use policy::LinkPolicy;
use protocol::*;
use scenes::SceneError;
use serde_json::{json, Value};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
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
/// How long one read waits before the loop turns to answers and events.
const READ_SLICE: Duration = Duration::from_millis(50);

/// What the link needs from the running app beyond the dispatcher. Over Tauri
/// state in `TauriHost`, by a fake in the tests.
pub trait LinkHost: Send + Sync {
    /// The scene policy as the file says now. Missing or broken: nothing visible.
    fn policy(&self) -> LinkPolicy;
    /// Drops a notification into the inbox (a scene proposal was made).
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
}

/// Whether an agent belongs to the supervisor tree: a supervisor, or an agent
/// a supervisor started. Only a supervisor's spawn sets `spawnedByAgentId`, so
/// that field alone is the second half; it also keeps a child in the tree
/// after its supervisor's card was cleared.
pub fn in_tree(agent: &AgentSummary) -> bool {
    agent.info.role == crate::agents::AgentRole::Supervisor
        || agent.info.spawned_by_agent_id.is_some()
}

fn to_value(result: impl serde::Serialize) -> Result<Value, LinkError> {
    serde_json::to_value(result)
        .map_err(|error| LinkError::new("internal", format!("could not serialise: {error}")))
}

impl From<SceneError> for LinkError {
    fn from(error: SceneError) -> Self {
        LinkError::new(error.code.as_str(), error.message)
    }
}

impl Link {
    pub fn new(dispatcher: Arc<Dispatcher>, host: Arc<dyn LinkHost>) -> Self {
        Self { dispatcher, host }
    }

    /// The supervisor tree as the IDE lists it now.
    pub fn tree(&self) -> Vec<AgentSummary> {
        self.dispatcher
            .summaries()
            .into_iter()
            .filter(in_tree)
            .collect()
    }

    /// Refuses an id outside the tree exactly like one that does not exist,
    /// so the companion learns nothing about agents it may not touch.
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
            LinkRequest::SceneProjects => {
                to_value(json!({ "projects": scenes::visible_projects(&self.host.policy()) }))
            }
            LinkRequest::SceneSearch(params) => {
                let limit = params.limit.unwrap_or(DEFAULT_SEARCH_LIMIT) as usize;
                let found = scenes::search(
                    &self.host.policy(),
                    params.query.as_deref(),
                    params.project.as_deref(),
                    limit,
                )?;
                to_value(json!({ "scenes": found }))
            }
            LinkRequest::SceneGet(params) => to_value(scenes::get(
                &self.host.policy(),
                &params.project,
                &params.id,
                params.rev.as_deref(),
            )?),
            LinkRequest::SceneResolve(params) => to_value(scenes::resolve(
                &self.host.policy(),
                &params.project,
                &params.from,
                &params.reference,
                params.rev.as_deref(),
            )?),
            LinkRequest::ScenePropose(params) => self.propose(params),
            LinkRequest::Subscribe(_) | LinkRequest::Unsubscribe => Err(LinkError::new(
                "internal",
                "subscriptions are handled by Link::handle",
            )),
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

    fn propose(&self, params: ProposeParams) -> Result<Value, LinkError> {
        let base = params.base()?;
        let proposal = scenes::propose(
            &self.host.policy(),
            &params.project,
            &params.id,
            &params.scene,
            base,
            params.message.as_deref(),
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
        let subscription = Subscription::start(&params, &tree);
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

/// The control-request method the frontend answers for `supervisors.spawn`.
pub const SPAWN_SUPERVISOR_METHOD: &str = "spawn_supervisor";

fn proposal_notification(proposal: &scenes::Proposal) -> NotificationInput {
    let project_name = Path::new(&proposal.project)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    let verb = if proposal.created {
        "new scene"
    } else {
        "change to"
    };
    NotificationInput {
        uid: None,
        project_path: Some(proposal.project.clone()),
        project_name,
        // Not the user's own words: a companion app wrote it.
        source: "mcp".to_string(),
        origin: Some("supervisor-link".to_string()),
        kind: Some("info".to_string()),
        severity: Some("info".to_string()),
        title: format!("Scene proposal: {verb} {}", proposal.id),
        body: Some(format!(
            "Proposed over the supervisor link as branch {} (commit {}). \
             Nothing in your working tree changed. Review the branch in the Git panel, \
             then merge it or delete it.",
            proposal.branch,
            &proposal.commit[..proposal.commit.len().min(12)],
        )),
        actions: None,
        dedupe_key: None,
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    }
}

// ---------------------------------------------------------------- transport

pub fn socket_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SOCKET_FILE_NAME)
}

/// Accept connections until the listener fails, one thread per connection.
pub fn serve(listener: UnixListener, link: Arc<Link>) {
    for stream in listener.incoming() {
        let Ok(stream) = stream else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let link = link.clone();
        std::thread::spawn(move || handle_connection(stream, &link));
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

fn handshake(stream: UnixStream) -> Option<WebSocket<UnixStream>> {
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

fn handle_connection(stream: UnixStream, link: &Arc<Link>) {
    // The peer is checked on the raw socket, before anything it sends is read.
    let admitted = link.admit(&stream);
    let Some(mut socket) = handshake(stream) else {
        return;
    };
    if let Err(error) = admitted {
        send(&mut socket, &fatal(&error));
        close(&mut socket, CloseCode::Policy, "forbidden_agent_caller");
        return;
    }
    if socket.get_ref().set_read_timeout(Some(READ_SLICE)).is_err() {
        return;
    }

    // Requests run on a worker of their own, in order, so a spawn that waits
    // for the IDE window does not hold the events back.
    let (request_tx, request_rx) = mpsc::channel::<Result<(Value, LinkRequest), Rejected>>();
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
                if request_tx.send(parse_message(text.as_str())).is_err() {
                    return;
                }
            }
            Ok(Message::Binary(_)) => {
                let refused = Rejected {
                    id: Value::Null,
                    error: LinkError::new("invalid_request", "binary frames are not read"),
                };
                if request_tx.send(Err(refused)).is_err() {
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
                close(&mut socket, CloseCode::Size, "message too large");
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
                for (name, data) in active.poll(&tree, |id, since| link.output_since(id, since)) {
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
            eprintln!("Supervisor link: could not record the proposal notification: {error}");
        }
    }
}

/// Bind and serve on a background thread. Like the control socket, a socket
/// that cannot be bound is logged and the IDE opens without it.
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
    let host = Arc::new(TauriHost {
        app: app.clone(),
        app_data: dir,
    });
    let link = Arc::new(Link::new(dispatcher, host));
    std::thread::spawn(move || serve(listener, link));
}
