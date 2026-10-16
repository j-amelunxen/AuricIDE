//! Adversarial tests for the supervisor boundary (ADR 0003 / ADR 0004).
//!
//! Two kinds live here, and the name says which:
//!
//! - `attack_*` tests that FAIL today are findings. Each one carries a
//!   `FINDING SV-n` tag in its doc comment; the report (wp5-qa-report.md) has
//!   the scenario. They stay red until the code is fixed.
//! - `guard_*` tests PASS today and pin a defence that held under attack, so a
//!   later refactor cannot loosen it unnoticed.
//!
//! The backend is a private fake (the one in `tests.rs` is not shared).

use super::caller::{descends_from_agent, parent_pid, MAX_ANCESTORS};
use super::protocol::tests::sample_agent;
use super::*;
use crate::supervisor::policy::{
    check_spawn, parse, RunningChildren, SpawnRequest, SupervisorPolicy,
};
use crate::supervisor::{canonical_project_path, with_canonical_keys};
use serde_json::json;

// ── A minimal fake backend ──────────────────────────────────────────────────

#[derive(Default)]
struct Backend {
    agents: Mutex<Vec<AgentInfo>>,
    agent_pids: Mutex<HashMap<u32, (String, AgentRole)>>,
    policy: Mutex<SupervisorPolicy>,
    offered: Mutex<BTreeMap<String, Vec<ModelOption>>>,
    modes: Mutex<BTreeMap<String, crate::supervisor::policy::ProviderModes>>,
    projects: Mutex<Vec<ProjectEntry>>,
    requests: Mutex<Vec<ControlRequestEvent>>,
    pending: Arc<PendingRequests>,
    /// `None`: the frontend never answers. `Some(delay)`: it registers the
    /// spawned agent, as the real one does, and answers after `delay`.
    spawn_delay: Mutex<Option<Duration>>,
    next_agent: AtomicU64,
}

impl ControlBackend for Backend {
    fn agents(&self) -> Vec<AgentInfo> {
        self.agents.lock().unwrap().clone()
    }
    fn agent_pids(&self) -> HashMap<u32, (String, AgentRole)> {
        self.agent_pids.lock().unwrap().clone()
    }
    fn write_input(&self, _agent_id: &str, _data: &str) -> Result<(), String> {
        Ok(())
    }
    fn emit_input_sent(&self, _event: &AgentInputSentEvent) {}
    fn emit_control_request(&self, event: &ControlRequestEvent) -> Result<(), String> {
        self.requests.lock().unwrap().push(event.clone());
        let Some(delay) = *self.spawn_delay.lock().unwrap() else {
            return Ok(());
        };
        let n = self.next_agent.fetch_add(1, Ordering::SeqCst) + 1;
        let id = format!("agent-new-{n}");
        let agent = AgentInfo {
            id: id.clone(),
            status: AgentStatus::Running,
            project_path: event.params["projectPath"].as_str().map(str::to_string),
            spawned_by_agent_id: event.params["spawnedByAgentId"]
                .as_str()
                .map(str::to_string),
            ..sample_agent()
        };
        let pending = self.pending.clone();
        let req_id = event.req_id.clone();
        let agents = &self.agents as *const Mutex<Vec<AgentInfo>> as usize;
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            // SAFETY: the backend outlives every test thread (the test joins
            // before it ends); the pointer is only used to push one agent.
            let agents = unsafe { &*(agents as *const Mutex<Vec<AgentInfo>>) };
            agents.lock().unwrap().push(agent);
            pending.resolve(
                &req_id,
                FrontendReply {
                    ok: true,
                    result: Some(json!({ "agentId": id })),
                    error: None,
                },
            );
        });
        Ok(())
    }
    fn projects(&self) -> Vec<ProjectEntry> {
        self.projects.lock().unwrap().clone()
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
    fn project_provider_policy(&self, _project_root: &Path) -> ProviderPolicy {
        ProviderPolicy::default()
    }
}

struct Rig {
    backend: Arc<Backend>,
    buffers: Arc<OutputBuffers>,
    results: Arc<RunResults>,
    dispatcher: Dispatcher,
    _project: tempfile::TempDir,
    path: String,
    supervisor: Caller,
}

fn model(value: &str) -> ModelOption {
    ModelOption {
        value: value.into(),
        label: value.into(),
        rank: None,
    }
}

fn child_of(id: &str, parent: &str, project: &str) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        project_path: Some(project.into()),
        spawned_by_agent_id: Some(parent.into()),
        ..sample_agent()
    }
}

fn rig(max_running: u32, timeout: Duration) -> Rig {
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join(".auric")).unwrap();
    std::fs::write(project.path().join(".auric/project.db"), b"").unwrap();
    let path = canonical_project_path(&project.path().to_string_lossy());
    let pending = Arc::new(PendingRequests::default());
    pending.mark_ready();
    let supervisor = AgentInfo {
        id: "agent-sup".into(),
        role: AgentRole::Supervisor,
        project_path: None,
        ..sample_agent()
    };
    let backend = Arc::new(Backend {
        agents: Mutex::new(vec![
            supervisor,
            child_of("agent-child", "agent-sup", &path),
            child_of("agent-of-other", "agent-sup-2", &path),
            AgentInfo {
                id: "agent-human".into(),
                project_path: Some(path.clone()),
                ..sample_agent()
            },
        ]),
        pending: pending.clone(),
        ..Backend::default()
    });
    *backend.policy.lock().unwrap() = serde_json::from_value(json!({
        "version": 1,
        "supervisor": { "provider": "claude", "model": null },
        "maxRunningChildren": 8,
        "projects": { path.clone(): {
            "allowed": true, "providers": ["claude"],
            "models": { "claude": ["haiku"] }, "permissionMode": {},
            "allowInteractive": false, "maxRunning": max_running
        } }
    }))
    .unwrap();
    *backend.offered.lock().unwrap() =
        BTreeMap::from([("claude".to_string(), vec![model("haiku"), model("opus")])]);
    backend
        .agent_pids
        .lock()
        .unwrap()
        .insert(100, ("agent-sup".to_string(), AgentRole::Supervisor));
    let buffers = Arc::new(OutputBuffers::default());
    let results = Arc::new(RunResults::default());
    let dispatcher = Dispatcher::new(
        backend.clone(),
        buffers.clone(),
        pending,
        results.clone(),
        timeout,
    );
    Rig {
        backend,
        buffers,
        results,
        dispatcher,
        _project: project,
        path,
        supervisor: Caller::Supervisor {
            agent_id: "agent-sup".into(),
        },
    }
}

fn ask(r: &Rig, caller: &Caller, request: Value) -> Value {
    serde_json::from_str(&r.dispatcher.handle_line(caller, &request.to_string())).unwrap()
}

fn spawn_request(r: &Rig, extra: Value) -> Value {
    let mut params = json!({
        "projectPath": r.path, "prompt": "p",
        "provider": "claude", "model": "haiku", "headless": true
    });
    for (key, value) in extra.as_object().unwrap() {
        params[key] = value.clone();
    }
    json!({ "id": 1, "method": "spawn", "params": params })
}

// ── Admission: who counts as an agent ───────────────────────────────────────

/// FINDING SV-1. The ancestor walk gives up after `MAX_ANCESTORS` steps and
/// answers "no agent above", which `admit_peer` turns into `External` — every
/// method, every agent, `send_input` included. Any agent that can run a shell
/// builds a 65-deep chain of nested `sh` processes and connects from the leaf.
/// Running out of depth is not evidence that no agent is above; it must refuse.
#[test]
fn attack_a_process_nested_deeper_than_the_cap_below_a_worker_is_refused() {
    let r = rig(2, Duration::from_millis(50));
    r.backend
        .agent_pids
        .lock()
        .unwrap()
        .insert(5000, ("agent-worker".to_string(), AgentRole::Worker));
    let leaf = 5000 + MAX_ANCESTORS as u32 + 10;
    let parent_of = |pid: u32| (pid > 5000).then_some(pid - 1);
    let admitted = r.dispatcher.admit_peer(Some(leaf), parent_of);
    assert!(
        admitted.is_err(),
        "a descendant {} levels below a worker was admitted as {admitted:?}",
        leaf - 5000
    );
}

/// FINDING SV-1, with real processes: a chain of 70 nested shells below a
/// stand-in "agent" is not recognised as its descendant.
#[test]
fn attack_a_real_chain_of_70_nested_shells_still_descends_from_the_agent() {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("nest.sh");
    let leaf_file = dir.path().join("leaf.pid");
    std::fs::write(
        &script,
        "#!/bin/sh\nif [ \"$1\" -gt 0 ]; then sh \"$0\" $(( $1 - 1 )) \"$2\"; \
         else echo $$ > \"$2.tmp\"; mv \"$2.tmp\" \"$2\"; sleep 4; fi\n",
    )
    .unwrap();
    let mut root = std::process::Command::new("sh")
        .arg(&script)
        .arg("70")
        .arg(&leaf_file)
        .stdout(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let root_pid = root.id();
    let leaf = (0..100).find_map(|_| {
        std::thread::sleep(Duration::from_millis(50));
        std::fs::read_to_string(&leaf_file)
            .ok()
            .and_then(|text| text.trim().parse::<u32>().ok())
    });
    let agents: HashSet<u32> = [root_pid].into();
    let found = leaf.map(|leaf| descends_from_agent(leaf, &agents, parent_pid));
    let _ = root.kill();
    let _ = root.wait();
    assert_eq!(
        found,
        Some(Some(root_pid)),
        "the leaf of a 70-deep shell chain below the agent must still be recognised"
    );
}

/// KNOWN GAP (ADR 0003 names it, ADR 0004 repeats it): a process the agent
/// leaves behind, whose parent then exits, is reparented to launchd and is
/// seen as external. `nohup client & exit` is enough; no double fork needed.
/// Ignored because no fix inside the walk exists — recorded so the cost of the
/// gap stays visible. Run with `--ignored` to see it fail.
#[test]
#[ignore = "known gap, ADR 0003/0004; see report SV-2"]
fn attack_a_process_orphaned_by_the_agent_shell_is_still_the_agents() {
    use std::io::{BufRead, BufReader};
    let mut agent = std::process::Command::new("sh")
        .args(["-c", "sleep 5 >/dev/null 2>&1 & echo $!"])
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(agent.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let orphan: u32 = line.trim().parse().unwrap();
    let agent_pid = agent.id();
    let _ = agent.wait();
    let agents: HashSet<u32> = [agent_pid].into();
    let found = descends_from_agent(orphan, &agents, parent_pid);
    let _ = std::process::Command::new("kill")
        .arg(orphan.to_string())
        .status();
    assert_eq!(
        found,
        Some(agent_pid),
        "orphan parent is {:?}",
        parent_pid(orphan)
    );
}

#[test]
fn guard_a_worker_chain_is_refused_and_a_terminal_chain_is_external() {
    let r = rig(2, Duration::from_millis(50));
    r.backend
        .agent_pids
        .lock()
        .unwrap()
        .insert(300, ("agent-worker".to_string(), AgentRole::Worker));
    let under_worker = |pid: u32| match pid {
        900 => Some(850),
        850 => Some(300),
        _ => None,
    };
    assert_eq!(
        r.dispatcher
            .admit_peer(Some(900), under_worker)
            .unwrap_err()
            .code,
        ErrorCode::ForbiddenAgentCaller
    );
    assert_eq!(
        r.dispatcher.admit_peer(Some(901), |_| Some(1)).unwrap(),
        Caller::External
    );
    assert_eq!(
        r.dispatcher.admit_peer(None, |_| None).unwrap_err().code,
        ErrorCode::ForbiddenAgentCaller,
        "an unreadable pid fails closed"
    );
    // The nearest agent decides: a worker nested below a supervisor is a worker.
    r.backend
        .agent_pids
        .lock()
        .unwrap()
        .insert(400, ("agent-w2".to_string(), AgentRole::Worker));
    let nested = |pid: u32| match pid {
        950 => Some(400),
        400 => Some(100),
        _ => None,
    };
    assert!(r.dispatcher.admit_peer(Some(950), nested).is_err());
}

// ── Scope: only own children ────────────────────────────────────────────────

fn strip_id(message: &str, id: &str) -> String {
    message.replace(id, "<id>")
}

#[test]
fn guard_ids_that_are_not_my_children_answer_exactly_like_ids_that_do_not_exist() {
    let r = rig(2, Duration::from_millis(50));
    r.results.record(
        crate::agents::run_results::RunResult::from_finish(
            "agent-dead-child",
            AgentStatus::Idle,
            Some(0),
            None,
            || Some("SECRET answer of someone else".into()),
            1,
        ),
        Some("agent-sup-2".into()),
    );
    r.buffers.append("agent-dead-child", "SECRET console");
    r.buffers.finish("agent-dead-child", AgentStatus::Idle);
    let foreign = [
        "agent-of-other",
        "agent-human",
        "agent-sup",
        "agent-dead-child",
    ];
    for method in ["read_output", "await_result", "kill"] {
        let ghost = ask(
            &r,
            &r.supervisor,
            json!({ "id": 1, "method": method, "params": { "agentId": "agent-ghost" } }),
        );
        assert_eq!(ghost["error"]["code"], "unknown_agent", "{method}");
        for id in foreign {
            let response = ask(
                &r,
                &r.supervisor,
                json!({ "id": 1, "method": method, "params": { "agentId": id, "waitSeconds": 0 } }),
            );
            assert_eq!(response["ok"], false, "{method} {id}: {response}");
            assert_eq!(
                response["error"]["code"], "unknown_agent",
                "{method} {id}: {response}"
            );
            assert_eq!(
                strip_id(response["error"]["message"].as_str().unwrap(), id),
                strip_id(ghost["error"]["message"].as_str().unwrap(), "agent-ghost"),
                "{method} {id} must not be distinguishable from a ghost"
            );
            assert!(!response.to_string().contains("SECRET"));
        }
    }
    let listed = ask(
        &r,
        &r.supervisor,
        json!({ "id": 1, "method": "list_agents" }),
    );
    let ids: Vec<&str> = listed["result"]["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, vec!["agent-child"]);
}

#[test]
fn guard_a_supervisor_cannot_type_even_into_its_own_child() {
    let r = rig(2, Duration::from_millis(50));
    for text in ["y", "", "\u{1b}[B"] {
        let response = ask(
            &r,
            &r.supervisor,
            json!({ "id": 1, "method": "send_input",
                    "params": { "agentId": "agent-child", "text": text } }),
        );
        assert_eq!(
            response["error"]["code"], "outside_supervisor_scope",
            "{response}"
        );
    }
}

/// Everything a supervisor puts in `params` besides the five fields it may
/// choose is dropped; what the frontend receives is what Rust decided.
#[test]
fn guard_a_supervisor_cannot_smuggle_fields_into_the_frontend_request() {
    let r = rig(2, Duration::from_millis(50));
    *r.backend.spawn_delay.lock().unwrap() = Some(Duration::from_millis(1));
    let response = ask(
        &r,
        &r.supervisor,
        spawn_request(
            &r,
            json!({
                "spawnedByAgentId": "agent-victim", "runSource": "mcp",
                "dangerouslyIgnorePermissions": true, "autoAcceptEdits": true,
                "cwd": "/", "useWorktree": true, "project_path": "/", "role": null,
                "permissionMode": null
            }),
        ),
    );
    assert_eq!(response["ok"], true, "{response}");
    let sent = r.backend.requests.lock().unwrap()[0].params.clone();
    assert_eq!(
        sent,
        json!({
            "projectPath": r.path, "prompt": "p", "provider": "claude",
            "model": "haiku", "headless": true, "name": null, "permissionMode": null,
            "role": "worker",
            "spawnedByAgentId": "agent-sup", "runSource": "supervisor"
        })
    );
}

#[test]
fn guard_a_supervisor_cannot_name_a_role_or_a_permission_mode() {
    let r = rig(2, Duration::from_millis(50));
    for (extra, code) in [
        (json!({ "role": "supervisor" }), "invalid_params"),
        (json!({ "role": "worker" }), "invalid_params"),
        (json!({ "permissionMode": "" }), "outside_supervisor_scope"),
        (
            json!({ "permissionMode": "BYPASSPERMISSIONS" }),
            "outside_supervisor_scope",
        ),
        (json!({ "headless": null }), "invalid_params"),
        (json!({ "provider": null }), "invalid_params"),
        (json!({ "model": null }), "invalid_params"),
    ] {
        let response = ask(&r, &r.supervisor, spawn_request(&r, extra.clone()));
        assert_eq!(response["error"]["code"], code, "{extra}: {response}");
    }
    assert!(r.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn guard_an_external_caller_cannot_impersonate_a_supervisors_child() {
    let r = rig(2, Duration::from_millis(50));
    *r.backend.spawn_delay.lock().unwrap() = Some(Duration::from_millis(1));
    let response = ask(
        &r,
        &Caller::External,
        spawn_request(
            &r,
            json!({ "spawnedByAgentId": "agent-sup", "runSource": "supervisor" }),
        ),
    );
    assert_eq!(response["ok"], true, "{response}");
    let sent = r.backend.requests.lock().unwrap()[0].params.clone();
    assert!(sent.get("spawnedByAgentId").is_none(), "{sent}");
    assert!(sent.get("runSource").is_none(), "{sent}");
}

#[test]
fn guard_model_and_path_tricks_are_denied() {
    let r = rig(2, Duration::from_millis(50));
    let symlink_dir = tempfile::tempdir().unwrap();
    let link = symlink_dir.path().join("alias");
    std::os::unix::fs::symlink(&r.path, &link).unwrap();
    for (extra, reason) in [
        (json!({ "model": "opus" }), "model_not_allowed"),
        (json!({ "model": "" }), "model_not_allowed"),
        (json!({ "model": "auto" }), "model_not_allowed"),
        (json!({ "model": "haiku " }), "model_not_allowed"),
        (json!({ "model": "HAIKU" }), "model_not_allowed"),
        (json!({ "provider": "" }), "provider_not_installed"),
        (json!({ "provider": "crush" }), "provider_not_installed"),
        (
            json!({ "projectPath": format!("{}/sub/..", r.path) }),
            "project_not_listed",
        ),
        (json!({ "headless": false }), "interactive_not_allowed"),
    ] {
        let response = ask(&r, &r.supervisor, spawn_request(&r, extra.clone()));
        assert_eq!(
            response["error"]["code"], "supervisor_denied",
            "{extra}: {response}"
        );
        assert_eq!(response["error"]["reason"], reason, "{extra}: {response}");
    }
    // The symlink and the `..` of an existing folder resolve to the allowed one.
    *r.backend.spawn_delay.lock().unwrap() = Some(Duration::from_millis(1));
    for ok in [
        link.to_string_lossy().into_owned(),
        format!("{}/.auric/..", r.path),
        format!("{}///", r.path),
    ] {
        let response = ask(
            &r,
            &r.supervisor,
            spawn_request(&r, json!({ "projectPath": ok })),
        );
        assert_eq!(response["ok"], true, "{ok}: {response}");
        assert_eq!(
            r.backend.requests.lock().unwrap().last().unwrap().params["projectPath"],
            r.path,
            "the frontend gets the canonical path, not the caller's spelling"
        );
        // Make room under the limit for the next iteration.
        r.backend
            .agents
            .lock()
            .unwrap()
            .retain(|a| a.id.starts_with("agent-") && !a.id.starts_with("agent-new"));
    }
}

/// FINDING SV-6. The policy check normalises the provider id (trim,
/// lowercase) but the original spelling goes on to the frontend. Approved
/// as "claude", started as " Claude ": `resolve_permitted_provider` trims only
/// and the registry is case-sensitive, so the spawn then fails with "not
/// installed" — the check and the use disagree about what was asked for.
#[test]
fn attack_the_provider_the_check_approved_is_the_provider_that_is_started() {
    let r = rig(2, Duration::from_millis(50));
    *r.backend.spawn_delay.lock().unwrap() = Some(Duration::from_millis(1));
    let response = ask(
        &r,
        &r.supervisor,
        spawn_request(&r, json!({ "provider": " Claude " })),
    );
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(
        r.backend.requests.lock().unwrap()[0].params["provider"],
        "claude",
        "the frontend must receive the id that check_spawn approved"
    );
}

#[test]
fn guard_list_projects_shows_only_policy_allowed_projects() {
    let r = rig(2, Duration::from_millis(50));
    let entry = |path: &str| ProjectEntry {
        path: path.into(),
        name: path.into(),
        starred: true,
        is_open: false,
        initialized: true,
        last_opened_at: None,
        running_agents: 0,
        description: Some("do not look here".into()),
        description_source: None,
        supervisor: None,
    };
    *r.backend.projects.lock().unwrap() = vec![entry(&r.path), entry("/Users/x/secret-client")];
    let listed = ask(
        &r,
        &r.supervisor,
        json!({ "id": 1, "method": "list_projects" }),
    );
    let paths: Vec<&str> = listed["result"]["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["path"].as_str().unwrap())
        .collect();
    assert_eq!(paths, vec![r.path.as_str()]);
}

// ── Concurrency and limits ──────────────────────────────────────────────────

#[test]
fn guard_concurrent_spawns_cannot_both_pass_a_limit_of_one() {
    let r = rig(1, Duration::from_secs(2));
    r.backend
        .agents
        .lock()
        .unwrap()
        .retain(|a| a.id != "agent-child");
    *r.backend.spawn_delay.lock().unwrap() = Some(Duration::from_millis(40));
    let ok = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8)
            .map(|_| scope.spawn(|| ask(&r, &r.supervisor, spawn_request(&r, json!({})))))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|response| response["ok"] == true)
            .count()
    });
    assert_eq!(
        ok, 1,
        "exactly one of eight concurrent spawns fits under maxRunning 1"
    );
    std::thread::sleep(Duration::from_millis(100));
}

/// FINDING SV-7. `supervisor_spawn_gate` is taken before the policy check and
/// held across the whole frontend round trip (up to 30 s, or until the bridge
/// is ready). While one allowed spawn waits for a slow frontend, a spawn that
/// the policy would refuse in microseconds waits behind it for the same time.
#[test]
fn attack_a_policy_refusal_does_not_queue_behind_a_slow_spawn() {
    let r = rig(4, Duration::from_millis(600));
    // No spawn_delay: the frontend never answers, so the first spawn waits out
    // the whole 600 ms while it holds the gate.
    std::thread::scope(|scope| {
        let slow = scope.spawn(|| ask(&r, &r.supervisor, spawn_request(&r, json!({}))));
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        let refused = ask(
            &r,
            &r.supervisor,
            spawn_request(&r, json!({ "model": "opus" })),
        );
        let waited = started.elapsed();
        assert_eq!(refused["error"]["reason"], "model_not_allowed");
        assert!(
            waited < Duration::from_millis(250),
            "a refusal took {waited:?} because it waited for the gate"
        );
        let _ = slow.join();
    });
}

#[test]
fn guard_many_awaits_do_not_block_other_requests() {
    let r = rig(2, Duration::from_millis(50));
    std::thread::scope(|scope| {
        let waiters: Vec<_> = (0..24)
            .map(|_| {
                scope.spawn(|| {
                    ask(
                        &r,
                        &r.supervisor,
                        json!({ "id": 1, "method": "await_result",
                                "params": { "agentId": "agent-child", "waitSeconds": 1 } }),
                    )
                })
            })
            .collect();
        std::thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        let listed = ask(
            &r,
            &r.supervisor,
            json!({ "id": 2, "method": "list_agents" }),
        );
        assert_eq!(listed["ok"], true);
        assert!(started.elapsed() < Duration::from_millis(250));
        for waiter in waiters {
            assert_eq!(waiter.join().unwrap()["result"]["done"], false);
        }
    });
}

#[test]
fn guard_await_seconds_are_clamped_or_refused_at_the_parser() {
    let wait = |raw: &str| {
        protocol::parse_request(&format!(
            r#"{{"id":1,"method":"await_result","params":{{"agentId":"a","waitSeconds":{raw}}}}}"#
        ))
    };
    match wait("18446744073709551615").unwrap().1 {
        Request::AwaitResult(p) => assert_eq!(p.wait_seconds, Some(MAX_AWAIT_SECONDS)),
        other => panic!("{other:?}"),
    }
    for bad in ["-1", "1.5", "1e30", "\"60\"", "null_"] {
        assert!(wait(bad).is_err(), "{bad} must be refused");
    }
}

// ── The policy itself ───────────────────────────────────────────────────────

fn dynamic_providers() -> Vec<(String, Value)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../dynamic-providers");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "json"))
        .filter_map(|e| {
            let value: Value =
                serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok()?;
            Some((value["id"].as_str()?.to_string(), value))
        })
        .collect()
}

fn permission_map(provider: &Value) -> BTreeMap<String, String> {
    provider["arguments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|arg| arg["type"] == "permission")
        .flat_map(|arg| arg["map"].as_object().cloned().unwrap_or_default())
        .filter_map(|(mode, flag)| Some((mode, flag.as_str()?.to_string())))
        .collect()
}

/// Modes (other than the literal `bypassPermissions`) whose command-line flag
/// is the same as bypass's, or says "dangerously".
fn bypass_equivalents(provider: &Value) -> Vec<String> {
    let map = permission_map(provider);
    let bypass = map.get("bypassPermissions").cloned().unwrap_or_default();
    map.iter()
        .filter(|(mode, _)| mode.as_str() != "bypassPermissions")
        .filter(|(_, flag)| {
            flag.contains("dangerously") || (!bypass.is_empty() && **flag == bypass)
        })
        .map(|(mode, _)| mode.clone())
        .collect()
}

/// The provider as the app would load it from its config file.
fn provider_from(config: &Value) -> crate::providers::DynamicProvider {
    crate::providers::DynamicProvider::new(serde_json::from_value(config.clone()).unwrap())
}

/// FINDING SV-3. The policy refuses exactly the string `bypassPermissions`.
/// Antigravity maps `auto` and `yolo` to `--dangerously-skip-permissions`;
/// opencode maps `acceptEdits`, `auto` and `bypassPermissions` to the same
/// `--auto`. A policy naming any of them is accepted and the child runs with
/// every prompt off — the rule ADR 0004 says is enforced when the file is read.
///
/// Fixed (WP2): the refusal sits where the provider is known, not in `parse`.
/// `parse` is pure and provider-blind on purpose — its TS twin cannot read
/// provider configs, and a mode that is harmless today becomes unattended when
/// a config changes, so a parse-time verdict would go stale. A named
/// unattended mode is refused when the policy is saved
/// (`reject_unattended_modes`) and at every spawn (`check_spawn`, reason
/// `permission_mode_unattended`). This test asserts both, with the modes
/// derived by the production code from the real provider config.
#[test]
fn attack_the_policy_rejects_every_mode_that_means_bypass_not_only_its_name() {
    let providers = dynamic_providers();
    if providers.is_empty() {
        return; // fresh clone: dynamic-providers/*.json is git-ignored
    }
    let mut accepted = Vec::new();
    for (id, config) in &providers {
        let provider = provider_from(config);
        let model = config["info"]["models"][0]["value"]
            .as_str()
            .unwrap()
            .to_string();
        for mode in bypass_equivalents(config) {
            let raw = json!({ "version": 1, "projects": { "/abs/p": {
                "allowed": true, "permissionMode": { id: mode } } } })
            .to_string();
            let policy = parse(Some(&raw)).policy;
            let modes = BTreeMap::from([(
                id.clone(),
                crate::supervisor::modes_of(&provider, [mode.clone()]),
            )]);
            if crate::supervisor::reject_unattended_modes(&policy, &modes).is_ok() {
                accepted.push(format!("{id}:{mode} (saved)"));
            }
            let outcome = check_spawn(
                &policy,
                &ProviderPolicy::default(),
                &BTreeMap::from([(id.clone(), vec![model.clone()])]),
                &modes,
                &RunningChildren::default(),
                &SpawnRequest {
                    project_path: "/abs/p",
                    provider: id,
                    model: &model,
                    headless: true,
                },
            );
            if !matches!(&outcome, Err(denied) if denied.reason.key() == "permission_mode_unattended")
            {
                accepted.push(format!("{id}:{mode} (spawned: {outcome:?})"));
            }
        }
    }
    assert!(
        accepted.is_empty(),
        "accepted although the flag skips permissions: {accepted:?}"
    );
}

/// FINDING SV-3 (second half). With no `permissionMode` entry the child runs in
/// the provider's own default. For antigravity and opencode that default is
/// `auto` = no permission checks, and `providers: null` offers every installed
/// provider. A fresh `allowed: true` project therefore lets the supervisor
/// start an unguarded agent without anyone having chosen that.
#[test]
fn attack_a_provider_whose_default_mode_skips_permissions_needs_an_explicit_mode() {
    let providers = dynamic_providers();
    if providers.is_empty() {
        return;
    }
    let mut offenders = Vec::new();
    for (id, config) in &providers {
        let default_mode = config["info"]["defaultPermissionMode"]
            .as_str()
            .unwrap_or("default")
            .to_string();
        let skips = default_mode == "bypassPermissions"
            || bypass_equivalents(config).contains(&default_mode);
        if !skips {
            continue;
        }
        let model = config["info"]["models"][0]["value"]
            .as_str()
            .unwrap()
            .to_string();
        let policy = parse(Some(
            &json!({ "version": 1, "projects": { "/abs/p": { "allowed": true } } }).to_string(),
        ))
        .policy;
        let modes = BTreeMap::from([(
            id.clone(),
            crate::supervisor::modes_of(&provider_from(config), []),
        )]);
        let outcome = check_spawn(
            &policy,
            &ProviderPolicy::default(),
            &BTreeMap::from([(id.clone(), vec![model.clone()])]),
            &modes,
            &RunningChildren::default(),
            &SpawnRequest {
                project_path: "/abs/p",
                provider: id,
                model: &model,
                headless: true,
            },
        );
        if matches!(outcome, Ok(None)) {
            offenders.push(format!("{id} (default mode {default_mode})"));
        }
    }
    assert!(
        offenders.is_empty(),
        "spawnable with the provider default, which skips permissions: {offenders:?}"
    );
}

/// FINDING SV-4. `with_canonical_keys` folds the keys through a map, so when
/// two spellings of one folder disagree (`allowed: false` for a symlink,
/// `allowed: true` for the real path) the one that sorts last silently wins.
/// A deny can lose to an allow depending on what the folders are called.
#[test]
fn attack_a_deny_for_one_spelling_of_a_folder_cannot_lose_to_an_allow_for_another() {
    for (deny_name, allow_name) in [("a-deny", "real"), ("z-deny", "real")] {
        let dir = tempfile::tempdir().unwrap();
        let base = canonical_project_path(&dir.path().to_string_lossy());
        std::fs::create_dir(format!("{base}/real")).unwrap();
        std::os::unix::fs::symlink(format!("{base}/real"), format!("{base}/{deny_name}")).unwrap();
        let raw = json!({ "version": 1, "projects": {
            format!("{base}/{deny_name}"): { "allowed": false },
            format!("{base}/{allow_name}"): { "allowed": true },
        } })
        .to_string();
        let policy = with_canonical_keys(parse(Some(&raw)).policy);
        let rules = &policy.projects[&format!("{base}/real")];
        assert!(
            !rules.allowed,
            "deny entry '{deny_name}' lost to the allow entry for the same folder"
        );
    }
}

/// The same folder spelled with different case or Unicode normalisation (APFS
/// is insensitive to both) must resolve to one policy key, or a limit counted
/// under one spelling is not seen under the other.
#[test]
fn guard_case_and_normalisation_variants_of_a_folder_share_one_key() {
    let dir = tempfile::tempdir().unwrap();
    let base = canonical_project_path(&dir.path().to_string_lossy());
    for name in ["Projekt", "caf\u{e9}"] {
        std::fs::create_dir(format!("{base}/{name}")).unwrap();
    }
    let variants = [
        ("Projekt", "projekt"),
        ("Projekt", "PROJEKT"),
        ("caf\u{e9}", "cafe\u{301}"),
    ];
    let mut split = Vec::new();
    for (written, spelled) in variants {
        let a = canonical_project_path(&format!("{base}/{written}"));
        let b = canonical_project_path(&format!("{base}/{spelled}"));
        if std::fs::metadata(format!("{base}/{spelled}")).is_ok() && a != b {
            split.push(format!("{written} vs {spelled}: {a} / {b}"));
        }
    }
    assert!(
        split.is_empty(),
        "one folder, two keys (limits and deny entries diverge): {split:?}"
    );
}

/// FINDING SV-8. The supervisor runs Claude with `--allowedTools` for its own
/// MCP tools only *added* to whatever the user's settings already allow, and
/// with Bash, Edit and the rest still built in. ADR 0004 relies on those
/// asking the human. The user's own `~/.claude/settings.json` allows
/// `Bash(npx:*)`, `Bash(npm:*)` and `Bash(git:*)` — each runs arbitrary code
/// without a prompt, and from there a detached process is `External`.
/// The launch must remove the built-in tools (`--tools ""`/`--restricted`) or at
/// least deny Bash, and must not load the user's allow rules.
#[test]
fn attack_the_supervisor_launch_removes_the_builtin_tools() {
    let args = crate::agents::supervisor_claude_arguments(
        "/x/supervisor.mcp.json",
        &crate::supervisor::SkillPlugin::default(),
        &[],
        false,
    );
    let joined = args.join(" ");
    let restricted = args.iter().any(|a| a == "--restricted" || a == "--tools");
    let bash_denied = args
        .iter()
        .any(|a| a == "--disallowedTools" || a == "--disallowed-tools")
        && joined.contains("Bash");
    assert!(
        restricted || bash_denied,
        "the supervisor keeps Bash/Edit/Write and the user's allow rules: {joined}"
    );
    let tools = args
        .iter()
        .position(|a| a == "--tools")
        .and_then(|i| args.get(i + 1))
        .expect("--tools names the built-in set");
    assert!(
        !tools.contains("Bash"),
        "Bash without an approved skill: {joined}"
    );
    assert!(
        joined.contains("dontAsk"),
        "an unlisted tool must be refused, not asked: {joined}"
    );
}

/// FINDING SV-5. `write_policy_atomic` uses one fixed temp name for every
/// writer, so two writers share a file: one truncates while the other is still
/// writing, and the rename publishes half a file. A reader (every spawn check)
/// then sees "malformed" and the supervisor is locked out until the next save.
/// Racy by nature — the test hammers it and fails if any read was torn.
#[test]
fn attack_concurrent_policy_saves_never_publish_a_torn_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = crate::supervisor::policy_path_in(dir.path());
    let big = |n: usize| -> SupervisorPolicy {
        let projects: serde_json::Map<String, Value> = (0..150)
            .map(|i| {
                (
                    format!("/abs/project-{n}-{i}"),
                    json!({ "allowed": true, "models": { "claude": ["haiku", "sonnet"] } }),
                )
            })
            .collect();
        parse(Some(
            &json!({ "version": 1, "projects": projects }).to_string(),
        ))
        .policy
    };
    crate::supervisor::write_policy_atomic(&path, &big(0)).unwrap();
    let torn = std::sync::atomic::AtomicUsize::new(0);
    let done = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|scope| {
        let writers: Vec<_> = (1..=8)
            .map(|n| {
                let (path, policy) = (path.clone(), big(n));
                scope.spawn(move || {
                    for _ in 0..150 {
                        let _ = crate::supervisor::write_policy_atomic(&path, &policy);
                    }
                })
            })
            .collect();
        let reader = scope.spawn(|| {
            while !done.load(Ordering::SeqCst) {
                let parsed = crate::supervisor::read_policy_file(&path);
                if parsed.rejected.iter().any(|r| r.project.is_none()) {
                    torn.fetch_add(1, Ordering::SeqCst);
                }
            }
        });
        for writer in writers {
            let _ = writer.join();
        }
        done.store(true, Ordering::SeqCst);
        let _ = reader.join();
    });
    assert_eq!(
        torn.load(Ordering::SeqCst),
        0,
        "a reader saw a torn policy file"
    );
}
