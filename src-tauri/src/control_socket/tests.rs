use super::protocol::tests::sample_agent;
use super::*;
use crate::agents::run_results::{FinishedChild, RunResult};
use serde_json::json;
use std::io::{BufRead, BufReader, Write};

/// Shared with the supervisor link's tests, which drive the same dispatcher.
#[derive(Default)]
pub(crate) struct FakeBackend {
    pub(crate) agents: Mutex<Vec<AgentInfo>>,
    pub(crate) written: Mutex<Vec<(String, String)>>,
    pub(crate) fail_input: Mutex<HashSet<String>>,
    pub(crate) input_events: Mutex<Vec<AgentInputSentEvent>>,
    pub(crate) requests: Mutex<Vec<ControlRequestEvent>>,
    /// When set, every control request is answered with this, as the
    /// frontend would through `control_respond`.
    pub(crate) reply: Mutex<Option<FrontendReply>>,
    pub(crate) pending: Arc<PendingRequests>,
    pub(crate) projects: Mutex<Vec<ProjectEntry>>,
    /// A frontend that answers a kill with ok but does not actually kill.
    pub(crate) kill_leaves_agent: Mutex<bool>,
    pub(crate) agent_pids: Mutex<HashMap<u32, (String, AgentRole)>>,
    pub(crate) policy: Mutex<SupervisorPolicy>,
    pub(crate) offered: Mutex<BTreeMap<String, Vec<ModelOption>>>,
    pub(crate) modes: Mutex<BTreeMap<String, crate::supervisor::policy::ProviderModes>>,
    pub(crate) project_policies: Mutex<HashMap<String, ProviderPolicy>>,
    /// Where `link_policy_*` keeps the link policy; `None` like an app
    /// without a data directory.
    pub(crate) app_data: Mutex<Option<PathBuf>>,
    pub(crate) notified: Mutex<Vec<crate::notifications::NotificationInput>>,
    /// Finished runs per provider, the same for every project.
    pub(crate) recent_runs: Mutex<BTreeMap<String, u32>>,
    /// Agents whose console holds a half-typed message from the human.
    pub(crate) drafting: Mutex<Vec<String>>,
}

impl ControlBackend for FakeBackend {
    fn human_drafting(&self, agent_id: &str) -> bool {
        self.drafting
            .lock()
            .unwrap()
            .iter()
            .any(|id| id == agent_id)
    }

    fn agents(&self) -> Vec<AgentInfo> {
        self.agents.lock().unwrap().clone()
    }

    fn agent_pids(&self) -> HashMap<u32, (String, AgentRole)> {
        self.agent_pids.lock().unwrap().clone()
    }

    fn supervisor_policy(&self) -> SupervisorPolicy {
        self.policy.lock().unwrap().clone()
    }

    fn offered_models(&self) -> BTreeMap<String, Vec<ModelOption>> {
        self.offered.lock().unwrap().clone()
    }

    fn provider_modes(
        &self,
        _policy: &SupervisorPolicy,
    ) -> BTreeMap<String, crate::supervisor::policy::ProviderModes> {
        self.modes.lock().unwrap().clone()
    }

    fn recent_runs(&self, _project_root: &Path, _since: &str) -> BTreeMap<String, u32> {
        self.recent_runs.lock().unwrap().clone()
    }

    fn project_provider_policy(&self, project_root: &Path) -> ProviderPolicy {
        self.project_policies
            .lock()
            .unwrap()
            .get(&project_root.to_string_lossy().into_owned())
            .cloned()
            .unwrap_or_default()
    }

    fn app_data_dir(&self) -> Option<PathBuf> {
        self.app_data.lock().unwrap().clone()
    }

    fn notify(&self, input: crate::notifications::NotificationInput) {
        self.notified.lock().unwrap().push(input);
    }

    fn write_input(&self, agent_id: &str, data: &str) -> Result<(), String> {
        self.written
            .lock()
            .unwrap()
            .push((agent_id.to_string(), data.to_string()));
        if self.fail_input.lock().unwrap().contains(agent_id) {
            return Err("injected PTY write failure".into());
        }
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
    run_results: Arc<RunResults>,
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
    let run_results = Arc::new(RunResults::default());
    let dispatcher = Dispatcher::new(
        backend.clone(),
        buffers.clone(),
        pending.clone(),
        run_results.clone(),
        timeout,
    );
    Harness {
        backend,
        buffers,
        pending,
        run_results,
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
    call_as(h, &Caller::External, request)
}

fn call_as(h: &Harness, caller: &Caller, request: Value) -> Value {
    serde_json::from_str(&h.dispatcher.handle_line(caller, &request.to_string())).unwrap()
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
fn a_multi_line_message_goes_in_as_one_bracketed_paste_when_the_tui_asked_for_it() {
    let h = harness(vec![agent("agent-2", false)]);
    h.buffers.append("agent-2", "\x1b[?2004h❯ ");
    let text = "Bitte prüfe das.\nDann starte den kleinsten Schnitt.";
    let response = call(
        &h,
        json!({ "id": 5, "method": "send_input", "params": { "agentId": "agent-2", "text": text } }),
    );
    let expected = format!("\x1b[200~{text}\x1b[201~\r");
    assert_eq!(response["result"]["bytesWritten"], expected.len());
    assert_eq!(
        *h.backend.written.lock().unwrap(),
        vec![("agent-2".to_string(), expected)]
    );
    // The feed shows what was said, not the markers.
    assert_eq!(h.backend.input_events.lock().unwrap()[0].text, text);
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
            "model": null, "permissionMode": null, "headless": null, "name": null,
            "role": null, "worktree": null
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
        supervisor: None,
    };
    let other = ProjectEntry {
        path: "/tmp/other-project".into(),
        name: "other-project".into(),
        ..entry.clone()
    };
    *h.backend.projects.lock().unwrap() = vec![entry, other];
    let response = call(&h, json!({ "id": "a", "method": "list_projects" }));
    assert_eq!(response["result"]["projects"][0]["isOpen"], true);
    assert!(
        response["result"].get("catalog").is_none(),
        "only a supervisor gets a catalog"
    );
    let named = |project: &str| {
        call(
            &h,
            json!({ "id": "a", "method": "list_projects", "params": { "project": project } }),
        )
    };
    for wanted in ["Other-Project", "/tmp/other-project/"] {
        let paths: Vec<Value> = named(wanted)["result"]["projects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["path"].clone())
            .collect();
        assert_eq!(paths, vec![json!("/tmp/other-project")], "{wanted}");
    }
    assert_eq!(error_code(&named("nope")), "unknown_project");
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
    let dispatcher = Dispatcher::new(
        backend.clone(),
        h.buffers.clone(),
        pending.clone(),
        h.run_results.clone(),
        timeout,
    );
    Harness {
        backend,
        buffers: h.buffers,
        pending,
        run_results: h.run_results,
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
    *h.backend.agent_pids.lock().unwrap() = [(
        std::os::unix::process::parent_id(),
        ("agent-w".to_string(), AgentRole::Worker),
    )]
    .into();
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
    *backend.agent_pids.lock().unwrap() =
        [(agent.id(), ("agent-w".to_string(), AgentRole::Worker))].into();
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

// ── Supervisor scope (ADR 0004) ─────────────────────────────────────────────

const SUPERVISOR_PID: u32 = 100;
const CHILD_PID: u32 = 200;

struct Scope {
    h: Harness,
    _project: tempfile::TempDir,
    path: String,
    supervisor: Caller,
}

fn model(value: &str, rank: Option<i64>) -> ModelOption {
    ModelOption {
        value: value.into(),
        label: format!("Label {value}"),
        rank,
        ..Default::default()
    }
}

fn agent_in(id: &str, parent: Option<&str>, project: &str, status: AgentStatus) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        status,
        project_path: Some(project.into()),
        spawned_by_agent_id: parent.map(str::to_string),
        ..sample_agent()
    }
}

fn scope_policy(path: &str) -> SupervisorPolicy {
    serde_json::from_value(json!({
        "version": 1,
        "supervisor": { "provider": "claude", "model": null },
        "maxRunningChildren": 4,
        "projects": {
            path: {
                "allowed": true, "providers": ["claude", "codex"],
                "models": { "claude": ["haiku"] },
                "permissionMode": { "codex": "acceptEdits" },
                "allowInteractive": true, "maxRunning": 2
            },
            "/abs/not-allowed": { "allowed": false, "providers": null, "models": {},
                "permissionMode": {}, "allowInteractive": false, "maxRunning": 2 }
        }
    }))
    .unwrap()
}

/// A supervisor `agent-sup` with one running child in an allowed project and
/// one finished child (`agent-done`), a child of another supervisor, an agent
/// the human started, and the stored result of a child whose supervisor is
/// gone.
// code-gate: complexity-function-length - one fixture world; every caller-scope case reads all of it
fn supervised_scope() -> Scope {
    let project = auric_project();
    let path = crate::supervisor::canonical_project_path(&project.path().to_string_lossy());
    let supervisor = AgentInfo {
        id: "agent-sup".into(),
        role: AgentRole::Supervisor,
        project_path: None,
        ..sample_agent()
    };
    let h = harness(vec![
        supervisor,
        agent_in(
            "agent-child",
            Some("agent-sup"),
            &path,
            AgentStatus::Running,
        ),
        agent_in(
            "agent-other",
            Some("agent-sup-2"),
            &path,
            AgentStatus::Running,
        ),
        agent_in("agent-human", None, &path, AgentStatus::Running),
    ]);
    *h.backend.policy.lock().unwrap() = scope_policy(&path);
    *h.backend.offered.lock().unwrap() = BTreeMap::from([
        (
            "claude".to_string(),
            vec![model("haiku", Some(1)), model("opus", Some(3))],
        ),
        (
            "codex".to_string(),
            vec![
                model("gpt-6-luna", Some(1)),
                model("gpt-6-sol", Some(3)),
                model("auto", None),
            ],
        ),
    ]);
    *h.backend.agent_pids.lock().unwrap() = HashMap::from([
        (
            SUPERVISOR_PID,
            ("agent-sup".to_string(), AgentRole::Supervisor),
        ),
        (CHILD_PID, ("agent-child".to_string(), AgentRole::Worker)),
    ]);
    h.run_results.record(
        RunResult::from_finish(
            "agent-orphan",
            AgentStatus::Idle,
            Some(0),
            None,
            || Some("ANSWER: done".into()),
            1,
        ),
        Some("agent-dead".into()),
    );
    h.run_results.record_finished(
        RunResult::from_finish(
            "agent-done",
            AgentStatus::Error,
            Some(1),
            None,
            || Some("Error: tests failed".into()),
            2,
        ),
        agent_in("agent-done", Some("agent-sup"), &path, AgentStatus::Running),
    );
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: Some(json!({ "agentId": "agent-new" })),
        error: None,
    });
    Scope {
        h,
        _project: project,
        path,
        supervisor: Caller::Supervisor {
            agent_id: "agent-sup".into(),
        },
    }
}

/// A process whose parent is `ancestor` (or with no agent above it).
fn below(ancestor: Option<u32>) -> impl Fn(u32) -> Option<u32> {
    move |pid| match (pid, ancestor) {
        (999, Some(agent)) => Some(agent),
        _ => Some(1),
    }
}

#[test]
fn admission_tells_external_supervisor_and_worker_callers_apart() {
    let s = supervised_scope();
    let d = &s.h.dispatcher;
    assert_eq!(d.admit_peer(Some(999), below(None)), Ok(Caller::External));
    assert_eq!(
        d.admit_peer(Some(999), below(Some(SUPERVISOR_PID))),
        Ok(s.supervisor.clone())
    );
    assert_eq!(
        d.admit_peer(Some(SUPERVISOR_PID), below(None)),
        Ok(s.supervisor.clone()),
        "the supervisor process itself"
    );
    for refused in [
        d.admit_peer(Some(999), below(Some(CHILD_PID))),
        d.admit_peer(None, below(None)),
    ] {
        assert_eq!(refused.unwrap_err().code, ErrorCode::ForbiddenAgentCaller);
    }
}

#[test]
fn every_caller_scope_case_in_the_contract_holds() {
    let fixtures: Value = serde_json::from_str(super::protocol::tests::FIXTURES).unwrap();
    let cases = fixtures["callerScope"]["cases"].as_array().unwrap();
    assert!(!cases.is_empty());
    for case in cases {
        let s = supervised_scope();
        let app = tempfile::tempdir().unwrap();
        *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
        let name = case["name"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();
        let admitted = match case["caller"].as_str().unwrap() {
            "external" => s.h.dispatcher.admit_peer(Some(999), below(None)),
            "supervisor" => {
                s.h.dispatcher
                    .admit_peer(Some(999), below(Some(SUPERVISOR_PID)))
            }
            "worker" => s.h.dispatcher.admit_peer(Some(999), below(Some(CHILD_PID))),
            "unknown" => s.h.dispatcher.admit_peer(None, below(None)),
            other => panic!("{name}: unknown caller {other}"),
        };
        let caller = match admitted {
            Ok(caller) => caller,
            Err(error) => {
                assert_eq!(json!(error.code), json!(expected), "{name}");
                continue;
            }
        };
        let target = match case["target"].as_str() {
            Some("own_child") => "agent-child",
            Some("other_supervisors_child") => "agent-other",
            Some("self") => "agent-sup",
            Some("child_of_killed_supervisor") => "agent-orphan",
            Some("own_finished_child") => "agent-done",
            _ => "agent-human",
        };
        let method = case["method"].as_str().unwrap();
        let mut params = match method {
            "spawn" => json!({ "projectPath": s.path, "prompt": "x" }),
            "send_input" => json!({ "agentId": target, "text": "hi" }),
            "await_result" => json!({ "agentId": target, "waitSeconds": 0 }),
            "list_agents" | "list_projects" | "link_policy_get" => json!({}),
            "link_policy_propose" => json!({
                "reason": "x",
                "changes": [{ "op": "set_daily_limit", "dailyLimit": 7 }],
            }),
            _ => json!({ "agentId": target }),
        };
        if let Some(extra) = case.get("params").and_then(Value::as_object) {
            for (key, value) in extra {
                params[key] = if value == "<scope project name>" {
                    json!(super::projects::project_name(&s.path))
                } else {
                    value.clone()
                };
            }
        }
        let response = call_as(
            &s.h,
            &caller,
            json!({ "id": 1, "method": method, "params": params }),
        );
        match expected {
            "ok" => assert_eq!(response["ok"], true, "{name}: {response}"),
            "ok_own_children_only" => {
                let ids: Vec<&str> = response["result"]["agents"]
                    .as_array()
                    .unwrap_or_else(|| panic!("{name}: {response}"))
                    .iter()
                    .map(|agent| agent["id"].as_str().unwrap())
                    .collect();
                assert_eq!(ids, vec!["agent-child", "agent-done"], "{name}");
            }
            code => assert_eq!(error_code(&response), code, "{name}: {response}"),
        }
    }
}

#[test]
fn a_supervisor_spawn_reaches_the_frontend_with_what_rust_decided() {
    let s = supervised_scope();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": format!("{}/", s.path), "prompt": "reply PONG",
            "provider": "codex", "model": "gpt-6-luna", "headless": true, "name": "Ping"
        } }),
    );
    assert_eq!(
        response["result"],
        json!({ "agentId": "agent-new" }),
        "{response}"
    );
    let requests = s.h.backend.requests.lock().unwrap();
    assert_eq!(
        requests[0].params,
        json!({
            "projectPath": s.path, "prompt": "reply PONG", "provider": "codex",
            "model": "gpt-6-luna", "permissionMode": "acceptEdits", "headless": true,
            "name": "Ping", "role": "worker", "spawnedByAgentId": "agent-sup",
            "runSource": "supervisor", "worktree": null
        })
    );
}

#[test]
fn a_refused_spawn_names_its_reason_and_never_reaches_the_frontend() {
    let s = supervised_scope();
    let spawn = |provider: &str, model: &str, headless: bool| {
        call_as(
            &s.h,
            &s.supervisor,
            json!({ "id": 7, "method": "spawn", "params": {
                "projectPath": s.path, "prompt": "p",
                "provider": provider, "model": model, "headless": headless
            } }),
        )
    };
    let refused = spawn("claude", "opus", true);
    assert_eq!(error_code(&refused), "supervisor_denied");
    assert_eq!(refused["error"]["reason"], "model_not_allowed");
    assert!(refused["error"]["message"]
        .as_str()
        .unwrap()
        .contains("Allowed: haiku"));
    assert_eq!(
        spawn("grok", "grok-5", true)["error"]["reason"],
        "provider_not_installed"
    );
    let elsewhere = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": "/abs/not-allowed", "prompt": "p",
            "provider": "claude", "model": "haiku", "headless": true
        } }),
    );
    assert_eq!(elsewhere["error"]["reason"], "project_not_allowed");
    assert!(s.h.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn the_project_policy_applies_on_top_of_the_supervisor_policy() {
    let s = supervised_scope();
    s.h.backend.project_policies.lock().unwrap().insert(
        s.path.clone(),
        ProviderPolicy {
            allow: None,
            deny: vec!["claude".into()],
        },
    );
    let refused = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": s.path, "prompt": "p",
            "provider": "claude", "model": "haiku", "headless": true
        } }),
    );
    assert_eq!(refused["error"]["reason"], "provider_denied_by_project");
}

#[test]
fn the_limit_counts_this_supervisors_running_and_queued_children() {
    let s = supervised_scope();
    s.h.backend.agents.lock().unwrap().push(agent_in(
        "agent-child-2",
        Some("agent-sup"),
        &s.path,
        AgentStatus::Queued,
    ));
    let refused = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": s.path, "prompt": "p",
            "provider": "claude", "model": "haiku", "headless": true
        } }),
    );
    assert_eq!(refused["error"]["reason"], "project_limit_reached");
}

#[test]
fn an_external_caller_starts_a_supervisor_and_role_reaches_the_frontend() {
    let s = supervised_scope();
    let response = call(
        &s.h,
        json!({ "id": 16, "method": "spawn", "params": {
            "projectPath": s.path, "prompt": "supervise", "role": "supervisor"
        } }),
    );
    assert_eq!(response["ok"], true, "{response}");
    let params = &s.h.backend.requests.lock().unwrap()[0].params;
    assert_eq!(params["role"], "supervisor");
    assert!(params.get("spawnedByAgentId").is_none());
    assert!(params.get("runSource").is_none());
}

#[test]
fn await_result_wakes_when_the_result_lands() {
    let s = supervised_scope();
    let results = s.h.run_results.clone();
    let landing = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        results.record(
            RunResult::from_finish(
                "agent-child",
                AgentStatus::Idle,
                Some(0),
                None,
                || Some("ANSWER: PONG".into()),
                2,
            ),
            Some("agent-sup".into()),
        );
    });
    let started = Instant::now();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 18, "method": "await_result",
                "params": { "agentId": "agent-child", "waitSeconds": 30 } }),
    );
    landing.join().unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "woken, not timed out"
    );
    assert_eq!(response["result"]["done"], true, "{response}");
    assert_eq!(response["result"]["result"]["answer"], "ANSWER: PONG");
    assert_eq!(response["result"]["result"]["source"], "console_tail");
}

#[test]
fn await_result_ends_its_wait_with_the_live_status() {
    let s = supervised_scope();
    s.h.buffers.append("agent-child", "working");
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 18, "method": "await_result",
                "params": { "agentId": "agent-child", "waitSeconds": 0 } }),
    );
    assert_eq!(
        response["result"],
        json!({ "done": false, "agentId": "agent-child", "status": "running", "outputBytes": 7,
                "waitingForInput": false, "idleForMs": null, "stalledSinceMs": null })
    );
    let unknown = call(
        &s.h,
        json!({ "id": 18, "method": "await_result", "params": { "agentId": "ghost" } }),
    );
    assert_eq!(error_code(&unknown), "unknown_agent");
}

#[test]
fn a_killed_supervisors_children_stay_readable_until_its_card_is_cleared() {
    let s = supervised_scope();
    s.h.run_results.record(
        RunResult::from_finish(
            "agent-done",
            AgentStatus::Error,
            Some(1),
            None,
            || Some("boom".into()),
            3,
        ),
        Some("agent-sup".into()),
    );
    let read_as = |caller: &Caller| {
        call_as(
            &s.h,
            caller,
            json!({ "id": 18, "method": "await_result",
                    "params": { "agentId": "agent-done", "waitSeconds": 0 } }),
        )
    };
    assert_eq!(read_as(&s.supervisor)["result"]["result"]["isError"], true);
    // The supervisor is killed: gone from the manager.
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-sup");
    assert_eq!(read_as(&Caller::External)["result"]["done"], true);
    s.h.run_results.forget_children_of("agent-sup");
    assert_eq!(error_code(&read_as(&Caller::External)), "unknown_agent");
}

#[test]
// code-gate: complexity-function-length - one scenario: a listed, an unlisted and a hidden project side by side
fn a_supervisor_lists_the_allowed_projects_with_what_it_may_use_there() {
    let s = supervised_scope();
    let unlisted = auric_project();
    let unlisted_path =
        crate::supervisor::canonical_project_path(&unlisted.path().to_string_lossy());
    let mut policy = scope_policy(&s.path);
    let mut rules = policy.projects[&s.path].clone();
    rules.providers = Some(vec!["claude".into()]);
    rules.allow_interactive = false;
    policy.projects.insert(unlisted_path.clone(), rules);
    *s.h.backend.policy.lock().unwrap() = policy;
    *s.h.backend.projects.lock().unwrap() = vec![
        ProjectEntry {
            path: s.path.clone(),
            name: "listed".into(),
            starred: true,
            is_open: false,
            initialized: true,
            last_opened_at: Some(5),
            running_agents: 3,
            description: Some("Listed project".into()),
            description_source: Some(DescriptionSource::User),
            supervisor: None,
        },
        ProjectEntry {
            path: "/abs/not-allowed".into(),
            name: "hidden".into(),
            starred: true,
            is_open: false,
            initialized: true,
            last_opened_at: None,
            running_agents: 0,
            description: None,
            description_source: None,
            supervisor: None,
        },
    ];
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": "a", "method": "list_projects" }),
    );
    let projects = response["result"]["projects"].as_array().unwrap();
    let mut expected_paths = vec![s.path.clone(), unlisted_path.clone()];
    expected_paths.sort();
    let paths: Vec<&str> = projects
        .iter()
        .map(|p| p["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, expected_paths, "allowed only, sorted by path");
    let listed = projects
        .iter()
        .find(|p| p["path"] == s.path.as_str())
        .unwrap();
    assert_eq!(listed["name"], "listed");
    assert_eq!(
        listed["supervisor"],
        json!({
            "balancing": null,
            "providers": [
                { "id": "claude", "models": "all" },
                { "id": "codex", "permissionMode": "acceptEdits", "models": "all" }
            ],
            "allowInteractive": true, "runningChildren": 1, "maxRunning": 2
        })
    );
    assert_eq!(
        response["result"]["catalog"],
        json!({
            "claude": [{ "id": "haiku", "label": "Label haiku", "rank": 1 }],
            "codex": [{ "id": "gpt-6-luna", "label": "Label gpt-6-luna", "rank": 1 },
                      { "id": "gpt-6-sol", "label": "Label gpt-6-sol", "rank": 3 },
                      { "id": "auto", "label": "Label auto", "rank": null }]
        }),
        "every allowed model, described once"
    );
    let built = projects
        .iter()
        .find(|p| p["path"] == unlisted_path.as_str())
        .unwrap();
    assert_eq!(built["starred"], false);
    assert_eq!(built["initialized"], true);
    assert_eq!(built["supervisor"]["runningChildren"], 0);
    assert_eq!(built["supervisor"]["providers"][0]["id"], "claude");
    let external = call(&s.h, json!({ "id": "a", "method": "list_projects" }));
    assert!(
        external["result"]["projects"][0]
            .get("supervisor")
            .is_none(),
        "only a supervisor's list carries the block"
    );
}

#[test]
fn a_supervisor_is_told_which_provider_is_behind_its_load_balancing_share() {
    let s = supervised_scope();
    let mut policy = scope_policy(&s.path);
    let rules = policy.projects.get_mut(&s.path).unwrap();
    rules.provider_weights = BTreeMap::from([("claude".into(), 1), ("codex".into(), 1)]);
    *s.h.backend.policy.lock().unwrap() = policy;
    // One finished Codex run in the window; three Claude agents still running
    // here (whoever started them), not booked yet.
    *s.h.backend.recent_runs.lock().unwrap() = BTreeMap::from([("codex".into(), 1)]);

    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": "a", "method": "list_projects" }),
    );

    let project = &response["result"]["projects"][0];
    assert_eq!(
        project["supervisor"]["balancing"],
        json!({
            "windowDays": 7,
            "next": "codex",
            "providers": [
                { "id": "claude", "weight": 1, "spawns": 3, "targetPercent": 50, "actualPercent": 75 },
                { "id": "codex", "weight": 1, "spawns": 1, "targetPercent": 50, "actualPercent": 25 }
            ]
        })
    );
}

#[test]
fn a_supervisor_lists_one_project_with_balancing_first_and_only_its_models_described() {
    let s = supervised_scope();
    let other = auric_project();
    let other_path = crate::supervisor::canonical_project_path(&other.path().to_string_lossy());
    let mut policy = scope_policy(&s.path);
    let mut rules = policy.projects[&s.path].clone();
    rules.providers = Some(vec!["codex".into()]);
    rules.models = BTreeMap::from([("codex".into(), vec!["gpt-6-luna".into()])]);
    policy.projects.insert(other_path.clone(), rules);
    *s.h.backend.policy.lock().unwrap() = policy;
    let list = |project: Option<&str>| {
        let params = project.map_or_else(|| json!({}), |p| json!({ "project": p }));
        call_as(
            &s.h,
            &s.supervisor,
            json!({ "id": "a", "method": "list_projects", "params": params }),
        )
    };
    let all = list(None);
    let other_entry = all["result"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["path"] == other_path.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        other_entry["supervisor"]["providers"],
        json!([{ "id": "codex", "permissionMode": "acceptEdits", "models": ["gpt-6-luna"] }]),
        "a subset of the catalog is named by id"
    );

    let one = list(Some(&other_path));
    let projects = one["result"]["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(
        one["result"]["catalog"],
        json!({ "codex": [{ "id": "gpt-6-luna", "label": "Label gpt-6-luna", "rank": 1 }] })
    );
    assert_eq!(projects[0]["supervisor"]["providers"][0]["models"], "all");
    let text = serde_json::to_string(&one["result"]["projects"][0]["supervisor"]).unwrap();
    assert!(
        text.find("\"balancing\"") < text.find("\"providers\""),
        "balancing is read before the providers: {text}"
    );
    assert_eq!(
        error_code(&list(Some("/abs/not-allowed"))),
        "unknown_project"
    );
}

#[test]
fn a_full_supervisor_project_list_stays_small() {
    let s = supervised_scope();
    let providers: Vec<String> = (1..=6).map(|n| format!("provider-{n}")).collect();
    let mut offered = BTreeMap::new();
    for provider in &providers {
        let models = (1..=10)
            .map(|n| ModelOption {
                value: format!("{provider}-model-{n:02}"),
                label: format!("Model {n}"),
                rank: Some((n % 4) + 1),
                use_for: Some("Reading, browsing and normal coding work.".into()),
                relative_cost: Some(f64::from(n as u32)),
                ..Default::default()
            })
            .collect();
        offered.insert(provider.clone(), models);
    }
    *s.h.backend.offered.lock().unwrap() = offered;
    let homes: Vec<tempfile::TempDir> = (0..15).map(|_| auric_project()).collect();
    let mut policy = scope_policy(&s.path);
    policy.projects.clear();
    let mut rules = scope_policy(&s.path).projects[&s.path].clone();
    rules.providers = None;
    rules.models = BTreeMap::new();
    rules.permission_mode = BTreeMap::new();
    for home in &homes {
        let path = crate::supervisor::canonical_project_path(&home.path().to_string_lossy());
        policy.projects.insert(path, rules.clone());
    }
    *s.h.backend.policy.lock().unwrap() = policy;
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": "a", "method": "list_projects" }),
    );
    assert_eq!(response["result"]["projects"].as_array().unwrap().len(), 15);
    let compact = serde_json::to_string(&response["result"]).unwrap();
    assert!(
        compact.len() < 16 * 1024,
        "15 projects x 6 providers x 10 models took {} bytes",
        compact.len()
    );
}

#[test]
fn a_supervisor_spawn_without_provider_or_model_takes_what_it_is_told_to() {
    let s = supervised_scope();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": s.path, "prompt": "reply PONG", "headless": true
        } }),
    );
    assert_eq!(response["ok"], true, "{response}");
    let requests = s.h.backend.requests.lock().unwrap();
    assert_eq!(
        requests[0].params["provider"], "claude",
        "the supervisor's own"
    );
    assert_eq!(requests[0].params["model"], "haiku", "the smallest allowed");
}

#[test]
fn a_large_model_needs_a_reason_and_the_spawn_log_keeps_it() {
    let s = supervised_scope();
    let app = tempfile::tempdir().unwrap();
    *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
    let spawn = |reason: Option<&str>| {
        let mut params = json!({
            "projectPath": s.path, "prompt": "p", "provider": "codex",
            "model": "gpt-6-sol", "headless": true
        });
        if let Some(reason) = reason {
            params["modelReason"] = json!(reason);
        }
        call_as(
            &s.h,
            &s.supervisor,
            json!({ "id": 7, "method": "spawn", "params": params }),
        )
    };
    let refused = spawn(Some("  "));
    assert_eq!(refused["error"]["reason"], "model_reason_required");
    assert!(refused["error"]["message"]
        .as_str()
        .unwrap()
        .contains("gpt-6-luna (rank 1)"));
    assert!(s.h.backend.requests.lock().unwrap().is_empty());

    let started = spawn(Some("Untangle a race across three crates"));
    assert_eq!(started["ok"], true, "{started}");
    assert!(
        s.h.backend.requests.lock().unwrap()[0]
            .params
            .get("modelReason")
            .is_none(),
        "the reason is booked in Rust, not handed to the frontend"
    );
    let log =
        std::fs::read_to_string(app.path().join(super::spawn_log::SPAWN_LOG_FILE_NAME)).unwrap();
    let lines: Vec<Value> = log
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 1, "only the spawn that went ahead");
    assert_eq!(lines[0]["agentId"], "agent-new");
    assert_eq!(lines[0]["supervisorId"], "agent-sup");
    assert_eq!(lines[0]["model"], "gpt-6-sol");
    assert_eq!(lines[0]["rank"], 3);
    assert_eq!(lines[0]["picked"], false);
    assert_eq!(
        lines[0]["modelReason"],
        "Untangle a race across three crates"
    );
}

#[test]
fn a_supervisor_is_admitted_over_a_real_socket_in_its_scope() {
    let dir = tempfile::tempdir().unwrap();
    let path = socket_path_in(dir.path());
    let listener = bind(&path).unwrap();
    let s = supervised_scope();
    // This test process descends from its parent; pretend that is a supervisor.
    *s.h.backend.agent_pids.lock().unwrap() = HashMap::from([(
        std::os::unix::process::parent_id(),
        ("agent-sup".to_string(), AgentRole::Supervisor),
    )]);
    let dispatcher = Arc::new(s.h.dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_secs(5)));

    let mut stream = UnixStream::connect(&path).unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let listed = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":1,"method":"list_agents"}"#,
    );
    let ids: Vec<&str> = listed["result"]["agents"]
        .as_array()
        .unwrap_or_else(|| panic!("{listed}"))
        .iter()
        .map(|agent| agent["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["agent-child", "agent-done"]);
    let typed = roundtrip(
        &mut stream,
        &mut reader,
        r#"{"id":2,"method":"send_input","params":{"agentId":"agent-child","text":"y"}}"#,
    );
    assert_eq!(typed["result"]["bytesWritten"], 2, "{typed}");
}

/// A finished child of `agent-sup` whose working directory is a real Auric
/// worktree of a real repository, so `remove_worktree` acts on git itself.
fn finished_child_in_worktree(s: &Scope, repo: &tempfile::TempDir) -> crate::git::GitWorktree {
    let path = crate::git::tests::committed_repo(repo);
    let worktree = crate::git::git_worktree_add_impl(&path, "child").unwrap();
    let mut child = agent_in("agent-wt", Some("agent-sup"), &s.path, AgentStatus::Idle);
    child.repo_path = Some(worktree.path.clone());
    s.h.backend.agents.lock().unwrap().push(child);
    worktree
}

fn remove_worktree_of(s: &Scope, agent_id: &str) -> Value {
    call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 25, "method": "remove_worktree", "params": { "agentId": agent_id } }),
    )
}

#[test]
fn a_supervisor_removes_its_finished_child_s_untouched_worktree() {
    let s = supervised_scope();
    let repo = tempfile::TempDir::new().unwrap();
    let worktree = finished_child_in_worktree(&s, &repo);

    let response = remove_worktree_of(&s, "agent-wt");
    assert_eq!(response["result"]["removed"], true, "{response}");
    assert_eq!(response["result"]["agentId"], "agent-wt");
    assert_eq!(response["result"]["branch"], json!(worktree.branch));
    assert!(!Path::new(&worktree.path).exists());
}

#[test]
fn a_worktree_with_work_in_it_stays_for_a_person() {
    let s = supervised_scope();
    let repo = tempfile::TempDir::new().unwrap();
    let worktree = finished_child_in_worktree(&s, &repo);
    crate::git::tests::commit_in(&worktree.path, "b.txt", "from agent", "agent work");

    let response = remove_worktree_of(&s, "agent-wt");
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["result"]["removed"], false);
    assert_eq!(response["result"]["branchAhead"], true);
    assert!(Path::new(&worktree.path).exists());

    std::fs::write(Path::new(&worktree.path).join("c.txt"), "uncommitted").unwrap();
    let response = remove_worktree_of(&s, "agent-wt");
    assert_eq!(response["result"]["removed"], false);
    assert_eq!(response["result"]["dirty"], true);
    assert!(Path::new(&worktree.path).exists());
}

#[test]
fn remove_worktree_refuses_an_agent_that_ran_in_the_project_itself() {
    let s = supervised_scope();
    let mut child = agent_in("agent-plain", Some("agent-sup"), &s.path, AgentStatus::Idle);
    child.repo_path = Some(s.path.clone());
    s.h.backend.agents.lock().unwrap().push(child);

    let response = remove_worktree_of(&s, "agent-plain");
    assert_eq!(error_code(&response), "invalid_params");
    assert!(
        Path::new(&s.path).join(".auric").is_dir(),
        "the project stays"
    );
}

#[test]
fn a_supervisor_spawn_in_a_worktree_reaches_the_frontend_as_asked() {
    let s = supervised_scope();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 7, "method": "spawn", "params": {
            "projectPath": s.path, "prompt": "fix it",
            "provider": "claude", "model": "haiku", "headless": true, "worktree": true
        } }),
    );
    assert_eq!(response["ok"], true, "{response}");
    let requests = s.h.backend.requests.lock().unwrap();
    assert_eq!(requests[0].params["worktree"], true);
}

#[test]
fn a_supervisor_types_into_its_own_child_and_nowhere_else() {
    let s = supervised_scope();
    let typed = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 5, "method": "send_input",
                "params": { "agentId": "agent-child", "text": "1" } }),
    );
    assert_eq!(typed["result"]["bytesWritten"], 2, "{typed}");
    for foreign in ["agent-human", "agent-other", "agent-sup", "agent-ghost"] {
        let refused = call_as(
            &s.h,
            &s.supervisor,
            json!({ "id": 5, "method": "send_input",
                    "params": { "agentId": foreign, "text": "1" } }),
        );
        assert_eq!(error_code(&refused), "unknown_agent", "{foreign}");
    }
    assert_eq!(
        *s.h.backend.written.lock().unwrap(),
        vec![("agent-child".to_string(), "1\r".to_string())]
    );
}

fn await_until_input(s: &Scope, extra: Value) -> Value {
    let mut params = json!({ "agentId": "agent-child", "waitSeconds": 5, "untilInput": true });
    for (key, value) in extra.as_object().unwrap() {
        params[key] = value.clone();
    }
    call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 21, "method": "await_result", "params": params }),
    )
}

#[test]
fn await_until_input_wakes_on_a_prompt_in_the_console() {
    let s = supervised_scope();
    s.h.buffers.append(
        "agent-child",
        "git ls-files\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n",
    );
    let started = Instant::now();
    let response = await_until_input(&s, json!({}));
    assert!(started.elapsed() < Duration::from_secs(2), "woken at once");
    assert_eq!(response["result"]["done"], false, "{response}");
    assert_eq!(response["result"]["waitingForInput"], true, "{response}");
}

#[test]
fn await_until_input_does_not_wake_again_for_a_question_already_seen() {
    let s = supervised_scope();
    s.h.buffers.append("agent-child", "Continue? (y/n)\n");
    let seen = s.h.buffers.total_bytes("agent-child");
    let response = await_until_input(&s, json!({ "waitSeconds": 1, "sinceOffset": seen }));
    assert_eq!(response["result"]["waitingForInput"], false, "{response}");
}

#[test]
fn await_until_input_wakes_when_the_console_goes_quiet() {
    let mut s = supervised_scope();
    s.h.dispatcher.set_input_quiet(Duration::from_millis(600));
    s.h.buffers.append(
        "agent-child",
        "Soll ich den Scope erweitern oder nur den Bug fixen?\n",
    );
    let started = Instant::now();
    let response = await_until_input(&s, json!({}));
    let waited = started.elapsed();
    assert!(waited >= Duration::from_millis(600), "{waited:?}");
    assert!(waited < Duration::from_secs(4), "{waited:?}");
    assert_eq!(response["result"]["waitingForInput"], true, "{response}");
}

#[test]
fn await_until_input_ignores_a_headless_child_and_still_returns_its_result() {
    let s = supervised_scope();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .iter_mut()
        .find(|agent| agent.id == "agent-child")
        .unwrap()
        .headless = true;
    s.h.buffers.append("agent-child", "Continue? (y/n)\n");
    let response = await_until_input(&s, json!({ "waitSeconds": 0 }));
    assert_eq!(response["result"]["waitingForInput"], false, "{response}");
    s.h.run_results.record(
        RunResult::from_finish(
            "agent-child",
            AgentStatus::Idle,
            Some(0),
            None,
            || Some("ANSWER: ok".into()),
            1,
        ),
        Some("agent-sup".into()),
    );
    assert_eq!(await_until_input(&s, json!({}))["result"]["done"], true);
}

mod link_policy {
    use super::*;
    use crate::supervisor_link::policy::{policy_path_in, read_stored};
    use crate::supervisor_link::proposals::{ProposalStore, NOTIFICATION_ORIGIN};

    fn propose(s: &Scope, caller: &Caller, project: &str) -> Value {
        call_as(
            &s.h,
            caller,
            json!({ "id": 1, "method": "link_policy_propose", "params": {
                "reason": "The docs project should see the global defaults",
                "changes": [{ "op": "share_project", "project": project }],
            }}),
        )
    }

    #[test]
    fn a_supervisor_proposes_and_nothing_changes_until_the_ide_decides() {
        let s = supervised_scope();
        let app = tempfile::tempdir().unwrap();
        *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
        let supervisor =
            s.h.dispatcher
                .admit_peer(Some(999), below(Some(SUPERVISOR_PID)))
                .unwrap();
        let project = tempfile::tempdir().unwrap();
        let response = propose(&s, &supervisor, project.path().to_str().unwrap());
        assert_eq!(response["ok"], true, "{response}");
        let id = response["result"]["proposalId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(response["result"]["status"], "pending");

        assert!(!policy_path_in(app.path()).exists(), "no policy written");
        let notified = s.h.backend.notified.lock().unwrap().clone();
        assert_eq!(notified.len(), 1);
        assert_eq!(notified[0].origin.as_deref(), Some(NOTIFICATION_ORIGIN));
        assert_eq!(notified[0].source, "system");

        // What the supervisor reads back: still nothing shared, one pending.
        let read = call_as(
            &s.h,
            &supervisor,
            json!({ "id": 2, "method": "link_policy_get" }),
        );
        assert_eq!(read["result"]["stored"]["projects"], json!({}));
        assert_eq!(read["result"]["pending"][0]["id"], id.as_str());

        // Only the IDE's decision applies it.
        ProposalStore::new(app.path())
            .decide(&id, true, crate::supervisor_link::jobs::now_ms())
            .unwrap();
        assert_eq!(read_stored(app.path()).projects.len(), 1);
    }

    #[test]
    fn an_external_caller_can_neither_read_nor_propose() {
        let s = supervised_scope();
        let app = tempfile::tempdir().unwrap();
        *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
        let external = s.h.dispatcher.admit_peer(Some(999), below(None)).unwrap();
        let project = tempfile::tempdir().unwrap();
        let response = propose(&s, &external, project.path().to_str().unwrap());
        assert_eq!(error_code(&response), "outside_supervisor_scope");
        assert!(s.h.backend.notified.lock().unwrap().is_empty());
        assert!(ProposalStore::new(app.path()).pending(0).is_empty());
    }

    #[test]
    fn an_invalid_change_is_refused_and_nothing_is_raised() {
        let s = supervised_scope();
        let app = tempfile::tempdir().unwrap();
        *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
        let supervisor =
            s.h.dispatcher
                .admit_peer(Some(999), below(Some(SUPERVISOR_PID)))
                .unwrap();
        let response = propose(&s, &supervisor, "/nonexistent/example-project");
        assert_eq!(error_code(&response), "invalid_params");
        assert!(s.h.backend.notified.lock().unwrap().is_empty());
    }

    #[test]
    fn without_an_app_directory_the_answer_is_internal() {
        let s = supervised_scope();
        let supervisor =
            s.h.dispatcher
                .admit_peer(Some(999), below(Some(SUPERVISOR_PID)))
                .unwrap();
        let read = call_as(
            &s.h,
            &supervisor,
            json!({ "id": 2, "method": "link_policy_get" }),
        );
        assert_eq!(error_code(&read), "internal");
    }
}

#[test]
fn a_supervisor_lists_its_finished_child_with_the_status_it_ended_in() {
    let s = supervised_scope();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 1, "method": "list_agents", "params": {} }),
    );
    let agents = response["result"]["agents"].as_array().unwrap();
    let done = agents.iter().find(|a| a["id"] == "agent-done").unwrap();
    assert_eq!(done["status"], "error", "{response}");
    assert_eq!(done["spawnedByAgentId"], "agent-sup");
    assert_eq!(done["finishedAt"], 2);
    assert!(done["answerPreview"].is_null());
}

#[test]
fn dismiss_clears_the_card_through_the_frontend_and_forgets_the_result() {
    let s = supervised_scope();
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 27, "method": "dismiss", "params": { "agentId": "agent-done" } }),
    );
    assert_eq!(
        response["result"],
        json!({ "agentId": "agent-done", "dismissed": true }),
        "{response}"
    );
    let requests = s.h.backend.requests.lock().unwrap();
    assert_eq!(requests[0].method, "dismiss");
    assert_eq!(requests[0].params, json!({ "agentId": "agent-done" }));
    drop(requests);
    assert!(s.h.run_results.get("agent-done").is_none());
    let again = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 28, "method": "dismiss", "params": { "agentId": "agent-done" } }),
    );
    assert_eq!(error_code(&again), "unknown_agent", "gone from its scope");
}

#[test]
fn a_dismiss_the_frontend_refuses_keeps_the_result() {
    let s = supervised_scope();
    *s.h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: false,
        result: None,
        error: Some(FrontendError {
            code: "internal".into(),
            message: "store refused".into(),
        }),
    });
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 27, "method": "dismiss", "params": { "agentId": "agent-done" } }),
    );
    assert_eq!(response["ok"], false, "{response}");
    assert!(s.h.run_results.get("agent-done").is_some(), "retryable");
}

fn finished_child(id: &str, supervisor: &str, status: AgentStatus) -> FinishedChild {
    FinishedChild {
        supervisor_id: supervisor.into(),
        agent: AgentInfo {
            id: id.into(),
            name: format!("Task {id}"),
            spawned_by_agent_id: Some(supervisor.into()),
            ..sample_agent()
        },
        result: RunResult::from_finish(id, status, Some(0), None, || None, 1),
    }
}

#[test]
fn pingback_types_the_notice_only_into_a_listening_supervisor() {
    let s = supervised_scope();
    let mut headless_sup = agent("agent-sup-h", true);
    headless_sup.role = AgentRole::Supervisor;
    s.h.backend.agents.lock().unwrap().push(headless_sup);
    let d = &s.h.dispatcher;
    let wave = [
        finished_child("agent-a", "agent-sup", AgentStatus::Idle),
        finished_child("agent-b", "agent-sup", AgentStatus::Error),
    ];
    assert!(d.ping_supervisor("agent-sup", &wave));
    for silent in ["agent-sup-h", "agent-gone", "agent-child"] {
        assert!(!d.ping_supervisor(silent, &wave), "{silent}");
    }
    let written = s.h.backend.written.lock().unwrap();
    assert_eq!(written.len(), 1);
    let (to, data) = &written[0];
    assert_eq!(to, "agent-sup");
    assert!(
        data.contains("agent-a \"Task agent-a\" (idle), agent-b \"Task agent-b\" (error)"),
        "{data}"
    );
    assert!(data.contains("from the IDE, not from the human"), "{data}");
    assert!(data.ends_with('\r'), "submitted: {data:?}");
}

#[test]
fn pingback_waits_for_a_quiet_wave_or_the_max_delay() {
    let quiet = Duration::from_secs(3);
    let mut waves = super::pingback::Waves::new(quiet, Duration::from_secs(15));
    let t = Instant::now();
    waves.add(finished_child("a", "sup", AgentStatus::Idle), t);
    waves.add(
        finished_child("b", "sup", AgentStatus::Idle),
        t + Duration::from_secs(2),
    );
    waves.add(finished_child("x", "sup-2", AgentStatus::Idle), t);
    let due = waves.take_due(t + Duration::from_secs(4), |_| false);
    assert_eq!(due.len(), 1, "sup-2 is quiet, sup is not yet");
    assert_eq!(due[0].0, "sup-2");

    for second in (4..15).step_by(2) {
        let at = t + Duration::from_secs(second);
        waves.add(
            finished_child(&format!("c{second}"), "sup", AgentStatus::Idle),
            at,
        );
        assert!(
            waves.take_due(at, |_| false).is_empty(),
            "never quiet at {second}s"
        );
    }
    let due = waves.take_due(t + Duration::from_secs(15), |_| false);
    assert_eq!(due[0].1.len(), 8, "overdue: one notice for the whole wave");
    assert!(waves.is_empty());
}

#[test]
fn pingback_holds_while_the_human_drafts_and_sends_once_they_stop() {
    let s = supervised_scope();
    let mut waves = super::pingback::Waves::new(Duration::ZERO, Duration::ZERO);
    let t = Instant::now();
    waves.add(finished_child("a", "agent-sup", AgentStatus::Idle), t);
    s.h.backend
        .drafting
        .lock()
        .unwrap()
        .push("agent-sup".into());
    let d = &s.h.dispatcher;
    assert!(waves.take_due(t, |id| d.human_drafting(id)).is_empty());
    waves.add(finished_child("b", "agent-sup", AgentStatus::Idle), t);
    s.h.backend.drafting.lock().unwrap().clear();
    let due = waves.take_due(t, |id| d.human_drafting(id));
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].1.len(), 2, "what waited goes out together");
}

#[test]
fn pingback_limits_match_the_contract() {
    let fixtures: Value = serde_json::from_str(super::protocol::tests::FIXTURES).unwrap();
    let limits = &fixtures["limits"];
    assert_eq!(
        limits["pingbackQuietMs"],
        super::pingback::PINGBACK_QUIET.as_millis() as u64
    );
    assert_eq!(
        limits["pingbackMaxDelayMs"],
        super::pingback::PINGBACK_MAX_DELAY.as_millis() as u64
    );
}

#[test]
fn supervisor_listing_keeps_a_finished_answer_preview_after_the_live_agent_is_gone() {
    let s = supervised_scope();
    let text = format!("progress\nANSWER: {}\ntrailing noise", "ü".repeat(400));
    s.h.run_results.record_finished(
        RunResult::from_finish(
            "agent-success",
            AgentStatus::Idle,
            Some(0),
            None,
            || Some(text),
            42,
        ),
        agent_in(
            "agent-success",
            Some("agent-sup"),
            &s.path,
            AgentStatus::Running,
        ),
    );
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 1, "method": "list_agents" }),
    );
    let agents = response["result"]["agents"].as_array().unwrap();
    let done = agents.iter().find(|a| a["id"] == "agent-success").unwrap();
    assert_eq!(done["status"], "done");
    assert_eq!(done["finishedAt"], 42);
    assert_eq!(
        done["answerPreview"],
        format!("ANSWER: {}", "ü".repeat(292))
    );
    assert!(!agents.iter().any(|a| a["id"] == "agent-orphan"));
    let live = agents.iter().find(|a| a["id"] == "agent-child").unwrap();
    assert_eq!(live["status"], "running");
    assert!(live.get("finishedAt").is_none());
}

#[test]
fn zero_wait_input_checks_remember_silence_between_calls() {
    let mut s = supervised_scope();
    s.h.dispatcher.set_input_quiet(Duration::from_millis(100));
    s.h.buffers
        .append("agent-child", "A plain prose turn has ended.\n");
    let check = || await_until_input(&s, json!({ "waitSeconds": 0 }));
    assert_eq!(check()["result"]["waitingForInput"], false);
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(check()["result"]["waitingForInput"], true);
    let seen = s.h.buffers.total_bytes("agent-child");
    let response = await_until_input(&s, json!({ "waitSeconds": 0, "sinceOffset": seen }));
    assert_eq!(response["result"]["waitingForInput"], false);
    s.h.buffers
        .append("agent-child", "The next turn is working.\n");
    assert_eq!(check()["result"]["waitingForInput"], false);
}

#[test]
fn watchdog_nudges_once_escalates_and_exposes_metrics() {
    let s = watchdog_scope();
    let t = Instant::now();
    let timeout = Duration::from_secs(900);
    s.h.dispatcher
        .watchdog_tick_at(t, 1000, timeout, &HashSet::new());
    s.h.dispatcher.watchdog_tick_at(
        t + timeout - Duration::from_millis(1),
        900999,
        timeout,
        &HashSet::new(),
    );
    assert!(s.h.backend.written.lock().unwrap().is_empty());
    s.h.dispatcher
        .watchdog_tick_at(t + timeout, 901000, timeout, &HashSet::new());
    let written = s.h.backend.written.lock().unwrap().clone();
    assert_eq!(
        written.iter().filter(|(id, _)| id == "agent-child").count(),
        1
    );
    assert!(written
        .iter()
        .any(|(id, text)| id == "agent-sup" && text.contains("Stalled")));
    assert!(!written
        .iter()
        .any(|(id, _)| id == "agent-other" || id == "agent-human"));
    let listed = call_as(&s.h, &s.supervisor, json!({"id":1,"method":"list_agents"}));
    let child = listed["result"]["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "agent-child")
        .unwrap();
    assert!(child["idleForMs"].is_number());
    assert_eq!(child["stalledSinceMs"], 901000);
    let pending = call_as(
        &s.h,
        &s.supervisor,
        json!({"id":2,"method":"await_result",
        "params":{"agentId":"agent-child"}}),
    );
    assert_eq!(pending["result"]["stalledSinceMs"], 901000);
    for n in [2, 3, 4] {
        s.h.dispatcher.watchdog_tick_at(
            t + timeout * n,
            1000 + 900000 * u64::from(n),
            timeout,
            &HashSet::new(),
        );
    }
    assert_eq!(
        s.h.backend
            .written
            .lock()
            .unwrap()
            .iter()
            .filter(|(id, _)| id == "agent-child")
            .count(),
        1
    );
    assert_eq!(s.h.backend.notified.lock().unwrap().len(), 1);
}

#[test]
fn watchdog_headless_never_gets_input_and_recovers_on_progress() {
    let s = watchdog_scope();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .iter_mut()
        .find(|a| a.id == "agent-child")
        .unwrap()
        .headless = true;
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    s.h.dispatcher
        .watchdog_tick_at(t + n, 900000, n, &HashSet::new());
    assert!(!s
        .h
        .backend
        .written
        .lock()
        .unwrap()
        .iter()
        .any(|(id, _)| id == "agent-child"));
    assert!(s
        .h
        .backend
        .written
        .lock()
        .unwrap()
        .iter()
        .any(|(id, text)| id == "agent-sup" && text.contains("headless")));
    s.h.buffers
        .append("agent-child", "Tests finished successfully\n");
    s.h.dispatcher
        .watchdog_tick_at(t + n + Duration::from_secs(1), 901000, n, &HashSet::new());
    assert!(s
        .h
        .dispatcher
        .stall_metrics("agent-child")
        .stalled_since_ms
        .is_none());
    assert!(s.h.backend.notified.lock().unwrap().is_empty());
}

#[test]
fn watchdog_excludes_questions_commands_stopped_and_drafts() {
    let s = watchdog_scope();
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.buffers.append("agent-child", "Continue? (y/n)\n");
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    s.h.dispatcher
        .watchdog_tick_at(t + n * 2, 1800000, n, &HashSet::new());
    assert!(s.h.backend.written.lock().unwrap().is_empty());
    // A running silent command keeps resetting the inactivity clock.
    s.h.buffers.append(
        "agent-child",
        "\nWorking\nWorking\nWorking\nWorking\nWorking\nWorking\nWorking\nWorking\nWorking\n",
    );
    let busy = HashSet::from(["agent-child".to_string()]);
    s.h.dispatcher
        .watchdog_tick_at(t + n * 3, 2700000, n, &busy);
    s.h.dispatcher
        .watchdog_tick_at(t + n * 4, 3600000, n, &busy);
    assert!(s.h.backend.written.lock().unwrap().is_empty());
    s.h.backend
        .drafting
        .lock()
        .unwrap()
        .push("agent-child".into());
    s.h.dispatcher
        .watchdog_tick_at(t + n * 5, 4500000, n, &HashSet::new());
    assert!(s.h.backend.written.lock().unwrap().is_empty());
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .iter_mut()
        .find(|a| a.id == "agent-child")
        .unwrap()
        .status = AgentStatus::Idle;
    s.h.dispatcher
        .watchdog_tick_at(t + n * 7, 6300000, n, &HashSet::new());
    assert!(s.h.backend.written.lock().unwrap().is_empty());
}

#[test]
fn watchdog_noise_does_not_postpone_the_nudge_or_escalation() {
    let s = watchdog_scope();
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.buffers.append("agent-child", "Reading files\nPlan\n");
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    for frame in 1..=2 {
        s.h.buffers.append(
            "agent-child",
            "\x1b[2J\x1b[HReading files\nPlan\n⠋ Working (120s)\r⠙ Working (121s)\r",
        );
        s.h.dispatcher.watchdog_tick_at(
            t + n * frame,
            900000 * u64::from(frame),
            n,
            &HashSet::new(),
        );
    }
    assert_eq!(s.h.backend.input_events.lock().unwrap().len(), 1);
    assert_eq!(s.h.backend.notified.lock().unwrap().len(), 1);
    s.h.buffers.append("agent-child", "A new result\n");
    s.h.dispatcher
        .watchdog_tick_at(t + n * 3, 2700000, n, &HashSet::new());
    s.h.dispatcher
        .watchdog_tick_at(t + n * 4, 3600000, n, &HashSet::new());
    assert_eq!(
        s.h.backend.input_events.lock().unwrap().len(),
        1,
        "recovery never renews the nudge budget"
    );
    for frame in 5..=7 {
        s.h.dispatcher.watchdog_tick_at(
            t + n * frame,
            900000 * u64::from(frame),
            n,
            &HashSet::new(),
        );
    }
    assert_eq!(
        s.h.backend.notified.lock().unwrap().len(),
        2,
        "each silence episode escalates once, including after recovery"
    );
    assert_eq!(s.h.backend.input_events.lock().unwrap().len(), 1);
}

#[test]
fn watchdog_defers_supervisor_drafts_and_retries_only_pingbacks() {
    let s = watchdog_scope();
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.backend
        .drafting
        .lock()
        .unwrap()
        .push("agent-sup".into());
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    s.h.dispatcher
        .watchdog_tick_at(t + n, 900000, n, &HashSet::new());
    assert_eq!(
        s.h.backend.written.lock().unwrap().len(),
        1,
        "only the child's nudge"
    );
    s.h.backend.drafting.lock().unwrap().clear();
    s.h.dispatcher
        .watchdog_tick_at(t + n + Duration::from_secs(5), 905000, n, &HashSet::new());
    assert_eq!(s.h.backend.written.lock().unwrap().len(), 2);
    s.h.dispatcher
        .watchdog_tick_at(t + n + Duration::from_secs(10), 910000, n, &HashSet::new());
    assert_eq!(s.h.backend.written.lock().unwrap().len(), 2);
}

#[test]
fn watchdog_failed_nudge_is_not_retried_and_pingback_failure_reaches_the_inbox() {
    let s = watchdog_scope();
    let t = Instant::now();
    let n = Duration::from_secs(900);
    *s.h.backend.fail_input.lock().unwrap() =
        HashSet::from(["agent-child".into(), "agent-sup".into()]);
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    for seconds in [900, 905, 910, 915] {
        s.h.dispatcher.watchdog_tick_at(
            t + Duration::from_secs(seconds),
            seconds * 1000,
            n,
            &HashSet::new(),
        );
    }
    let written = s.h.backend.written.lock().unwrap();
    assert_eq!(
        written.iter().filter(|(id, _)| id == "agent-child").count(),
        1
    );
    assert_eq!(
        written.iter().filter(|(id, _)| id == "agent-sup").count(),
        3
    );
    assert_eq!(s.h.backend.notified.lock().unwrap().len(), 1);
}

fn watchdog_scope() -> Scope {
    let s = supervised_scope();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|a| a.id != "agent-other");
    s
}

#[test]
fn watchdog_routes_each_stall_to_its_owner_and_orphans_reach_the_human() {
    let s = watchdog_scope();
    let second = AgentInfo {
        id: "agent-sup-2".into(),
        role: AgentRole::Supervisor,
        ..sample_agent()
    };
    s.h.backend.agents.lock().unwrap().extend([
        second,
        agent_in(
            "agent-second",
            Some("agent-sup-2"),
            &s.path,
            AgentStatus::Running,
        ),
        agent_in(
            "agent-orphan-live",
            Some("agent-dead"),
            &s.path,
            AgentStatus::Running,
        ),
    ]);
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    for seconds in [900, 905, 910] {
        s.h.dispatcher.watchdog_tick_at(
            t + Duration::from_secs(seconds),
            seconds * 1000,
            n,
            &HashSet::new(),
        );
    }
    let written = s.h.backend.written.lock().unwrap();
    assert!(written
        .iter()
        .any(|(id, text)| id == "agent-sup-2" && text.contains("agent-second")));
    assert!(!written
        .iter()
        .any(|(id, text)| id == "agent-sup" && text.contains("agent-second")));
    assert!(s
        .h
        .backend
        .notified
        .lock()
        .unwrap()
        .iter()
        .any(|n| n.ref_id.as_deref() == Some("agent-orphan-live")));
}

#[test]
fn watchdog_escalation_delivery_failure_does_not_notify_the_human_twice() {
    let s = watchdog_scope();
    let t = Instant::now();
    let n = Duration::from_secs(900);
    s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
    s.h.dispatcher
        .watchdog_tick_at(t + n, 900000, n, &HashSet::new());
    s.h.backend
        .fail_input
        .lock()
        .unwrap()
        .insert("agent-sup".into());
    for seconds in [1800, 1805, 1810, 2700] {
        s.h.dispatcher.watchdog_tick_at(
            t + Duration::from_secs(seconds),
            seconds * 1000,
            n,
            &HashSet::new(),
        );
    }
    assert_eq!(s.h.backend.notified.lock().unwrap().len(), 1);
}

#[test]
fn watchdog_exit_and_removal_cancel_deferred_notices() {
    for remove in [false, true] {
        let s = watchdog_scope();
        let t = Instant::now();
        let n = Duration::from_secs(900);
        s.h.backend
            .drafting
            .lock()
            .unwrap()
            .push("agent-sup".into());
        s.h.dispatcher.watchdog_tick_at(t, 0, n, &HashSet::new());
        s.h.dispatcher
            .watchdog_tick_at(t + n, 900000, n, &HashSet::new());
        if remove {
            s.h.backend
                .agents
                .lock()
                .unwrap()
                .retain(|a| a.id != "agent-child");
        } else {
            s.h.backend
                .agents
                .lock()
                .unwrap()
                .iter_mut()
                .find(|a| a.id == "agent-child")
                .unwrap()
                .status = AgentStatus::Error;
        }
        s.h.backend.drafting.lock().unwrap().clear();
        s.h.dispatcher
            .watchdog_tick_at(t + n * 3, 2700000, n, &HashSet::new());
        assert!(s.h.backend.notified.lock().unwrap().is_empty());
        assert!(s
            .h
            .dispatcher
            .stall_metrics("agent-child")
            .idle_for_ms
            .is_none());
        assert!(!s
            .h
            .backend
            .written
            .lock()
            .unwrap()
            .iter()
            .any(|(id, _)| id == "agent-sup"));
    }
}

// ── Several supervisors: keys ───────────────────────────────────────────────

fn keyed_supervisor(id: &str, key: &str) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        role: AgentRole::Supervisor,
        supervisor_key: Some(key.into()),
        project_path: None,
        ..sample_agent()
    }
}

#[test]
fn send_input_by_key_reaches_the_live_supervisor_that_carries_it() {
    let h = harness(vec![
        keyed_supervisor("agent-3", "mail-triage"),
        keyed_supervisor("agent-4", "docs"),
    ]);
    let response = call(
        &h,
        json!({ "id": 43, "method": "send_input", "params": {
            "supervisor": "docs", "text": "status?"
        } }),
    );
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["result"]["agentId"], "agent-4");
    assert_eq!(h.backend.written.lock().unwrap()[0].0, "agent-4");

    let unknown = call(
        &h,
        json!({ "id": 43, "method": "send_input", "params": {
            "supervisor": "nobody", "text": "x"
        } }),
    );
    assert_eq!(error_code(&unknown), "unknown_supervisor");

    let mut finished = keyed_supervisor("agent-5", "night-shift");
    finished.status = AgentStatus::Idle;
    h.backend.agents.lock().unwrap().push(finished);
    let gone = call(
        &h,
        json!({ "id": 43, "method": "send_input", "params": {
            "supervisor": "night-shift", "text": "x"
        } }),
    );
    assert_eq!(
        error_code(&gone),
        "unknown_supervisor",
        "a finished one has no key"
    );
}

#[test]
fn a_supervisor_caller_addressing_another_supervisor_by_key_sees_nothing() {
    let s = supervised_scope();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .push(keyed_supervisor("agent-other", "docs"));
    let response = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 5, "method": "send_input", "params": {
            "supervisor": "docs", "text": "x"
        } }),
    );
    assert_eq!(error_code(&response), "unknown_agent");
}

#[test]
fn a_supervisor_spawn_under_a_live_key_is_refused_before_the_frontend() {
    let s = supervised_scope();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .push(keyed_supervisor("agent-3", "mail-triage"));
    let spawn = |key: &str| {
        call(
            &s.h,
            json!({ "id": 40, "method": "spawn", "params": {
                "projectPath": s.path, "prompt": "supervise", "role": "supervisor",
                "supervisorKey": key
            } }),
        )
    };
    let taken = spawn("mail-triage");
    assert_eq!(error_code(&taken), "supervisor_key_in_use");
    assert!(s.h.backend.requests.lock().unwrap().is_empty());

    let free = spawn("docs");
    assert_eq!(free["ok"], true, "{free}");
    let params = &s.h.backend.requests.lock().unwrap()[0].params;
    assert_eq!(
        params["supervisorKey"], "docs",
        "the key reaches the frontend"
    );
}

#[test]
fn list_agents_names_each_supervisors_key() {
    let h = harness(vec![
        keyed_supervisor("agent-3", "mail-triage"),
        agent("agent-1", false),
    ]);
    let response = call(&h, json!({ "id": 1, "method": "list_agents" }));
    let agents = response["result"]["agents"].as_array().unwrap();
    assert_eq!(agents[0]["supervisorKey"], "mail-triage");
    assert_eq!(agents[1]["supervisorKey"], Value::Null);
}
