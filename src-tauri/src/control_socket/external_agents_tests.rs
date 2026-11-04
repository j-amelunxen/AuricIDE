//! The socket side of `docs/design-external-agents.md`, driven through the
//! dispatcher with a real project database underneath.

use super::*;
use crate::agent_usage::record::{CostSource, RunSource};
use crate::agent_usage::store::{load, open_existing};
use crate::external_agents::{store, CHANGED_EVENT};

const RUN_DIR: &str = "/tmp/runs/first";
const SECOND_RUN_DIR: &str = "/tmp/runs/second";

struct World {
    h: Harness,
    _app: tempfile::TempDir,
    app_path: PathBuf,
    project: tempfile::TempDir,
    path: String,
    supervisor: Caller,
    second: Caller,
}

fn supervisor_in(id: &str, run_dir: &str) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        role: AgentRole::Supervisor,
        project_path: None,
        repo_path: Some(run_dir.into()),
        ..sample_agent()
    }
}

fn world() -> World {
    let project = tempfile::tempdir().unwrap();
    crate::database::init_db(project.path().to_str().unwrap()).unwrap();
    let path = crate::supervisor::canonical_project_path(&project.path().to_string_lossy());
    let h = harness(vec![
        supervisor_in("agent-sup", RUN_DIR),
        supervisor_in("agent-sup-2", SECOND_RUN_DIR),
    ]);
    let app = tempfile::tempdir().unwrap();
    let app_path = app.path().to_path_buf();
    *h.backend.app_data.lock().unwrap() = Some(app_path.clone());
    *h.backend.policy.lock().unwrap() = scope_policy(&path);
    World {
        h,
        _app: app,
        app_path,
        project,
        path,
        supervisor: Caller::Supervisor {
            agent_id: "agent-sup".into(),
        },
        second: Caller::Supervisor {
            agent_id: "agent-sup-2".into(),
        },
    }
}

fn request(method: &str, params: Value) -> Value {
    json!({ "id": 1, "method": method, "params": params })
}

impl World {
    fn register_params(&self) -> Value {
        json!({
            "externalId": "box-7", "runId": "lease-42", "projectPath": self.path,
            "name": "Fix the parser", "provider": "claude", "model": "opus", "state": "running",
        })
    }

    fn register(&self) -> Value {
        call_as(
            &self.h,
            &self.supervisor,
            request("external_register", self.register_params()),
        )
    }

    fn stop(&self, caller: &Caller, extra: Value) -> Value {
        let mut params = json!({ "externalId": "box-7", "runId": "lease-42" });
        for (key, value) in extra.as_object().unwrap() {
            params[key] = value.clone();
        }
        call_as(&self.h, caller, request("external_stop", params))
    }

    fn rows(&self) -> Vec<crate::agent_usage::record::UsageRecord> {
        let conn = open_existing(self.project.path()).unwrap().unwrap();
        load(&conn).unwrap()
    }

    fn changes(&self) -> usize {
        *self.h.backend.external_changes.lock().unwrap()
    }
}

// testuuid: t_extend01 covers: el_extreg01,el_extstp01,el_extlst01 categories: happy level: integration
#[test]
fn a_run_goes_from_register_to_stop_and_leaves_its_row() {
    let w = world();

    let registered = w.register();
    assert_eq!(registered["ok"], true, "{registered}");
    assert_eq!(registered["result"]["created"], true);
    assert_eq!(registered["result"]["changed"], true);
    let agent = &registered["result"]["agent"];
    let id = agent["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("ext-") && id.len() == 12, "{id}");
    assert_eq!(agent["state"], "running");
    assert_eq!(agent["stale"], false);
    assert_eq!(agent["ownerRunDir"], RUN_DIR);
    assert_eq!(agent["ownerAgentId"], "agent-sup");
    assert_eq!(agent["projectPath"], w.path.as_str());
    assert_eq!(agent["onSpans"].as_array().unwrap().len(), 1);
    assert!(w.changes() > 0, "the timeline hears about it");
    assert!(w.rows().is_empty(), "nothing is booked before the stop");

    let stopped = w.stop(
        &w.supervisor,
        json!({ "activeSeconds": 9000, "inputTokens": 1200, "outputTokens": 800, "costUsd": 1.5 }),
    );
    assert_eq!(stopped["ok"], true, "{stopped}");
    assert_eq!(stopped["result"]["alreadyStopped"], false);
    assert_eq!(stopped["result"]["booked"], true);
    assert_eq!(stopped["result"]["agent"]["state"], "stopped");
    assert_eq!(stopped["result"]["agent"]["booked"], true);
    assert_eq!(stopped["result"]["agent"]["report"]["activeMs"], 9_000_000);

    let rows = w.rows();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].agent_id, id);
    assert_eq!(rows[0].run_source, RunSource::External);
    assert_eq!(rows[0].cost_source, CostSource::Reported);
    assert_eq!(rows[0].active_ms, Some(9_000_000));
    assert_eq!(rows[0].input_tokens, 1200);
    assert_eq!(rows[0].cost_usd, Some(1.5));
    assert_eq!(rows[0].external_id.as_deref(), Some("box-7"));
    assert_eq!(rows[0].external_run_id.as_deref(), Some("lease-42"));
    assert_eq!(rows[0].model.as_deref(), Some("opus"));
    let usage = w.h.backend.usage_rows.lock().unwrap();
    assert_eq!(usage.len(), 1, "the cost views hear about the row");
    assert_eq!(usage[0].0, w.path);

    let listed = call_as(&w.h, &w.supervisor, request("external_list", json!({})));
    assert_eq!(listed["result"]["agents"].as_array().unwrap().len(), 1);
    assert_eq!(listed["result"]["agents"][0]["id"], id.as_str());
}

// testuuid: t_extdbl01 covers: el_extstp01 categories: negative level: integration
#[test]
fn a_second_stop_changes_nothing_and_books_nothing() {
    let w = world();
    w.register();
    w.stop(&w.supervisor, json!({ "activeSeconds": 10 }));
    let again = w.stop(
        &w.supervisor,
        json!({ "activeSeconds": 99, "outcome": "failed", "finishedAt": 1 }),
    );
    assert_eq!(again["result"]["alreadyStopped"], true, "{again}");
    assert_eq!(again["result"]["booked"], true);
    assert_eq!(again["result"]["agent"]["state"], "stopped");
    assert_eq!(again["result"]["agent"]["report"]["activeMs"], 10_000);
    assert_eq!(w.rows().len(), 1);
    assert_eq!(w.rows()[0].active_ms, Some(10_000));

    let reregistered = w.register();
    assert_eq!(reregistered["result"]["created"], false);
    assert_eq!(reregistered["result"]["changed"], false);
    assert_eq!(reregistered["result"]["agent"]["state"], "stopped");
}

// testuuid: t_extfor01 covers: el_extreg01,el_extstp01,el_extlst01 categories: negative,security level: integration
#[test]
fn another_supervisor_is_refused_its_entries() {
    let w = world();
    w.register();

    let taken = call_as(
        &w.h,
        &w.second,
        request("external_register", w.register_params()),
    );
    assert_eq!(error_code(&taken), "supervisor_denied");
    assert_eq!(taken["error"]["reason"], "external_id_in_use");

    assert_eq!(error_code(&w.stop(&w.second, json!({}))), "unknown_agent");

    let listed = call_as(&w.h, &w.second, request("external_list", json!({})));
    assert_eq!(listed["result"]["agents"], json!([]));
    assert!(w.rows().is_empty());
}

// testuuid: t_extres01 covers: el_extstp01 categories: happy level: integration
#[test]
fn a_resumed_supervisor_keeps_its_entries_with_no_adoption() {
    let w = world();
    w.register();
    // The same folder under a new id, as a resume leaves it.
    w.h.backend
        .agents
        .lock()
        .unwrap()
        .push(supervisor_in("agent-resumed", RUN_DIR));
    let resumed = Caller::Supervisor {
        agent_id: "agent-resumed".into(),
    };
    let listed = call_as(&w.h, &resumed, request("external_list", json!({})));
    assert_eq!(listed["result"]["agents"].as_array().unwrap().len(), 1);
    let stopped = w.stop(&resumed, json!({}));
    assert_eq!(stopped["result"]["alreadyStopped"], false, "{stopped}");
    assert_eq!(stopped["result"]["agent"]["ownerAgentId"], "agent-resumed");
}

// testuuid: t_extprj01 covers: el_extreg01 categories: negative,security level: integration
#[test]
fn a_project_outside_the_policy_or_without_a_database_is_unknown() {
    let w = world();
    let mut params = w.register_params();
    params["projectPath"] = json!("/tmp/not-in-the-policy");
    let refused = call_as(
        &w.h,
        &w.supervisor,
        request("external_register", params.clone()),
    );
    assert_eq!(error_code(&refused), "unknown_project");

    std::fs::remove_file(w.project.path().join(".auric/project.db")).unwrap();
    params["projectPath"] = json!(w.path);
    let refused = call_as(&w.h, &w.supervisor, request("external_register", params));
    assert_eq!(error_code(&refused), "unknown_project");
}

// testuuid: t_extprm01 covers: el_extreg01 categories: negative,security level: integration
#[test]
fn a_bad_call_reaches_the_store_with_nothing() {
    let w = world();
    let mut with_prompt = w.register_params();
    with_prompt["prompt"] = json!("do the work");
    let mut credential = w.register_params();
    credential["name"] = json!("sk-ant-api03-abc");
    let mut unknown_ticket = w.register_params();
    unknown_ticket["ticketId"] = json!("nope-nope");
    for params in [with_prompt, credential, unknown_ticket] {
        let refused = call_as(&w.h, &w.supervisor, request("external_register", params));
        assert_eq!(error_code(&refused), "invalid_params", "{refused}");
    }
    assert!(store::read(&w.app_path).unwrap().agents.is_empty());
}

// testuuid: t_extrty01 covers: el_extstp01 categories: negative level: integration
#[test]
fn a_failed_history_write_answers_unbooked_and_a_later_call_retries_it() {
    let w = world();
    w.register();
    let db = w.project.path().join(".auric/project.db");
    let aside = w.project.path().join(".auric/aside.db");
    std::fs::rename(&db, &aside).unwrap();

    let stopped = w.stop(&w.supervisor, json!({ "inputTokens": 5 }));
    assert_eq!(stopped["ok"], true, "{stopped}");
    assert_eq!(stopped["result"]["booked"], false);
    assert_eq!(stopped["result"]["agent"]["state"], "stopped");
    assert_eq!(stopped["result"]["agent"]["booked"], false);

    std::fs::rename(&aside, &db).unwrap();
    let listed = call_as(&w.h, &w.supervisor, request("external_list", json!({})));
    assert_eq!(listed["result"]["agents"][0]["booked"], true, "{listed}");
    assert_eq!(w.rows().len(), 1);
    assert_eq!(w.rows()[0].input_tokens, 5);

    let again = w.stop(&w.supervisor, json!({}));
    assert_eq!(again["result"]["booked"], true);
    assert_eq!(again["result"]["alreadyStopped"], true);
    assert_eq!(w.rows().len(), 1);
}

// testuuid: t_extunr01 covers: el_extreg01,el_extstp01,el_extlst01 categories: negative level: integration
#[test]
fn an_unreadable_store_answers_registry_unreadable_and_stays_on_disk() {
    let w = world();
    let path = store::store_path_in(&w.app_path);
    std::fs::write(&path, "{ not json").unwrap();
    assert_eq!(error_code(&w.register()), "registry_unreadable");
    assert_eq!(
        error_code(&w.stop(&w.supervisor, json!({}))),
        "registry_unreadable"
    );
    let listed = call_as(&w.h, &w.supervisor, request("external_list", json!({})));
    assert_eq!(error_code(&listed), "registry_unreadable");
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
}

#[test]
fn a_sign_of_life_reaches_the_timeline_so_a_stale_row_clears() {
    let w = world();
    w.register();
    let before = w.changes();
    let repeat = w.register();
    assert_eq!(repeat["result"]["changed"], false, "{repeat}");
    assert_eq!(w.changes(), before + 1);

    w.stop(&w.supervisor, json!({}));
    let after_stop = w.changes();
    let on_stopped = w.register();
    assert_eq!(on_stopped["result"]["changed"], false);
    assert_eq!(w.changes(), after_stop, "a stopped key changes nothing");
}

#[test]
fn a_run_does_not_join_the_agent_list_or_any_count() {
    let w = world();
    w.register();
    let listed = call(&w.h, json!({ "id": 1, "method": "list_agents" }));
    let ids: Vec<&str> = listed["result"]["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|agent| agent["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["agent-sup", "agent-sup-2"]);
    assert!(w.h.backend.agent_pids.lock().unwrap().is_empty());
}

#[test]
fn the_event_name_is_the_one_the_frontend_listens_for() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../src/lib/agents/externalAgents.fixtures.json"
    ))
    .unwrap();
    assert_eq!(fixtures["changedEvent"], CHANGED_EVENT);
    assert_eq!(fixtures["commands"]["list"], "external_agents_list");
    assert_eq!(fixtures["commands"]["close"], "external_agent_close");
    let lib = include_str!("../lib.rs");
    assert!(lib.contains("external_agents::external_agents_list"));
    assert!(lib.contains("external_agents::external_agent_close"));
    assert_eq!(
        fixtures["methods"],
        json!(["external_register", "external_stop", "external_list"])
    );
}

// testuuid: t_extsok01 covers: el_extreg01,el_extstp01,el_extlst01 categories: happy,security level: integration
#[test]
fn over_a_real_socket_the_kernel_decides_who_may_call() {
    let dir = tempfile::tempdir().unwrap();
    let socket = socket_path_in(dir.path());
    let listener = bind(&socket).unwrap();
    let w = world();
    let params = w.register_params();
    let rows_project = w.project.path().to_path_buf();
    let backend = w.h.backend.clone();
    let dispatcher = Arc::new(w.h.dispatcher);
    std::thread::spawn(move || serve(listener, dispatcher, Duration::from_secs(5)));

    let roundtrip_once = |line: String| -> Value {
        let mut stream = UnixStream::connect(&socket).unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        roundtrip(&mut stream, &mut reader, &line)
    };
    let register = json!({ "id": 1, "method": "external_register", "params": params }).to_string();

    // This test process is no agent, so the socket takes it for an outside client.
    let outside = roundtrip_once(register.clone());
    assert_eq!(
        outside["error"]["code"], "outside_supervisor_scope",
        "{outside}"
    );

    // The same process as a running supervisor, the way the PID walk finds one.
    backend.agent_pids.lock().unwrap().insert(
        std::process::id(),
        ("agent-sup".to_string(), AgentRole::Supervisor),
    );
    let admitted = roundtrip_once(register.clone());
    assert_eq!(admitted["result"]["created"], true, "{admitted}");
    let stop = json!({
        "id": 2, "method": "external_stop",
        "params": { "externalId": "box-7", "runId": "lease-42", "inputTokens": 3 },
    });
    let stopped = roundtrip_once(stop.to_string());
    assert_eq!(stopped["result"]["booked"], true, "{stopped}");
    let conn = open_existing(&rows_project).unwrap().unwrap();
    assert_eq!(load(&conn).unwrap().len(), 1);

    // And as a worker: only `raise_question` is open to it.
    backend.agent_pids.lock().unwrap().insert(
        std::process::id(),
        ("agent-worker".to_string(), AgentRole::Worker),
    );
    let worker = roundtrip_once(register);
    assert_eq!(
        worker["error"]["code"], "forbidden_agent_caller",
        "{worker}"
    );
}
