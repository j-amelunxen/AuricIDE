use super::*;
use crate::agents::output_buffer::OutputBuffers;
use crate::agents::run_results::RunResults;
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use crate::control_socket::protocol::tests::sample_agent;
use crate::control_socket::tests::FakeBackend;
use crate::control_socket::{FrontendError, FrontendReply, PendingRequests};
use std::sync::Mutex;

#[derive(Default)]
struct FakeHost {
    policy: Mutex<LinkPolicy>,
    notified: Mutex<Vec<NotificationInput>>,
}

impl LinkHost for FakeHost {
    fn policy(&self) -> LinkPolicy {
        self.policy.lock().unwrap().clone()
    }

    fn notify(&self, input: NotificationInput) {
        self.notified.lock().unwrap().push(input);
    }
}

struct Harness {
    backend: Arc<FakeBackend>,
    buffers: Arc<OutputBuffers>,
    host: Arc<FakeHost>,
    link: Arc<Link>,
}

fn agent(id: &str, role: AgentRole, spawned_by: Option<&str>) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        name: id.into(),
        role,
        spawned_by_agent_id: spawned_by.map(str::to_string),
        ..sample_agent()
    }
}

/// A supervisor, its child, and an agent the human started.
fn fleet() -> Vec<AgentInfo> {
    vec![
        agent("agent-1", AgentRole::Supervisor, None),
        agent("agent-2", AgentRole::Worker, Some("agent-1")),
        agent("agent-3", AgentRole::Worker, None),
    ]
}

fn harness(agents: Vec<AgentInfo>) -> Harness {
    let pending = Arc::new(PendingRequests::default());
    let backend = Arc::new(FakeBackend {
        agents: Mutex::new(agents),
        pending: pending.clone(),
        ..FakeBackend::default()
    });
    pending.mark_ready();
    let buffers = Arc::new(OutputBuffers::default());
    let dispatcher = Arc::new(Dispatcher::new(
        backend.clone(),
        buffers.clone(),
        pending,
        Arc::new(RunResults::default()),
        Duration::from_millis(200),
    ));
    let host = Arc::new(FakeHost::default());
    let link = Arc::new(Link::new(dispatcher, host.clone()));
    Harness {
        backend,
        buffers,
        host,
        link,
    }
}

fn ask(link: &Link, line: &str) -> Result<Value, LinkError> {
    let (_, request) = parse_message(line).map_err(|rejected| rejected.error)?;
    link.handle(request).result
}

fn ids(value: &Value) -> Vec<String> {
    value["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|agent| agent["id"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn the_list_is_the_supervisor_tree_and_nothing_the_human_started() {
    let h = harness(fleet());
    let listed = ask(&h.link, r#"{"v":1,"id":1,"method":"agents.list"}"#).unwrap();
    assert_eq!(ids(&listed), vec!["agent-1", "agent-2"]);
    assert!(listed["agents"][0].get("outputBytes").is_some());
}

#[test]
fn an_agent_outside_the_tree_is_unknown_to_every_method() {
    let h = harness(fleet());
    for line in [
        r#"{"v":1,"id":1,"method":"agents.read","params":{"agentId":"agent-3"}}"#,
        r#"{"v":1,"id":1,"method":"agents.send","params":{"agentId":"agent-3","text":"y"}}"#,
        r#"{"v":1,"id":1,"method":"agents.kill","params":{"agentId":"agent-3"}}"#,
        r#"{"v":1,"id":1,"method":"events.subscribe","params":{"agentIds":["agent-3"]}}"#,
    ] {
        let error = ask(&h.link, line).expect_err(line);
        assert_eq!(error.code, "unknown_agent", "{line}");
    }
    assert!(h.backend.written.lock().unwrap().is_empty());
    assert!(h.backend.requests.lock().unwrap().is_empty());
}

/// The card leaves the list when an agent is killed (`agent.removed`), and its
/// console buffer carries no lineage, so the link cannot tell a finished tree
/// member from a finished agent of the human's. Both answer `unknown_agent`;
/// `agent_not_running` would confirm that a human's agent id exists.
#[test]
fn a_removed_agent_is_unknown_whoever_started_it() {
    let h = harness(fleet());
    h.buffers.append("agent-2", "done\n");
    h.buffers.append("agent-3", "done\n");
    h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id == "agent-1");
    for id in ["agent-2", "agent-3"] {
        for method in [
            format!(
                r#"{{"v":1,"id":1,"method":"agents.send","params":{{"agentId":"{id}","text":"y"}}}}"#
            ),
            format!(r#"{{"v":1,"id":1,"method":"agents.read","params":{{"agentId":"{id}"}}}}"#),
            format!(r#"{{"v":1,"id":1,"method":"agents.kill","params":{{"agentId":"{id}"}}}}"#),
        ] {
            let error = ask(&h.link, &method).expect_err(&method);
            assert_eq!(error.code, "unknown_agent", "{method}");
        }
    }
    assert!(h.backend.written.lock().unwrap().is_empty());
}

#[test]
fn typing_reaches_a_supervisor_and_its_children_with_enter_only_on_submit() {
    let h = harness(fleet());
    ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"agents.send","params":{"agentId":"agent-1","text":"go on"}}"#,
    )
    .unwrap();
    ask(
        &h.link,
        r#"{"v":1,"id":2,"method":"agents.send","params":{"agentId":"agent-2","text":"1","submit":false}}"#,
    )
    .unwrap();
    assert_eq!(
        *h.backend.written.lock().unwrap(),
        vec![
            ("agent-1".to_string(), "go on\r".to_string()),
            ("agent-2".to_string(), "1".to_string()),
        ]
    );
}

#[test]
fn a_kill_in_the_tree_goes_through_the_frontend() {
    let h = harness(fleet());
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: Some(json!({ "agentId": "agent-2", "killed": true })),
        error: None,
    });
    let killed = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"agents.kill","params":{"agentId":"agent-2"}}"#,
    )
    .unwrap();
    assert_eq!(killed, json!({ "agentId": "agent-2", "killed": true }));
    assert_eq!(h.backend.requests.lock().unwrap()[0].method, "kill");
}

#[test]
fn reading_returns_the_console_of_an_agent_in_the_tree() {
    let h = harness(fleet());
    h.buffers.append("agent-2", "hello\n");
    let chunk = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"agents.read","params":{"agentId":"agent-2"}}"#,
    )
    .unwrap();
    assert_eq!(chunk["text"], "hello\n");
    assert_eq!(chunk["endOffset"], 6);
}

#[test]
fn a_supervisor_spawn_is_handed_to_the_frontend_and_its_codes_pass_through() {
    let h = harness(fleet());
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: Some(json!({ "agentId": "agent-9" })),
        error: None,
    });
    let spawned = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"supervisors.spawn","params":{"task":"plan it"}}"#,
    )
    .unwrap();
    assert_eq!(spawned, json!({ "agentId": "agent-9" }));
    let request = h.backend.requests.lock().unwrap()[0].clone();
    assert_eq!(request.method, SPAWN_SUPERVISOR_METHOD);
    assert_eq!(request.params, json!({ "task": "plan it" }));

    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: false,
        result: None,
        error: Some(FrontendError {
            code: "supervisor_unavailable".into(),
            message: "allow a project first".into(),
        }),
    });
    let refused = ask(&h.link, r#"{"v":1,"id":2,"method":"supervisors.spawn"}"#).unwrap_err();
    assert_eq!(refused.code, "supervisor_unavailable");
}

#[test]
fn a_provider_the_supervisor_cannot_run_on_keeps_its_own_code() {
    let h = harness(fleet());
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: false,
        result: None,
        error: Some(FrontendError {
            code: "provider_unsupported".into(),
            message: "the supervisor cannot run on 'gemini' in this version".into(),
        }),
    });
    let refused = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"supervisors.spawn","params":{"provider":"gemini"}}"#,
    )
    .unwrap_err();
    assert_eq!(refused.code, "provider_unsupported");
    assert!(refused.message.contains("gemini"));
}

#[test]
fn a_spawn_nobody_answers_is_frontend_unavailable() {
    let h = harness(fleet());
    let refused = ask(&h.link, r#"{"v":1,"id":1,"method":"supervisors.spawn"}"#).unwrap_err();
    assert_eq!(refused.code, "frontend_unavailable");
}

#[test]
fn only_external_callers_are_admitted() {
    let h = harness(vec![]);
    assert!(h.link.admit_caller(Ok(Caller::External)).is_ok());
    let supervisor = h
        .link
        .admit_caller(Ok(Caller::Supervisor {
            agent_id: "agent-1".into(),
        }))
        .unwrap_err();
    assert_eq!(supervisor.code, "forbidden_agent_caller");
    let worker = h
        .link
        .admit_caller(Err(ControlError::new(
            ErrorCode::ForbiddenAgentCaller,
            "process 7 runs inside an IDE agent; agents may not steer other agents",
        )))
        .unwrap_err();
    assert_eq!(worker.code, "forbidden_agent_caller");
    assert!(worker.message.contains("supervisor link"));
}

#[test]
fn the_subscribe_answer_is_the_baseline_and_events_are_the_changes_after_it() {
    let h = harness(fleet());
    h.buffers.append("agent-1", "old text\n");
    let reply = h.link.handle(
        parse_message(r#"{"v":1,"id":1,"method":"events.subscribe"}"#)
            .unwrap()
            .1,
    );
    assert_eq!(
        ids(reply.result.as_ref().unwrap()),
        vec!["agent-1", "agent-2"]
    );
    let Some(Install::Set(subscription)) = reply.install else {
        panic!("subscribe installs a subscription");
    };
    let mut subscription = *subscription;
    let read = |id: &str, since: u64| h.link.output_since(id, since);

    assert!(subscription.poll(&h.link.tree(), read).is_empty());

    h.buffers.append("agent-1", "new line\n");
    h.backend
        .agents
        .lock()
        .unwrap()
        .push(agent("agent-4", AgentRole::Worker, Some("agent-1")));
    h.buffers.append("agent-4", "child starts\n");
    h.backend.agents.lock().unwrap()[1].status = AgentStatus::Idle;
    let events = subscription.poll(&h.link.tree(), read);
    let names: Vec<&str> = events.iter().map(|(name, _)| *name).collect();
    assert_eq!(
        names,
        vec![
            "agent.updated",
            "agent.added",
            "agent.output",
            "agent.output"
        ]
    );
    assert_eq!(events[0].1["agent"]["id"], "agent-2");
    assert_eq!(events[2].1["text"], "new line\n");
    assert_eq!(events[2].1["startOffset"], 9);
    assert_eq!(events[3].1["text"], "child starts\n");
    assert_eq!(events[3].1["startOffset"], 0);

    h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-2");
    let events = subscription.poll(&h.link.tree(), read);
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0],
        ("agent.removed", json!({ "agentId": "agent-2" }))
    );
}

#[test]
fn a_narrow_subscription_without_output_sees_only_its_agents_list_changes() {
    let h = harness(fleet());
    let reply = h.link.handle(
        parse_message(
            r#"{"v":1,"id":1,"method":"events.subscribe","params":{"agentIds":["agent-2"],"output":false}}"#,
        )
        .unwrap()
        .1,
    );
    let Some(Install::Set(subscription)) = reply.install else {
        panic!("subscribe installs a subscription");
    };
    let mut subscription = *subscription;
    h.buffers.append("agent-2", "noise\n");
    h.backend.agents.lock().unwrap()[0].status = AgentStatus::Idle;
    assert!(subscription
        .poll(&h.link.tree(), |id, since| h.link.output_since(id, since))
        .is_empty());
}

#[test]
fn since_offsets_continue_where_a_client_left_off() {
    let h = harness(fleet());
    h.buffers.append("agent-1", "0123456789");
    let reply = h.link.handle(
        parse_message(
            r#"{"v":1,"id":1,"method":"events.subscribe","params":{"sinceOffsets":{"agent-1":4}}}"#,
        )
        .unwrap()
        .1,
    );
    let Some(Install::Set(subscription)) = reply.install else {
        panic!("subscribe installs a subscription");
    };
    let mut subscription = *subscription;
    let events = subscription.poll(&h.link.tree(), |id, since| h.link.output_since(id, since));
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].1["text"], "456789");
}

#[test]
fn document_methods_see_no_project_without_a_policy() {
    let h = harness(vec![]);
    let projects = ask(&h.link, r#"{"v":1,"id":1,"method":"documents.projects"}"#).unwrap();
    assert_eq!(projects, json!({ "projects": [] }));
    let refused = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"documents.get","params":{"project":"/tmp","type":"t","id":"docs/a.json"}}"#,
    )
    .unwrap_err();
    assert_eq!(refused.code, "document_not_visible");
    let job = ask(
        &h.link,
        r#"{"v":1,"id":1,"method":"jobs.create","params":{"project":"/tmp","kind":"k","payload":null}}"#,
    )
    .unwrap_err();
    assert_eq!(job.code, "document_not_visible");
    assert!(h.host.notified.lock().unwrap().is_empty());
}

#[path = "tests_jobs.rs"]
mod jobs_flow;

// ------------------------------------------------------- over a real socket

mod socket {
    use super::*;
    use std::os::unix::net::UnixStream;
    use tungstenite::client::IntoClientRequest;

    fn serve_in(dir: &Path, link: Arc<Link>) -> PathBuf {
        let path = socket_path_in(dir);
        let listener = crate::control_socket::bind(&path).unwrap();
        std::thread::spawn(move || serve(listener, link));
        path
    }

    fn connect(path: &Path, uri: &str) -> Result<WebSocket<UnixStream>, String> {
        let stream = UnixStream::connect(path).map_err(|e| e.to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let request = uri.into_client_request().unwrap();
        tungstenite::client(request, stream)
            .map(|(socket, _)| socket)
            .map_err(|error| error.to_string())
    }

    fn next(socket: &mut WebSocket<UnixStream>) -> Value {
        loop {
            match socket.read().expect("a message") {
                Message::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
                Message::Close(frame) => panic!("closed: {frame:?}"),
                _ => {}
            }
        }
    }

    fn send_json(socket: &mut WebSocket<UnixStream>, value: Value) {
        socket.send(Message::text(value.to_string())).unwrap();
    }

    #[test]
    fn hello_subscribe_and_live_output_over_the_socket() {
        let h = harness(fleet());
        let dir = tempfile::tempdir().unwrap();
        let path = serve_in(dir.path(), h.link.clone());
        let mut socket = connect(&path, "ws://localhost/v1").unwrap();

        send_json(
            &mut socket,
            json!({ "v": 1, "id": "h", "method": "session.hello" }),
        );
        let hello = next(&mut socket);
        assert_eq!(hello["type"], "response");
        assert_eq!(hello["id"], "h");
        assert_eq!(hello["result"]["protocol"], 1);
        assert_eq!(hello["result"]["methods"], json!(METHODS));

        send_json(
            &mut socket,
            json!({ "v": 1, "id": 2, "method": "events.subscribe" }),
        );
        let subscribed = next(&mut socket);
        assert_eq!(subscribed["ok"], true);

        h.buffers.append("agent-1", "working\n");
        let output = next(&mut socket);
        assert_eq!(output["type"], "event");
        assert_eq!(output["seq"], 1);
        assert_eq!(output["event"], "agent.output");
        assert_eq!(output["data"]["text"], "working\n");

        send_json(
            &mut socket,
            json!({ "v": 9, "id": 3, "method": "agents.list" }),
        );
        let refused = next(&mut socket);
        assert_eq!(refused["ok"], false);
        assert_eq!(refused["error"]["code"], "unsupported_version");
    }

    #[test]
    fn another_path_is_refused_at_the_handshake() {
        let h = harness(vec![]);
        let dir = tempfile::tempdir().unwrap();
        let path = serve_in(dir.path(), h.link.clone());
        let error = connect(&path, "ws://localhost/v2").unwrap_err();
        assert!(error.contains("404"), "{error}");
    }

    #[test]
    fn a_binary_frame_is_answered_as_an_invalid_request() {
        let h = harness(vec![]);
        let dir = tempfile::tempdir().unwrap();
        let path = serve_in(dir.path(), h.link.clone());
        let mut socket = connect(&path, "ws://localhost/v1").unwrap();
        socket.send(Message::Binary(vec![1, 2, 3].into())).unwrap();
        let refused = next(&mut socket);
        assert_eq!(refused["error"]["code"], "invalid_request");
        assert_eq!(refused["id"], Value::Null);
    }
}
