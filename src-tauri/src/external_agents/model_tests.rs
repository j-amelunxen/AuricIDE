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
        token_ttl_seconds: None,
        new_token: None,
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
    apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW).unwrap();
    file
}

const TOKEN: &str = "auric_cap_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

fn token_param() -> SecretToken {
    serde_json::from_value(json!(TOKEN)).unwrap()
}

/// A live grant on `agent`, as `capability_tokens::lookup` would answer it.
fn grant_for(agent: &ExternalAgent) -> Grant {
    Grant {
        id: "cap-1".into(),
        sha256: "00".into(),
        kind: TOKEN_KIND.into(),
        resource_id: agent.id.clone(),
        actions: vec![TOKEN_ACTION_STOP.into()],
        owner_run_dir: agent.owner_run_dir.clone(),
        issued_at: NOW,
        expires_at: NOW + 3_600_000,
        revoked_at: None,
    }
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
    assert_eq!(f["corrections"]["max"], json!(MAX_CORRECTIONS));
    // Live runs alone cannot fill the token store for everyone.
    assert!(capability_tokens::MAX_GRANTS >= MAX_LIVE * capability_tokens::MAX_PER_RESOURCE);
    assert_eq!(f["token"]["scope"], json!(TOKEN_KIND));
    assert_eq!(f["token"]["action"], json!(TOKEN_ACTION_STOP));
    assert_eq!(
        f["token"]["defaultTtlSeconds"],
        json!(TOKEN_DEFAULT_TTL_SECONDS)
    );
    let reasons: Vec<EndReason> = serde_json::from_value(f["endReasons"].clone()).unwrap();
    assert_eq!(reasons.len(), 6);
    let closers = f["closedBy"].as_object().unwrap();
    assert!(closers.contains_key(CLOSED_BY_TOKEN) && closers.contains_key(CLOSED_BY_HUMAN));
    let forced: Vec<ForcedBy> =
        serde_json::from_value(f["corrections"]["forcedBy"].clone()).unwrap();
    assert_eq!(forced, vec![ForcedBy::Supervisor, ForcedBy::Human]);
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
                let answer =
                    apply_stop(&mut file, &params, &StopBy::Owner(&owner()), later).unwrap();
                (!answer.already_stopped, !answer.already_stopped)
            }
            "close:human" => {
                let id = file.agents[0].id.clone();
                let (_, closed) =
                    apply_close(&mut file, &id, CloseOptions::default(), later).unwrap();
                (closed, closed)
            }
            "stop:force" | "stop:force-failed" => {
                let mut params = stop_params();
                params.force = Some(true);
                params.finished_at = Some(NOW + 500);
                if case["call"] == "stop:force-failed" {
                    params.outcome = Some(StopOutcome::Failed);
                }
                let by = StopBy::Owner(&owner());
                let answer = apply_stop(&mut file, &params, &by, later).unwrap();
                let changed = !answer.already_stopped || answer.corrected;
                (changed, changed)
            }
            "stop:token" => {
                let grant = grant_for(&file.agents[0]);
                let mut params = stop_params();
                params.token = Some(token_param());
                let by = StopBy::Token(&grant);
                let answer = apply_stop(&mut file, &params, &by, later).unwrap();
                (!answer.already_stopped, !answer.already_stopped)
            }
            "close:force" => {
                let id = file.agents[0].id.clone();
                let options = CloseOptions {
                    force: true,
                    finished_at: Some(NOW + 500),
                    end_reason: Some(EndReason::Lost),
                };
                let (_, changed) = apply_close(&mut file, &id, options, later).unwrap();
                (changed, changed)
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
            apply_stop(
                &mut file,
                &stop_params(),
                &StopBy::Owner(&other_owner()),
                NOW
            ),
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
    let answer = apply_stop(&mut file, &stop_params(), &StopBy::Owner(&resumed), NOW + 1).unwrap();
    assert!(!answer.already_stopped);
    assert_eq!(answer.agent.owner_agent_id.as_deref(), Some("agent-99"));
}

#[test]
fn the_first_stop_wins_whatever_a_later_one_reports() {
    let mut file = file_in("running");
    let mut first = stop_params();
    first.active_seconds = Some(100);
    first.input_tokens = Some(7);
    apply_stop(&mut file, &first, &StopBy::Owner(&owner()), NOW + 10).unwrap();
    let snapshot = file.clone();

    let mut second = stop_params();
    second.outcome = Some(StopOutcome::Failed);
    second.active_seconds = Some(999);
    second.finished_at = Some(1);
    let answer = apply_stop(&mut file, &second, &StopBy::Owner(&owner()), NOW + 20).unwrap();

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
    let report = apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW)
        .unwrap()
        .agent
        .report
        .unwrap();
    assert_eq!(report.active_ms, Some(0));
    assert_eq!(report.cost_usd, Some(0.0));
    assert_eq!(report.input_tokens, None);
    assert!(report.has_figures());

    let mut bare = file_in("running");
    let answer = apply_stop(&mut bare, &stop_params(), &StopBy::Owner(&owner()), NOW).unwrap();
    assert_eq!(answer.agent.report, None);

    let mut only_flag = stop_params();
    only_flag.partial = Some(true);
    let mut flagged = file_in("running");
    let report = apply_stop(&mut flagged, &only_flag, &StopBy::Owner(&owner()), NOW)
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
    let agent = apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW + 1000)
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
        apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW),
        Err(ExternalError::InvalidParams(_))
    ));
    stop.finished_at = Some(NOW + CLOCK_SKEW_MS + 1);
    assert!(matches!(
        apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW),
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
    let agent = apply_stop(&mut file, &stop_params(), &StopBy::Owner(&owner()), NOW)
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
    apply_stop(&mut file, &stop, &StopBy::Owner(&owner()), NOW).unwrap();
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
    let (agent, closed) = apply_close(&mut file, &id, CloseOptions::default(), NOW + 100).unwrap();
    assert!(closed);
    assert_eq!(agent.closed_by.as_deref(), Some("human"));
    assert_eq!(agent.report, None);
    let late = apply_stop(
        &mut file,
        &stop_params(),
        &StopBy::Owner(&owner()),
        NOW + 200,
    )
    .unwrap();
    assert!(late.already_stopped);
    assert_eq!(late.agent.closed_by.as_deref(), Some("human"));
    assert_eq!(
        apply_close(&mut file, "ext-unknown", CloseOptions::default(), NOW),
        Err(ExternalError::UnknownId("ext-unknown".into()))
    );
}

#[test]
fn a_late_stop_on_a_stale_entry_works_normally() {
    let mut file = file_in("running");
    let later = NOW + STALE_RUNNING_AFTER_MS + 1;
    assert!(file.agents[0].is_stale(later));
    let answer = apply_stop(&mut file, &stop_params(), &StopBy::Owner(&owner()), later).unwrap();
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

fn stop_with(
    file: &mut ExternalFile,
    params: Value,
    by: &StopBy<'_>,
    now: u64,
) -> Result<StopAnswer, ExternalError> {
    let params: ExternalStopParams = serde_json::from_value(params).unwrap();
    validate_stop(&params).map_err(ExternalError::InvalidParams)?;
    apply_stop(file, &params, by, now)
}

#[test]
fn a_token_stops_its_own_run_and_marks_who_stopped_it() {
    let mut file = file_in("running");
    let grant = grant_for(&file.agents[0]);
    let params = json!({ "externalId": "box-7", "runId": "lease-42", "token": TOKEN,
        "outcome": "failed", "endReason": "timeout", "activeSeconds": 60 });
    let answer = stop_with(&mut file, params, &StopBy::Token(&grant), NOW + 10).unwrap();
    assert!(!answer.already_stopped);
    let agent = &file.agents[0];
    assert_eq!(agent.state, ExternalState::Failed);
    assert_eq!(agent.closed_by.as_deref(), Some(CLOSED_BY_TOKEN));
    assert_eq!(agent.end_reason, Some(EndReason::Timeout));
    assert_eq!(
        agent.owner_agent_id.as_deref(),
        Some("agent-22"),
        "a token is no owner"
    );
    assert!(agent.corrections.is_empty());
}

#[test]
fn a_token_opens_its_run_and_nothing_else() {
    let mut file = file_in("running");
    let other = json!({ "externalId": "box-8", "runId": "lease-1", "projectPath": PROJECT,
        "name": "Other", "provider": "claude", "state": "running" });
    let other: ExternalRegisterParams = serde_json::from_value(other).unwrap();
    register(&mut file, &other, &owner(), NOW).unwrap();
    let grant = grant_for(&file.agents[0]);
    let token_stop =
        |key: &str, run: &str| json!({ "externalId": key, "runId": run, "token": TOKEN });
    let scope = Err(ExternalError::Token(TokenError::Scope));

    // Another run, an unknown key, a grant for another action, another owner.
    let by = StopBy::Token(&grant);
    assert_eq!(
        stop_with(&mut file, token_stop("box-8", "lease-1"), &by, NOW),
        scope
    );
    assert_eq!(
        stop_with(&mut file, token_stop("box-9", "x"), &by, NOW),
        scope
    );
    let mut register_only = grant.clone();
    register_only.actions = vec!["external_register".into()];
    let by = StopBy::Token(&register_only);
    assert_eq!(
        stop_with(&mut file, token_stop("box-7", "lease-42"), &by, NOW),
        scope
    );
    let mut foreign = grant.clone();
    foreign.owner_run_dir = other_owner().run_dir;
    let by = StopBy::Token(&foreign);
    assert_eq!(
        stop_with(&mut file, token_stop("box-7", "lease-42"), &by, NOW),
        scope
    );

    // Expired and revoked.
    let by = StopBy::Token(&grant);
    let expired = stop_with(
        &mut file,
        token_stop("box-7", "lease-42"),
        &by,
        grant.expires_at,
    );
    assert_eq!(expired, Err(ExternalError::Token(TokenError::Unknown)));
    let mut revoked = grant.clone();
    revoked.revoked_at = Some(NOW);
    let by = StopBy::Token(&revoked);
    let refused = stop_with(&mut file, token_stop("box-7", "lease-42"), &by, NOW);
    assert_eq!(refused, Err(ExternalError::Token(TokenError::Revoked)));

    // A token never forces, neither through the params check nor past it.
    let forced =
        json!({ "externalId": "box-7", "runId": "lease-42", "token": TOKEN, "force": true });
    assert!(matches!(
        stop_with(&mut file, forced.clone(), &StopBy::Token(&grant), NOW),
        Err(ExternalError::InvalidParams(_))
    ));
    let forced: ExternalStopParams = serde_json::from_value(forced).unwrap();
    assert!(matches!(
        apply_stop(&mut file, &forced, &StopBy::Token(&grant), NOW),
        Err(ExternalError::InvalidParams(_))
    ));
    assert!(
        file.agents.iter().all(ExternalAgent::is_live),
        "nothing moved"
    );
}

#[test]
fn a_token_stop_after_the_end_changes_nothing() {
    let mut file = file_in("stopped");
    let before = file.agents[0].clone();
    let grant = grant_for(&before);
    let params = json!({ "externalId": "box-7", "runId": "lease-42", "token": TOKEN,
        "finishedAt": NOW + 50, "outcome": "failed" });
    let answer = stop_with(&mut file, params, &StopBy::Token(&grant), NOW + 100).unwrap();
    assert!(answer.already_stopped && !answer.corrected);
    assert_eq!(file.agents[0], before);
}

#[test]
fn force_on_a_live_run_closes_it_with_the_given_values_and_an_audit_record() {
    let mut file = file_in("running");
    let params = json!({ "externalId": "box-7", "runId": "lease-42", "force": true,
        "finishedAt": NOW + 600_000, "activeSeconds": 300, "endReason": "lost" });
    let at = NOW + 7_200_000;
    let answer = stop_with(&mut file, params, &StopBy::Owner(&owner()), at).unwrap();
    assert!(!answer.already_stopped);
    let agent = &file.agents[0];
    assert_eq!(
        agent.finished_at,
        Some(NOW + 600_000),
        "the given end, not now"
    );
    assert_eq!(agent.on_ms(at), 600_000);
    assert_eq!(agent.report.as_ref().unwrap().active_ms, Some(300_000));
    assert_eq!(agent.end_reason, Some(EndReason::Lost));
    assert_eq!(agent.closed_by, None);
    let audit = &agent.corrections[0];
    assert_eq!(audit.forced_by, ForcedBy::Supervisor);
    assert_eq!(audit.agent_id.as_deref(), Some("agent-22"));
    assert_eq!(audit.at, at);
    assert!(!audit.was_booked);
    assert_eq!(audit.previous.state, ExternalState::Running);
    assert_eq!(audit.previous.finished_at, None);
}

#[test]
fn force_corrects_a_final_run_and_keeps_what_it_replaced() {
    let mut file = file_in("running");
    let first = json!({ "externalId": "box-7", "runId": "lease-42", "finishedAt": NOW + 10_000,
        "inputTokens": 100, "activeSeconds": 5 });
    stop_with(&mut file, first, &StopBy::Owner(&owner()), NOW + 10_000).unwrap();
    file.agents[0].booked = true;

    let fix = json!({ "externalId": "box-7", "runId": "lease-42", "force": true,
        "finishedAt": NOW + 4_000, "outcome": "failed", "activeSeconds": 3, "endReason": "reaped" });
    let answer = stop_with(&mut file, fix, &StopBy::Owner(&owner()), NOW + 20_000).unwrap();
    assert!(answer.already_stopped && answer.corrected);

    let agent = &file.agents[0];
    assert_eq!(agent.state, ExternalState::Failed);
    assert_eq!(agent.finished_at, Some(NOW + 4_000));
    let span = OnSpan {
        from: NOW,
        to: Some(NOW + 4_000),
    };
    assert_eq!(agent.on_spans, vec![span]);
    let report = agent.report.as_ref().unwrap();
    assert_eq!(report.active_ms, Some(3_000), "given figures replace");
    assert_eq!(report.input_tokens, Some(100), "figures not given stay");
    assert_eq!(agent.end_reason, Some(EndReason::Reaped));
    assert!(!agent.booked, "booked again with the corrected values");
    let audit = &agent.corrections[0];
    assert!(audit.was_booked);
    assert_eq!(audit.previous.state, ExternalState::Stopped);
    assert_eq!(audit.previous.finished_at, Some(NOW + 10_000));
    let previous = audit.previous.report.as_ref().unwrap();
    assert_eq!(previous.active_ms, Some(5_000));
    assert_eq!(audit.previous.end_reason, None);
}

#[test]
fn without_force_a_second_stop_stays_a_no_op_and_the_same_values_record_nothing() {
    let mut file = file_in("stopped");
    let before = file.agents[0].clone();
    let late = json!({ "externalId": "box-7", "runId": "lease-42", "finishedAt": NOW + 1 });
    let answer = stop_with(&mut file, late, &StopBy::Owner(&owner()), NOW + 5).unwrap();
    assert!(answer.already_stopped && !answer.corrected);
    assert_eq!(file.agents[0], before);

    let same = json!({ "externalId": "box-7", "runId": "lease-42", "force": true,
        "finishedAt": before.finished_at.unwrap() });
    let answer = stop_with(&mut file, same, &StopBy::Owner(&owner()), NOW + 5).unwrap();
    assert!(!answer.corrected);
    assert_eq!(file.agents[0], before);
}

#[test]
fn force_is_for_the_owner_and_keeps_to_the_clock_rule_and_the_audit_bound() {
    let mut file = file_in("stopped");
    let forced = |at: u64| json!({ "externalId": "box-7", "runId": "lease-42", "force": true, "finishedAt": at });
    let mine = StopBy::Owner(&owner());
    let other = other_owner();
    let foreign = stop_with(&mut file, forced(NOW + 1), &StopBy::Owner(&other), NOW + 5);
    assert!(matches!(foreign, Err(ExternalError::UnknownKey(_))));
    let early = stop_with(&mut file, forced(NOW - 1), &mine, NOW + 5);
    assert!(matches!(early, Err(ExternalError::InvalidParams(_))));
    for step in 0..MAX_CORRECTIONS as u64 {
        stop_with(&mut file, forced(NOW + 10 + step), &mine, NOW + 100).unwrap();
    }
    let over = stop_with(&mut file, forced(NOW + 1_000), &mine, NOW + 100);
    assert!(matches!(over, Err(ExternalError::InvalidParams(_))));
    assert_eq!(file.agents[0].corrections.len(), MAX_CORRECTIONS);
    let last = NOW + 10 + MAX_CORRECTIONS as u64 - 1;
    assert_eq!(file.agents[0].finished_at, Some(last));
}

#[test]
fn the_human_closes_a_stale_run_at_its_last_sign_of_life() {
    let mut file = file_in("running");
    let id = file.agents[0].id.clone();
    let last_seen = file.agents[0].last_seen_at;
    let options = CloseOptions {
        force: false,
        finished_at: Some(last_seen),
        end_reason: Some(EndReason::Lost),
    };
    let later = NOW + 3 * STALE_RUNNING_AFTER_MS;
    // The same close, had the run's real stop landed first, changes nothing.
    let mut raced = file.clone();
    let stop = StopBy::Owner(&owner());
    apply_stop(&mut raced, &stop_params(), &stop, later - 1).unwrap();
    let before = raced.agents[0].clone();
    let (_, changed) = apply_close(&mut raced, &id, options, later).unwrap();
    assert!(!changed);
    assert_eq!(raced.agents[0], before);

    let (agent, changed) = apply_close(&mut file, &id, options, later).unwrap();
    assert!(changed);
    assert_eq!(agent.finished_at, Some(last_seen));
    assert_eq!(agent.closed_by.as_deref(), Some(CLOSED_BY_HUMAN));
    assert_eq!(agent.end_reason, Some(EndReason::Lost));
    assert_eq!(agent.corrections[0].forced_by, ForcedBy::Human);
    assert_eq!(agent.corrections[0].agent_id, None);
}

#[test]
fn the_human_corrects_a_final_run_only_with_force() {
    let mut file = file_in("stopped");
    let id = file.agents[0].id.clone();
    let before = file.agents[0].clone();
    let fix = CloseOptions {
        force: false,
        finished_at: Some(NOW + 50),
        end_reason: Some(EndReason::Cancelled),
    };
    let (_, changed) = apply_close(&mut file, &id, fix, NOW + 100).unwrap();
    assert!(!changed);
    assert_eq!(file.agents[0], before);

    let forced = CloseOptions { force: true, ..fix };
    let (agent, changed) = apply_close(&mut file, &id, forced, NOW + 100).unwrap();
    assert!(changed);
    assert_eq!(agent.finished_at, Some(NOW + 50));
    assert_eq!(agent.end_reason, Some(EndReason::Cancelled));
    assert_eq!(agent.state, ExternalState::Stopped);
    assert_eq!(agent.closed_by, None, "who closed it stays as it was");
    assert_eq!(agent.corrections[0].forced_by, ForcedBy::Human);
}

#[test]
fn an_entry_without_end_reason_or_audit_reads_and_writes_as_before() {
    let file = file_in("stopped");
    let value = serde_json::to_value(&file.agents[0]).unwrap();
    assert!(value.get("endReason").is_none());
    assert!(value.get("corrections").is_none());
    let back: ExternalAgent = serde_json::from_value(value).unwrap();
    assert_eq!(back, file.agents[0]);
}
