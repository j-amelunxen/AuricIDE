use super::protocol::tests::sample_agent;
use super::*;
use serde_json::json;
use std::io::{BufRead, BufReader, Write};

#[derive(Default)]
struct FakeBackend {
    agents: Mutex<Vec<AgentInfo>>,
    written: Mutex<Vec<(String, String)>>,
    input_events: Mutex<Vec<AgentInputSentEvent>>,
    requests: Mutex<Vec<ControlRequestEvent>>,
    /// When set, every control request is answered with this, as the
    /// frontend would through `control_respond`.
    reply: Mutex<Option<FrontendReply>>,
    pending: Arc<PendingRequests>,
    projects: Mutex<Vec<ProjectEntry>>,
    /// A frontend that answers a kill with ok but does not actually kill.
    kill_leaves_agent: Mutex<bool>,
    agent_pids: Mutex<std::collections::HashSet<u32>>,
}

impl ControlBackend for FakeBackend {
    fn agents(&self) -> Vec<AgentInfo> {
        self.agents.lock().unwrap().clone()
    }

    fn agent_pids(&self) -> std::collections::HashSet<u32> {
        self.agent_pids.lock().unwrap().clone()
    }

    fn write_input(&self, agent_id: &str, data: &str) -> Result<(), String> {
        self.written
            .lock()
            .unwrap()
            .push((agent_id.to_string(), data.to_string()));
        Ok(())
    }

    fn emit_input_sent(&self, event: &AgentInputSentEvent) {
        self.input_events.lock().unwrap().push(event.clone());
    }

    fn emit_control_request(&self, event: &ControlRequestEvent) -> Result<(), String> {
        self.requests.lock().unwrap().push(event.clone());
        if let Some(reply) = self.reply.lock().unwrap().clone() {
            if event.method == "kill" && reply.ok && !*self.kill_leaves_agent.lock().unwrap() {
                let id = event.params["agentId"].as_str().unwrap().to_string();
                self.agents.lock().unwrap().retain(|agent| agent.id != id);
            }
            let pending = self.pending.clone();
            let req_id = event.req_id.clone();
            std::thread::spawn(move || pending.resolve(&req_id, reply));
        }
        Ok(())
    }

    fn projects(&self) -> Vec<ProjectEntry> {
        self.projects.lock().unwrap().clone()
    }
}

struct Harness {
    backend: Arc<FakeBackend>,
    buffers: Arc<OutputBuffers>,
    pending: Arc<PendingRequests>,
    dispatcher: Dispatcher,
}

fn harness_with(agents: Vec<AgentInfo>, timeout: Duration) -> Harness {
    let pending = Arc::new(PendingRequests::default());
    let backend = Arc::new(FakeBackend {
        agents: Mutex::new(agents),
        pending: pending.clone(),
        ..FakeBackend::default()
    });
    pending.mark_ready();
    let buffers = Arc::new(OutputBuffers::default());
    let dispatcher = Dispatcher::new(backend.clone(), buffers.clone(), pending.clone(), timeout);
    Harness {
        backend,
        buffers,
        pending,
        dispatcher,
    }
}

fn harness(agents: Vec<AgentInfo>) -> Harness {
    harness_with(agents, Duration::from_millis(50))
}

fn auric_project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".auric")).unwrap();
    std::fs::write(dir.path().join(".auric/project.db"), b"").unwrap();
    dir
}

fn agent(id: &str, headless: bool) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        headless,
        ..sample_agent()
    }
}

fn call(h: &Harness, request: Value) -> Value {
    serde_json::from_str(&h.dispatcher.handle_line(&request.to_string())).unwrap()
}

fn error_code(response: &Value) -> &str {
    assert_eq!(response["ok"], false, "{response}");
    response["error"]["code"].as_str().unwrap()
}

#[test]
fn list_agents_adds_the_output_offset() {
    let h = harness(vec![agent("agent-1", false)]);
    h.buffers.append("agent-1", "12345");
    let response = call(&h, json!({ "id": 1, "method": "list_agents" }));
    assert_eq!(response["result"]["agents"][0]["id"], "agent-1");
    assert_eq!(response["result"]["agents"][0]["outputBytes"], 5);
    assert_eq!(response["result"]["agents"][0]["headless"], false);
}

#[test]
fn read_output_serves_a_running_agent_that_printed_nothing() {
    let h = harness(vec![agent("agent-1", false)]);
    let response = call(
        &h,
        json!({ "id": 1, "method": "read_output", "params": { "agentId": "agent-1" } }),
    );
    assert_eq!(
        response["result"],
        json!({
            "agentId": "agent-1", "status": "running", "text": "",
            "startOffset": 0, "endOffset": 0, "truncated": false
        })
    );
}

#[test]
fn read_output_serves_a_finished_agent_with_its_final_status() {
    let h = harness(vec![]);
    h.buffers.append("agent-7", "boom\r\n");
    h.buffers.finish("agent-7", AgentStatus::Error);
    let response = call(
        &h,
        json!({ "id": 1, "method": "read_output", "params": { "agentId": "agent-7" } }),
    );
    assert_eq!(response["result"]["status"], "error");
    assert_eq!(response["result"]["text"], "boom\n");
    assert_eq!(response["result"]["endOffset"], 5);
}

#[test]
fn read_output_of_an_unknown_agent_is_refused() {
    let h = harness(vec![]);
    let response = call(
        &h,
        json!({ "id": 3, "method": "read_output", "params": { "agentId": "ghost" } }),
    );
    assert_eq!(error_code(&response), "unknown_agent");
    assert_eq!(response["id"], 3);
}

#[test]
fn send_input_writes_text_and_enter_and_reports_it_to_the_feed() {
    let h = harness(vec![agent("agent-2", false)]);
    let response = call(
        &h,
        json!({ "id": 5, "method": "send_input", "params": { "agentId": "agent-2", "text": "hallo" } }),
    );
    assert_eq!(
        response["result"],
        json!({ "agentId": "agent-2", "bytesWritten": 6 })
    );
    assert_eq!(
        *h.backend.written.lock().unwrap(),
        vec![("agent-2".to_string(), "hallo\r".to_string())]
    );
    assert_eq!(
        *h.backend.input_events.lock().unwrap(),
        vec![AgentInputSentEvent {
            agent_id: "agent-2".into(),
            text: "hallo".into()
        }]
    );
}

#[test]
fn a_bare_enter_nudge_is_written_but_not_recorded() {
    let h = harness(vec![agent("agent-2", false)]);
    let response = call(
        &h,
        json!({ "id": 6, "method": "send_input", "params": { "agentId": "agent-2", "text": "" } }),
    );
    assert_eq!(response["result"]["bytesWritten"], 1);
    assert!(h.backend.input_events.lock().unwrap().is_empty());
}

#[test]
fn send_input_is_refused_for_headless_finished_and_unknown_agents() {
    let h = harness(vec![agent("agent-h", true)]);
    h.buffers.finish("agent-done", AgentStatus::Idle);
    let send = |id: &str| {
        call(
            &h,
            json!({ "id": 1, "method": "send_input", "params": { "agentId": id, "text": "x" } }),
        )
    };
    assert_eq!(error_code(&send("agent-h")), "headless_no_stdin");
    assert_eq!(error_code(&send("agent-done")), "agent_not_running");
    assert_eq!(error_code(&send("ghost")), "unknown_agent");
    assert!(h.backend.written.lock().unwrap().is_empty());
}

#[test]
fn kill_goes_through_the_frontend_and_reports_the_contract_shape() {
    let h = harness(vec![agent("agent-3", false)]);
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: None,
        error: None,
    });
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "agent-3" } }),
    );
    assert_eq!(
        response["result"],
        json!({ "agentId": "agent-3", "killed": true })
    );
    let requests = h.backend.requests.lock().unwrap();
    assert_eq!(requests[0].method, "kill");
    assert_eq!(requests[0].params, json!({ "agentId": "agent-3" }));
}

#[test]
fn kill_of_an_unknown_agent_does_not_wait_for_the_frontend() {
    let h = harness_with(vec![], Duration::from_secs(30));
    let started = std::time::Instant::now();
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "ghost" } }),
    );
    assert_eq!(error_code(&response), "unknown_agent");
    assert!(started.elapsed() < Duration::from_secs(1));
    assert!(h.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn an_unanswered_frontend_request_times_out_and_is_forgotten() {
    let h = harness(vec![agent("agent-3", false)]);
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "agent-3" } }),
    );
    assert_eq!(error_code(&response), "frontend_unavailable");
    assert_eq!(h.pending.len(), 0);
    // A late answer finds nobody waiting and says so.
    let req_id = h.backend.requests.lock().unwrap()[0].req_id.clone();
    assert!(!h.pending.resolve(
        &req_id,
        FrontendReply {
            ok: true,
            result: None,
            error: None
        }
    ));
}

#[test]
fn spawn_checks_the_project_path_before_asking_the_frontend() {
    let h = harness(vec![]);
    let response = call(
        &h,
        json!({ "id": 7, "method": "spawn",
                "params": { "projectPath": "/definitely/not/here", "prompt": "go" } }),
    );
    assert_eq!(error_code(&response), "invalid_params");
    assert!(h.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn spawn_forwards_all_params_and_returns_the_new_agent_id() {
    let dir = auric_project();
    let project = dir.path().to_string_lossy().into_owned();
    let h = harness(vec![]);
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: Some(json!({ "agentId": "agent-4", "extra": 1 })),
        error: None,
    });
    let response = call(
        &h,
        json!({ "id": 7, "method": "spawn",
                "params": { "projectPath": project, "prompt": "run the tests" } }),
    );
    assert_eq!(response["result"], json!({ "agentId": "agent-4" }));
    let requests = h.backend.requests.lock().unwrap();
    assert_eq!(requests[0].method, "spawn");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    assert!(
        requests[0].expires_at > now && requests[0].expires_at <= now + 50,
        "expiresAt is when Rust stops waiting"
    );
    assert_eq!(
        requests[0].params,
        json!({
            "projectPath": project, "prompt": "run the tests", "provider": null,
            "model": null, "permissionMode": null, "headless": null, "name": null
        })
    );
}

#[test]
fn a_frontend_refusal_keeps_known_codes_and_demotes_unknown_ones() {
    let dir = auric_project();
    let project = dir.path().to_string_lossy().into_owned();
    let h = harness(vec![]);
    let spawn = |code: &str| {
        *h.backend.reply.lock().unwrap() = Some(FrontendReply {
            ok: false,
            result: None,
            error: Some(FrontendError {
                code: code.into(),
                message: "nope".into(),
            }),
        });
        call(
            &h,
            json!({ "id": 7, "method": "spawn", "params": { "projectPath": project, "prompt": "p" } }),
        )
    };
    assert_eq!(error_code(&spawn("provider_denied")), "provider_denied");
    let odd = spawn("oops");
    assert_eq!(error_code(&odd), "internal");
    assert!(odd["error"]["message"].as_str().unwrap().contains("oops"));
}

#[test]
fn list_projects_passes_the_backend_list_through() {
    let h = harness(vec![]);
    let entry = ProjectEntry {
        path: "/tmp/example-project".into(),
        name: "example-project".into(),
        starred: true,
        is_open: true,
        initialized: true,
        last_opened_at: None,
        running_agents: 0,
        description: None,
        description_source: None,
    };
    *h.backend.projects.lock().unwrap() = vec![entry];
    let response = call(&h, json!({ "id": "a", "method": "list_projects" }));
    assert_eq!(response["result"]["projects"][0]["isOpen"], true);
}

#[test]
fn a_kill_the_frontend_reports_but_did_not_happen_is_internal() {
    let h = harness(vec![agent("agent-3", false)]);
    *h.backend.kill_leaves_agent.lock().unwrap() = true;
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: None,
        error: None,
    });
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "agent-3" } }),
    );
    assert_eq!(error_code(&response), "internal");
}

#[test]
fn spawn_refuses_a_folder_that_is_not_an_auric_project() {
    let dir = tempfile::tempdir().unwrap();
    let h = harness(vec![]);
    let response = call(
        &h,
        json!({ "id": 7, "method": "spawn",
                "params": { "projectPath": dir.path(), "prompt": "go" } }),
    );
    assert_eq!(error_code(&response), "invalid_params");
    let message = response["error"]["message"].as_str().unwrap();
    assert!(message.contains(".auric/project.db"), "{message}");
    assert!(message.contains("open it once in AuricIDE"), "{message}");
    assert!(h.backend.requests.lock().unwrap().is_empty());
}

fn unready_harness(timeout: Duration) -> Harness {
    let h = harness_with(vec![agent("agent-3", false)], timeout);
    // `harness_with` marks the bridge ready; start this one over unready.
    let pending = Arc::new(PendingRequests::default());
    let backend = Arc::new(FakeBackend {
        agents: Mutex::new(vec![agent("agent-3", false)]),
        pending: pending.clone(),
        ..FakeBackend::default()
    });
    let dispatcher = Dispatcher::new(backend.clone(), h.buffers.clone(), pending.clone(), timeout);
    Harness {
        backend,
        buffers: h.buffers,
        pending,
        dispatcher,
    }
}

#[test]
fn a_request_before_the_bridge_is_ready_is_held_and_emitted_once_it_is() {
    let h = unready_harness(Duration::from_secs(5));
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: None,
        error: None,
    });
    let pending = h.pending.clone();
    let backend = h.backend.clone();
    let ready = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            backend.requests.lock().unwrap().is_empty(),
            "nothing is emitted before the bridge listens"
        );
        pending.mark_ready();
    });
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "agent-3" } }),
    );
    ready.join().unwrap();
    assert_eq!(response["result"]["killed"], true, "{response}");
    assert_eq!(h.backend.requests.lock().unwrap().len(), 1);
}

#[test]
fn a_bridge_that_never_gets_ready_times_out_without_emitting() {
    let h = unready_harness(Duration::from_millis(50));
    let response = call(
        &h,
        json!({ "id": 8, "method": "kill", "params": { "agentId": "agent-3" } }),
    );
    assert_eq!(error_code(&response), "frontend_unavailable");
    assert!(h.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn names_and_enter_match_the_contract() {
    let fixtures: Value = serde_json::from_str(super::protocol::tests::FIXTURES).unwrap();
    let events = &fixtures["events"];
    assert_eq!(events["controlRequest"], CONTROL_REQUEST_EVENT);
    assert_eq!(events["agentInputSent"], AGENT_INPUT_SENT_EVENT);
    // The command names are the function names Tauri registers.
    let name_of = |full: &'static str| full.rsplit("::").next().unwrap();
    assert_eq!(
        events["respondCommand"],
        name_of(std::any::type_name_of_val(&control_respond))
    );
    assert_eq!(
        events["readyCommand"],
        name_of(std::any::type_name_of_val(&control_ready))
    );
    assert_eq!(fixtures["enter"], ENTER);
    assert_eq!(
        fixtures["limits"]["connectionIdleTimeoutMs"],
        CONNECTION_IDLE_TIMEOUT.as_millis() as u64
    );
    assert_eq!(
        fixtures["limits"]["frontendTimeoutMs"],
        FRONTEND_TIMEOUT.as_millis() as u64
    );
}

// ── Over a real socket ──────────────────────────────────────────────────────

fn roundtrip(stream: &mut UnixStream, reader: &mut BufReader<UnixStream>, line: &str) -> Value {
    writeln!(stream, "{line}").unwrap();
    let mut response = String::new();
    reader.read_line(&mut response).unwrap();
    serde_json::from_str(&response).unwrap()
}

#[test]
fn socket_answers_several_requests_on_one_connection_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    let listener = bind(&path).unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);

    let h = harness(vec![]);
    let dispatcher = Arc::new(h.dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_secs(5)));

    let mut stream = UnixStream::connect(&path).unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());

    let listed = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":1,"method":"list_agents"}"#,
    );
    assert_eq!(
        listed,
        json!({ "id": 1, "ok": true, "result": { "agents": [] } })
    );

    let unknown = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":2,"method":"read_output","params":{"agentId":"agent-9"}}"#,
    );
    assert_eq!(unknown["id"], 2);
    assert_eq!(error_code(&unknown), "unknown_agent");

    let garbage = roundtrip(&mut stream, &mut reader, "{ nope");
    assert_eq!(garbage["id"], Value::Null);
    assert_eq!(error_code(&garbage), "invalid_request");

    // The connection survives a bad line.
    let again = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":"x","method":"list_agents"}"#,
    );
    assert_eq!(again["id"], "x");
    assert_eq!(again["ok"], true);
}

#[test]
fn an_idle_connection_is_closed() {
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    let listener = bind(&path).unwrap();
    let dispatcher = Arc::new(harness(vec![]).dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_millis(100)));

    let stream = UnixStream::connect(&path).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    assert_eq!(reader.read_line(&mut line).unwrap(), 0, "server hung up");
}

#[test]
fn a_caller_inside_an_agent_is_refused_at_connect() {
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    let listener = bind(&path).unwrap();
    let h = harness(vec![]);
    // This test process descends from its parent; pretend that is an agent.
    *h.backend.agent_pids.lock().unwrap() = [std::os::unix::process::parent_id()].into();
    let dispatcher = Arc::new(h.dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_secs(5)));

    let mut stream = UnixStream::connect(&path).unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let refused = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":7,"method":"list_agents"}"#,
    );
    assert_eq!(refused["id"], 7, "answered under the request's own id");
    assert_eq!(error_code(&refused), "forbidden_agent_caller");
    let mut rest = String::new();
    assert_eq!(
        reader.read_line(&mut rest).unwrap(),
        0,
        "and the connection is closed"
    );
}

/// The whole path with real processes: a shell stands in for the agent and
/// its `nc` child connects. Needs `nc` with `-U` (macOS ships it).
#[test]
fn a_real_process_inside_an_agent_is_refused_over_the_socket() {
    if std::process::Command::new("nc").arg("-h").output().is_err() {
        eprintln!("skipped: no nc on this machine");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    let listener = bind(&path).unwrap();
    let h = harness(vec![]);
    let backend = h.backend.clone();
    let dispatcher = Arc::new(h.dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_secs(5)));

    let script = format!(
        "sleep 0.3; printf '%s\\n' '{{\"id\":3,\"method\":\"list_agents\"}}' | nc -U '{}'",
        path.display()
    );
    let agent = std::process::Command::new("sh")
        .args(["-c", &script])
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    // Registered before `nc` starts, as a running agent's PID would be.
    *backend.agent_pids.lock().unwrap() = [agent.id()].into();
    let output = agent.wait_with_output().unwrap();
    let line = String::from_utf8_lossy(&output.stdout);
    let response: Value = serde_json::from_str(line.trim()).unwrap_or_else(|_| panic!("{line}"));
    assert_eq!(response["id"], 3);
    assert_eq!(error_code(&response), "forbidden_agent_caller");
}

#[test]
fn binding_replaces_a_stale_socket_but_not_a_live_one() {
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    std::fs::write(&path, b"left behind").unwrap();
    let live = bind(&path).expect("a stale file is replaced");
    assert!(bind(&path).is_err(), "a socket that answers is kept");
    drop(live);
}

/// Runs `list_agents` against the socket of the AuricIDE running on this
/// machine — the only check of the real wiring (managed state, setup, the
/// path under the app data dir). Start the app, then:
///
/// ```bash
/// cd src-tauri && cargo test control_socket_against_running_app -- --ignored --nocapture
/// ```
///
/// `AURIC_CONTROL_SOCKET` overrides the path, as it does for the client.
#[test]
#[ignore = "needs a running AuricIDE"]
fn control_socket_against_running_app() {
    let path = std::env::var_os("AURIC_CONTROL_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME").expect("HOME");
            socket_path_in(
                &PathBuf::from(home).join("Library/Application Support/com.auricide.ide"),
            )
        });
    let mut stream =
        UnixStream::connect(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let response = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":1,"method":"list_agents"}"#,
    );
    println!("{response:#}");
    assert_eq!(response["ok"], true, "{response}");
    assert!(response["result"]["agents"].is_array());
}
