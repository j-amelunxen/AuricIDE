use super::*;
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("../../../src/lib/agents/externalAgents.fixtures.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

const NOW: u64 = 1_793_750_400_000;
const PROJECT: &str = "/tmp/example-project";

fn owner() -> Owner {
    Owner {
        run_dir: "/tmp/runs/one".into(),
        agent_id: "agent-22".into(),
    }
}

fn other_owner() -> Owner {
    Owner {
        run_dir: "/tmp/runs/two".into(),
        agent_id: "agent-23".into(),
    }
}

fn register_params(state: LiveState) -> ExternalRegisterParams {
    ExternalRegisterParams {
        external_id: "box-7".into(),
        run_id: Some("lease-42".into()),
        project_path: PROJECT.into(),
        name: "Fix the parser".into(),
        provider: "claude".into(),
        model: None,
        ticket_id: None,
        goal_id: None,
        state,
        started_at: None,
    }
}

fn stop_params() -> ExternalStopParams {
    serde_json::from_value(json!({ "externalId": "box-7", "runId": "lease-42" })).unwrap()
}

fn register(
    file: &mut ExternalFile,
    params: &ExternalRegisterParams,
    owner: &Owner,
    now: u64,
) -> Result<RegisterAnswer, ExternalError> {
    apply_register(
        file,
        RegisterInput {
            params,
            project_path: PROJECT,
            links: Links::default(),
        },
        owner,
        now,
    )
}

/// A store holding one entry that has come to `state`.
fn file_in(state: &str) -> ExternalFile {
    let mut file = ExternalFile::default();
    let live = if state == "registered" {
        LiveState::Registered
    } else {
        LiveState::Running
    };
    register(&mut file, &register_params(live), &owner(), NOW).unwrap();
    let mut stop = stop_params();
    match state {
        "stopped" => {}
        "failed" => stop.outcome = Some(StopOutcome::Failed),
        _ => return file,
    }
    apply_stop(&mut file, &stop, &owner(), NOW).unwrap();
    file
}

#[test]
fn the_constants_are_the_ones_the_contract_names() {
    let f = fixtures();
    assert_eq!(f["version"], json!(STORE_VERSION));
    assert_eq!(f["storeFileName"], json!(STORE_FILE_NAME));
    assert_eq!(f["changedEvent"], json!(CHANGED_EVENT));
    assert_eq!(f["stale"]["runningAfterMs"], json!(STALE_RUNNING_AFTER_MS));
    assert_eq!(
        f["stale"]["registeredAfterMs"],
        json!(STALE_REGISTERED_AFTER_MS)
    );
    assert_eq!(f["retention"]["finalKeptMs"], json!(FINAL_KEPT_MS));
    assert_eq!(f["retention"]["maxLive"], json!(MAX_LIVE));
    assert_eq!(f["retention"]["maxOnSpans"], json!(MAX_ON_SPANS));
    assert_eq!(f["clock"]["skewMs"], json!(CLOCK_SKEW_MS));
    assert_eq!(f["clock"]["maxStartedAgeMs"], json!(MAX_STARTED_AGE_MS));
    assert_eq!(f["patterns"]["externalId"], json!(KEY_PATTERN));
    assert_eq!(f["patterns"]["runId"], json!(KEY_PATTERN));
    assert_eq!(f["patterns"]["provider"], json!(PROVIDER_PATTERN));
    assert_eq!(f["patterns"]["model"], json!(MODEL_PATTERN));
    assert_eq!(f["nameMaxChars"], json!(NAME_MAX_CHARS));
    assert_eq!(f["credentialShapes"], json!(CREDENTIAL_SHAPES));
    assert_eq!(f["ranges"]["activeSecondsMax"], json!(ACTIVE_SECONDS_MAX));
    assert_eq!(f["ranges"]["agentRunsMax"], json!(AGENT_RUNS_MAX));
    assert_eq!(f["ranges"]["tokensMax"], json!(TOKENS_MAX));
    assert_eq!(f["ranges"]["costUsdMax"], json!(COST_USD_MAX as u64));
    assert_eq!(
        f["states"],
        json!(["registered", "running", "stopped", "failed"])
    );
}

fn read_register(params: &Value) -> Result<(), String> {
    let parsed: ExternalRegisterParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    validate_register(&parsed)
}

fn read_stop(params: &Value) -> Result<(), String> {
    let parsed: ExternalStopParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    validate_stop(&parsed)
}

fn check_param_cases(block: &Value, read: fn(&Value) -> Result<(), String>) {
    for case in block["accept"].as_array().unwrap() {
        let result = read(&case["params"]);
        assert!(result.is_ok(), "{}: {result:?}", case["name"]);
    }
    for case in block["reject"].as_array().unwrap() {
        assert_eq!(case["code"], "invalid_params");
        assert!(read(&case["params"]).is_err(), "{}", case["name"]);
    }
}

#[test]
fn register_params_follow_the_contract() {
    check_param_cases(&fixtures()["registerParams"], read_register);
}

#[test]
fn stop_params_follow_the_contract() {
    check_param_cases(&fixtures()["stopParams"], read_stop);
}

#[test]
fn a_credential_shape_counts_only_with_no_letter_or_digit_before_it() {
    for shape in CREDENTIAL_SHAPES {
        assert!(holds_credential_shape(&format!("{shape}abc")), "{shape}");
        assert!(
            holds_credential_shape(&format!("key={shape}abc")),
            "{shape}"
        );
    }
    for name in ["Fix task-12", "Run on boxoxo", "bearer of news"] {
        assert!(!holds_credential_shape(name), "{name}");
    }
    // The first hit inside a word must not hide a real one later on.
    assert!(holds_credential_shape("task-12 sk-abc"));
}

#[test]
fn every_transition_in_the_contract_holds() {
    for case in fixtures()["transitions"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut file = file_in(case["from"].as_str().unwrap());
        let was_booked_flag = |file: &ExternalFile| file.agents[0].finished_at;
        let before = was_booked_flag(&file);
        let later = NOW + 1000;
        let (changed, booked) = match case["call"].as_str().unwrap() {
            "register:running" | "register:registered" => {
                let state = if case["call"] == "register:running" {
                    LiveState::Running
                } else {
                    LiveState::Registered
                };
                let params = register_params(state);
                let answer = register(&mut file, &params, &owner(), later).unwrap();
                (answer.changed, false)
            }
            "stop:success" | "stop:failed" => {
                let mut params = stop_params();
                if case["call"] == "stop:failed" {
                    params.outcome = Some(StopOutcome::Failed);
                }
                let answer = apply_stop(&mut file, &params, &owner(), later).unwrap();
                (!answer.already_stopped, !answer.already_stopped)
            }
            "close:human" => {
                let id = file.agents[0].id.clone();
                let (_, closed) = apply_close(&mut file, &id, later).unwrap();
                (closed, closed)
            }
            other => panic!("{name}: unknown call {other}"),
        };
        assert_eq!(json!(file.agents[0].state), case["to"], "{name}");
        assert_eq!(json!(changed), case["changed"], "{name}");
        assert_eq!(json!(booked), case["booked"], "{name}");
        if !changed {
            assert_eq!(was_booked_flag(&file), before, "{name}: moved the end");
        }
    }
}

#[test]
fn every_display_case_in_the_contract_holds() {
    for case in fixtures()["display"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut agent = file_in("running").agents.remove(0);
        let entry = &case["entry"];
        agent.state = serde_json::from_value(entry["state"].clone()).unwrap();
        agent.last_seen_at = entry["lastSeenAt"].as_u64().unwrap();
        agent.on_spans = serde_json::from_value(entry["onSpans"].clone()).unwrap();
        let now = case["now"].as_u64().unwrap();
        assert_eq!(
            json!(agent.is_stale(now)),
            case["expected"]["stale"],
            "{name}"
        );
        assert_eq!(json!(agent.on_ms(now)), case["expected"]["onMs"], "{name}");
    }
}

#[test]
fn a_repeat_is_a_sign_of_life_and_updates_what_it_names() {
    let mut file = file_in("running");
    let mut params = register_params(LiveState::Running);
    let later = NOW + 5000;

    let same = register(&mut file, &params, &owner(), later).unwrap();
    assert!(!same.created && !same.changed);
    assert_eq!(same.agent.last_seen_at, later);

    params.name = "Fix the lexer".into();
    params.model = Some("opus".into());
    let renamed = register(&mut file, &params, &owner(), later).unwrap();
    assert!(renamed.changed);
    assert_eq!(renamed.agent.name, "Fix the lexer");
    assert_eq!(renamed.agent.model.as_deref(), Some("opus"));

    // Left out means left alone, never cleared.
    params.model = None;
    let kept = register(&mut file, &params, &owner(), later).unwrap();
    assert!(!kept.changed);
    assert_eq!(kept.agent.model.as_deref(), Some("opus"));
    assert_eq!(file.agents.len(), 1);
}

#[test]
fn a_new_project_on_a_live_key_is_refused_but_a_stopped_key_just_answers() {
    let mut file = file_in("running");
    let params = register_params(LiveState::Running);
    let elsewhere = |file: &mut ExternalFile| {
        apply_register(
            file,
            RegisterInput {
                params: &params,
                project_path: "/tmp/another-project",
                links: Links::default(),
            },
            &owner(),
            NOW,
        )
    };
    assert!(matches!(
        elsewhere(&mut file),
        Err(ExternalError::InvalidParams(_))
    ));
    let mut stopped = file_in("stopped");
    assert!(!elsewhere(&mut stopped).unwrap().changed);
}

#[test]
fn run_id_tells_two_runs_of_one_box_apart_and_a_stopped_key_needs_a_new_one() {
    let mut file = file_in("stopped");
    let mut params = register_params(LiveState::Running);
    params.run_id = Some("lease-43".into());
    let answer = register(&mut file, &params, &owner(), NOW).unwrap();
    assert!(answer.created);
    params.run_id = None;
    assert!(register(&mut file, &params, &owner(), NOW).unwrap().created);
    assert_eq!(file.agents.len(), 3);
}

#[test]
fn another_owner_gets_no_way_in_to_a_key() {
    for state in ["running", "stopped"] {
        let mut file = file_in(state);
        let snapshot = file.clone();
        let params = register_params(LiveState::Running);
        assert!(matches!(
            register(&mut file, &params, &other_owner(), NOW),
            Err(ExternalError::KeyInUse(_))
        ));
        assert!(matches!(
            apply_stop(&mut file, &stop_params(), &other_owner(), NOW),
            Err(ExternalError::UnknownKey(_))
        ));
        assert_eq!(file, snapshot, "{state}");
    }
}

#[test]
fn a_resumed_supervisor_keeps_its_entries_under_a_new_agent_id() {
    let mut file = file_in("running");
    let resumed = Owner {
        run_dir: owner().run_dir,
        agent_id: "agent-99".into(),
    };
    let answer = apply_stop(&mut file, &stop_params(), &resumed, NOW + 1).unwrap();
    assert!(!answer.already_stopped);
    assert_eq!(answer.agent.owner_agent_id.as_deref(), Some("agent-99"));
}

#[test]
fn the_first_stop_wins_whatever_a_later_one_reports() {
    let mut file = file_in("running");
    let mut first = stop_params();
    first.active_seconds = Some(100);
    first.input_tokens = Some(7);
    apply_stop(&mut file, &first, &owner(), NOW + 10).unwrap();
    let snapshot = file.clone();

    let mut second = stop_params();
    second.outcome = Some(StopOutcome::Failed);
    second.active_seconds = Some(999);
    second.finished_at = Some(1);
    let answer = apply_stop(&mut file, &second, &owner(), NOW + 20).unwrap();

    assert!(answer.already_stopped);
    assert_eq!(file, snapshot);
    assert_eq!(answer.agent.report.unwrap().active_ms, Some(100_000));
}

#[test]
fn an_absent_figure_stays_unknown_and_a_zero_stays_a_zero() {
    let mut file = file_in("running");
    let mut stop = stop_params();
    stop.active_seconds = Some(0);
    stop.cost_usd = Some(0.0);
    let report = apply_stop(&mut file, &stop, &owner(), NOW)
        .unwrap()
        .agent
        .report
        .unwrap();
    assert_eq!(report.active_ms, Some(0));
    assert_eq!(report.cost_usd, Some(0.0));
    assert_eq!(report.input_tokens, None);
    assert!(report.has_figures());

    let mut bare = file_in("running");
    let answer = apply_stop(&mut bare, &stop_params(), &owner(), NOW).unwrap();
    assert_eq!(answer.agent.report, None);

    let mut only_flag = stop_params();
    only_flag.partial = Some(true);
    let mut flagged = file_in("running");
    let report = apply_stop(&mut flagged, &only_flag, &owner(), NOW)
        .unwrap()
        .agent
        .report
        .unwrap();
    assert!(!report.has_figures());
}

#[test]
fn a_stop_replaces_the_model_and_closes_the_open_span_at_its_end() {
    let mut file = file_in("running");
    let mut stop = stop_params();
    stop.model = Some("haiku".into());
    stop.finished_at = Some(NOW + 500);
    let agent = apply_stop(&mut file, &stop, &owner(), NOW + 1000)
        .unwrap()
        .agent;
    assert_eq!(agent.model.as_deref(), Some("haiku"));
    assert_eq!(agent.on_spans[0].to, Some(NOW + 500));
    assert_eq!(agent.on_ms(u64::MAX), 500);
}

#[test]
fn the_clock_rule_of_the_contract_holds() {
    let mut params = register_params(LiveState::Running);
    let refused = |params: &ExternalRegisterParams| {
        let mut file = ExternalFile::default();
        matches!(
            register(&mut file, params, &owner(), NOW),
            Err(ExternalError::InvalidParams(_))
        )
    };
    params.started_at = Some(NOW + CLOCK_SKEW_MS);
    assert!(!refused(&params));
    params.started_at = Some(NOW + CLOCK_SKEW_MS + 1);
    assert!(refused(&params));
    params.started_at = Some(NOW - MAX_STARTED_AGE_MS);
    assert!(!refused(&params));
    params.started_at = Some(NOW - MAX_STARTED_AGE_MS - 1);
    assert!(refused(&params));

    let mut stop = stop_params();
    stop.finished_at = Some(NOW - 1);
    let mut file = file_in("running");
    assert!(matches!(
        apply_stop(&mut file, &stop, &owner(), NOW),
        Err(ExternalError::InvalidParams(_))
    ));
    stop.finished_at = Some(NOW + CLOCK_SKEW_MS + 1);
    assert!(matches!(
        apply_stop(&mut file, &stop, &owner(), NOW),
        Err(ExternalError::InvalidParams(_))
    ));
    assert!(file.agents[0].is_live(), "a refused stop leaves it live");
}

#[test]
fn a_start_slightly_ahead_of_this_clock_still_stops_without_a_stated_end() {
    let mut file = ExternalFile::default();
    let mut params = register_params(LiveState::Running);
    params.started_at = Some(NOW + 1000);
    register(&mut file, &params, &owner(), NOW).unwrap();
    let agent = apply_stop(&mut file, &stop_params(), &owner(), NOW)
        .unwrap()
        .agent;
    assert_eq!(agent.finished_at, Some(NOW + 1000));
}

#[test]
fn the_live_bound_refuses_a_new_key_but_not_a_known_one() {
    let mut file = ExternalFile::default();
    let mut params = register_params(LiveState::Registered);
    for at in 0..MAX_LIVE {
        params.run_id = Some(format!("lease-{at}"));
        register(&mut file, &params, &owner(), NOW).unwrap();
    }
    params.run_id = Some("one-too-many".into());
    assert_eq!(
        register(&mut file, &params, &owner(), NOW),
        Err(ExternalError::LimitReached)
    );
    params.run_id = Some("lease-0".into());
    assert!(register(&mut file, &params, &owner(), NOW).is_ok());

    // A final entry does not hold a place.
    let mut stop = stop_params();
    stop.run_id = Some("lease-1".into());
    apply_stop(&mut file, &stop, &owner(), NOW).unwrap();
    params.run_id = Some("one-more".into());
    assert!(register(&mut file, &params, &owner(), NOW).unwrap().created);
}

#[test]
fn past_the_span_bound_a_change_extends_the_last_span() {
    let mut file = file_in("running");
    let mut at = NOW;
    let mut flip = |file: &mut ExternalFile, state| {
        at += 10;
        register(file, &register_params(state), &owner(), at).unwrap()
    };
    for _ in 0..(MAX_ON_SPANS + 5) {
        flip(&mut file, LiveState::Registered);
        flip(&mut file, LiveState::Running);
    }
    let agent = &file.agents[0];
    assert_eq!(agent.on_spans.len(), MAX_ON_SPANS);
    assert_eq!(agent.on_spans.last().unwrap().to, None);
    assert_eq!(
        agent.on_spans.iter().filter(|s| s.to.is_none()).count(),
        1,
        "only the last span is open"
    );
}

#[test]
fn final_booked_entries_go_after_their_time_and_nothing_else_does() {
    let mut file = file_in("stopped");
    let later = NOW + FINAL_KEPT_MS + 1;
    assert!(!file.prune(later), "not booked: the figures are only here");
    file.agents[0].booked = true;
    assert!(!file.prune(NOW + FINAL_KEPT_MS), "exactly at the limit");
    assert!(file.prune(later));
    assert!(file.agents.is_empty());

    let mut live = file_in("running");
    assert!(!live.prune(later + FINAL_KEPT_MS));
}

#[test]
fn the_human_closes_with_no_runtime_and_a_late_stop_then_changes_nothing() {
    let mut file = file_in("running");
    let id = file.agents[0].id.clone();
    let (agent, closed) = apply_close(&mut file, &id, NOW + 100).unwrap();
    assert!(closed);
    assert_eq!(agent.closed_by.as_deref(), Some("human"));
    assert_eq!(agent.report, None);
    let late = apply_stop(&mut file, &stop_params(), &owner(), NOW + 200).unwrap();
    assert!(late.already_stopped);
    assert_eq!(late.agent.closed_by.as_deref(), Some("human"));
    assert_eq!(
        apply_close(&mut file, "ext-unknown", NOW),
        Err(ExternalError::UnknownId("ext-unknown".into()))
    );
}

#[test]
fn a_late_stop_on_a_stale_entry_works_normally() {
    let mut file = file_in("running");
    let later = NOW + STALE_RUNNING_AFTER_MS + 1;
    assert!(file.agents[0].is_stale(later));
    let answer = apply_stop(&mut file, &stop_params(), &owner(), later).unwrap();
    assert!(!answer.already_stopped);
    assert!(!answer.agent.is_stale(later));
}

#[test]
fn the_wire_view_and_the_file_share_the_fields_of_the_contract() {
    let view = file_in("running").agents[0].view(NOW);
    let wire = serde_json::to_value(&view).unwrap();
    let f: Value = serde_json::from_str(include_str!(
        "../../../src/lib/agents/agentControl.fixtures.json"
    ))
    .unwrap();
    let mut expected: Vec<&String> = f["responses"]["external_list"]["result"]["agents"][0]
        .as_object()
        .unwrap()
        .keys()
        .collect();
    let mut actual: Vec<&String> = wire.as_object().unwrap().keys().collect();
    expected.sort();
    actual.sort();
    assert_eq!(actual, expected);
}
