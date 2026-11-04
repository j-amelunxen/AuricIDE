use super::model::{
    apply_register, apply_stop, ExternalFile, ExternalReport, ExternalState, Links, LiveState,
    Owner, RegisterInput,
};
use super::*;
use crate::agent_usage::record::{CostSource, Outcome, RunKind, RunSource};
use crate::agent_usage::store::{open_existing, runs_by_provider_since};
use serde_json::{json, Value};
use std::path::Path;

const NOW: u64 = 1_793_750_400_000;

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    crate::database::init_db(dir.path().to_str().unwrap()).unwrap();
    dir
}

fn owner() -> Owner {
    Owner {
        run_dir: "/tmp/runs/one".into(),
        agent_id: "agent-22".into(),
    }
}

fn register_params(project: &Path, run: &str) -> ExternalRegisterParams {
    ExternalRegisterParams {
        external_id: "box-7".into(),
        run_id: Some(run.into()),
        project_path: project.to_string_lossy().into_owned(),
        name: "Fix the parser".into(),
        provider: "claude".into(),
        model: Some("opus".into()),
        ticket_id: None,
        goal_id: None,
        state: LiveState::Running,
        started_at: None,
    }
}

fn register(dir: &Path, params: &ExternalRegisterParams, at: u64) -> String {
    store::update(dir, at, |file| {
        let answer = apply_register(
            file,
            RegisterInput {
                params,
                project_path: &params.project_path,
                links: Links::default(),
            },
            &owner(),
            at,
        )?;
        Ok((answer.agent.id, true))
    })
    .unwrap()
}

fn stop(dir: &Path, stop: Value, at: u64) {
    let params: ExternalStopParams = serde_json::from_value(stop).unwrap();
    store::update(dir, at, |file| {
        apply_stop(file, &params, &owner(), at)?;
        Ok(((), true))
    })
    .unwrap();
}

fn rows(project: &Path) -> Vec<crate::agent_usage::record::UsageRecord> {
    let conn = open_existing(project).unwrap().unwrap();
    crate::agent_usage::store::load(&conn).unwrap()
}

#[test]
fn a_stop_books_one_row_with_the_reported_figures() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({
            "externalId": "box-7", "runId": "a", "activeSeconds": 9000, "agentRuns": 2,
            "partial": true, "inputTokens": 1200, "outputTokens": 800, "cacheReadTokens": 50,
            "cacheWriteTokens": 9, "costUsd": 1.25, "finishedAt": NOW + 32_400_000u64,
        }),
        NOW + 32_400_000,
    );

    let (booked, marked) = settle(app.path(), NOW + 32_400_000).unwrap();
    assert_eq!(booked.len(), 1);
    assert!(marked);

    let all = rows(project.path());
    assert_eq!(all.len(), 1);
    let row = &all[0];
    assert_eq!(row, &booked[0].row);
    assert!(row.id.starts_with("external-ext-"));
    assert!(row.agent_id.starts_with("ext-"));
    assert_eq!(row.run_source, RunSource::External);
    assert_eq!(row.cost_source, CostSource::Reported);
    assert_eq!(row.run_kind, RunKind::Other);
    assert_eq!(row.outcome, Outcome::Success);
    assert!(row.headless);
    assert_eq!(row.duration_ms, 32_400_000);
    assert_eq!(row.active_ms, Some(9_000_000));
    assert_eq!(row.on_ms, Some(32_400_000));
    assert_eq!(row.agent_runs, Some(2));
    assert_eq!(row.runtime_partial, Some(true));
    assert_eq!(row.input_tokens, 1200);
    assert_eq!(row.cache_write_tokens, 9);
    assert_eq!(row.cost_usd, Some(1.25));
    assert_eq!(row.external_id.as_deref(), Some("box-7"));
    assert_eq!(row.external_run_id.as_deref(), Some("a"));
    assert_eq!(row.closed_by, None);

    let file = store::read(app.path()).unwrap();
    assert!(file.agents[0].booked);
    let (again, marked_again) = settle(app.path(), NOW).unwrap();
    assert!(again.is_empty() && !marked_again);
    assert_eq!(rows(project.path()).len(), 1);
}

#[test]
fn the_row_says_nothing_came_when_nothing_came() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a" }),
        NOW,
    );
    settle(app.path(), NOW).unwrap();
    let row = &rows(project.path())[0];
    assert_eq!(row.cost_source, CostSource::None);
    assert_eq!(row.cost_usd, None, "unknown, never 0");
    assert_eq!(row.active_ms, None, "unknown, never 0");
}

#[test]
fn a_failed_history_write_stays_final_answers_unbooked_and_is_retried() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    let db = project.path().join(".auric/project.db");
    let aside = project.path().join(".auric/aside.db");
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a", "inputTokens": 5 }),
        NOW,
    );
    std::fs::rename(&db, &aside).unwrap();

    let (booked, marked) = settle(app.path(), NOW).unwrap();
    assert!(booked.is_empty() && !marked);
    let file = store::read(app.path()).unwrap();
    assert_eq!(file.agents[0].state, ExternalState::Stopped);
    assert!(!file.agents[0].booked);
    assert_eq!(
        file.agents[0].report.as_ref().and_then(|r| r.input_tokens),
        Some(5)
    );

    std::fs::rename(&aside, &db).unwrap();
    let (booked, marked) = settle(app.path(), NOW).unwrap();
    assert_eq!(booked.len(), 1);
    assert!(marked);
    assert!(store::read(app.path()).unwrap().agents[0].booked);
    assert_eq!(rows(project.path()).len(), 1);
}

#[test]
fn a_crash_after_the_insert_cannot_book_twice() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a" }),
        NOW,
    );
    settle(app.path(), NOW).unwrap();

    // As if the app died between the insert and marking the entry booked.
    store::update(app.path(), NOW, |file| {
        file.agents[0].booked = false;
        Ok(((), true))
    })
    .unwrap();

    let (added, marked) = settle(app.path(), NOW).unwrap();
    assert!(added.is_empty(), "the row was there already");
    assert!(marked);
    assert_eq!(rows(project.path()).len(), 1);
}

#[test]
fn closing_by_hand_books_killed_with_no_runtime() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    let id = register(app.path(), &register_params(project.path(), "a"), NOW);

    let (view, booked, changed) = close(app.path(), &id, NOW + 60_000).unwrap();

    assert!(changed);
    assert_eq!(booked.len(), 1);
    assert_eq!(view.agent.state, ExternalState::Stopped);
    assert!(view.agent.booked);
    let row = &rows(project.path())[0];
    assert_eq!(row.outcome, Outcome::Killed);
    assert_eq!(row.closed_by.as_deref(), Some("human"));
    assert_eq!(row.active_ms, None);
    assert_eq!(row.on_ms, Some(60_000));
    assert_eq!(row.cost_source, CostSource::None);

    let (_, booked, changed) = close(app.path(), &id, NOW + 120_000).unwrap();
    assert!(
        booked.is_empty() && !changed,
        "a final entry stays as it was"
    );
    assert_eq!(rows(project.path()).len(), 1);
}

#[test]
fn a_booked_run_does_not_count_towards_load_balancing() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a" }),
        NOW,
    );
    settle(app.path(), NOW).unwrap();
    assert_eq!(rows(project.path()).len(), 1);
    assert!(runs_by_provider_since(project.path(), "2000-01-01T00:00:00Z").is_empty());
}

#[test]
fn a_booked_run_is_not_read_again_by_repricing() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a", "inputTokens": 5 }),
        NOW,
    );
    settle(app.path(), NOW).unwrap();
    let mut conn = open_existing(project.path()).unwrap().unwrap();
    let report = crate::agent_usage::reprice::reprice_unpriced(
        &mut conn,
        app.path(),
        |_| None,
        &crate::agent_usage::record::PriceLists {
            claude: None,
            codex: None,
        },
    )
    .unwrap();
    assert_eq!(report, Default::default());
}

#[test]
fn an_older_database_gains_the_columns_when_a_run_is_booked() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    {
        let conn = open_existing(project.path()).unwrap().unwrap();
        conn.execute_batch(
            "ALTER TABLE pm_agent_usage DROP COLUMN closed_by;
             DELETE FROM _migrations WHERE id = 26;",
        )
        .unwrap();
    }
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a" }),
        NOW,
    );
    assert_eq!(settle(app.path(), NOW).unwrap().0.len(), 1);
}

#[test]
fn the_task_log_line_carries_what_tells_an_external_run_apart() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    crate::webview_prefs::write_prefs_atomic(
        &crate::webview_prefs::prefs_path_in(app.path()),
        &std::collections::BTreeMap::from([(
            crate::task_log::ENABLED_PREF_KEY.to_string(),
            "true".to_string(),
        )]),
    )
    .unwrap();
    let logs = app.path().join(crate::task_log::DEFAULT_SUBDIR);
    register(app.path(), &register_params(project.path(), "a"), NOW);
    stop(
        app.path(),
        json!({ "externalId": "box-7", "runId": "a", "inputTokens": 12, "outcome": "failed" }),
        NOW + 1000,
    );
    settle(app.path(), NOW + 1000).unwrap();

    let name = std::fs::read_dir(&logs)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let text = std::fs::read_to_string(name).unwrap();
    assert_eq!(text.lines().count(), 1);
    let line: Value = serde_json::from_str(text.trim()).unwrap();
    assert_eq!(line["source"], "external");
    assert_eq!(line["externalId"], "box-7");
    assert_eq!(line["runId"], "a");
    assert_eq!(line["status"], "error");
    assert_eq!(line["role"], "worker");
    assert_eq!(line["spawnedByAgentId"], "agent-22");
    assert_eq!(line["inputTokens"], 12);
    assert_eq!(line["costSource"], "reported");
    assert_eq!(line["durationMs"], 1000);
    assert_eq!(line["onMs"], 1000);
    assert!(line.get("outputTokens").is_none(), "absent stays absent");
    assert!(line.get("activeMs").is_none(), "unknown, never 0");
    assert!(line.get("closedBy").is_none());
}

#[test]
fn an_unreadable_store_is_refused_and_never_overwritten() {
    let app = tempfile::tempdir().unwrap();
    let path = store::store_path_in(app.path());
    for broken in [
        "{ not json",
        r#"{"version":2,"agents":[]}"#,
        r#"{"version":1}"#,
    ] {
        std::fs::write(&path, broken).unwrap();
        assert!(matches!(
            store::read(app.path()),
            Err(ExternalError::Unreadable(_))
        ));
        let change = store::update(app.path(), NOW, |_| Ok(((), true)));
        assert!(matches!(change, Err(ExternalError::Unreadable(_))));
        assert!(matches!(
            settle(app.path(), NOW),
            Err(ExternalError::Unreadable(_))
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
    }
}

#[test]
fn the_store_is_private_versioned_and_leaves_no_temp_file() {
    use std::os::unix::fs::PermissionsExt;
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    let path = store::store_path_in(app.path());
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
    let text: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(text["version"], 1);
    let leftovers: Vec<_> = std::fs::read_dir(app.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn concurrent_calls_lose_no_entry() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    let threads: Vec<_> = (0..16)
        .map(|at| {
            let dir = app.path().to_path_buf();
            let params = register_params(project.path(), &format!("run-{at}"));
            std::thread::spawn(move || {
                register(&dir, &params, NOW);
            })
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(store::read(app.path()).unwrap().agents.len(), 16);
}

#[test]
fn a_restart_changes_nothing_because_the_store_is_all_there_is() {
    let app = tempfile::tempdir().unwrap();
    let project = project();
    register(app.path(), &register_params(project.path(), "a"), NOW);
    let before = store::read(app.path()).unwrap();
    let hours_later = NOW + 10 * 3_600_000;
    let (booked, marked) = settle(app.path(), hours_later).unwrap();
    assert!(booked.is_empty() && !marked);
    let after = store::read(app.path()).unwrap();
    assert_eq!(after, before);
    assert_eq!(after.agents[0].state, ExternalState::Running);
    assert!(!after.agents[0].is_stale(hours_later));
}

#[test]
fn a_ticket_is_found_by_prefix_with_its_goal_and_a_typo_is_refused() {
    let project = project();
    let conn = open_existing(project.path()).unwrap().unwrap();
    conn.execute_batch(
        "INSERT INTO pm_goals (id, name) VALUES ('goal-aaaa-1', 'A goal'), ('goal-bbbb-1', 'B');
         INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic');
         INSERT INTO pm_tickets (id, epic_id, name, goal_id) VALUES
            ('tick-aaaa-1', 'e1', 'Fix a very long ticket name that goes on and on and on', 'goal-aaaa-1'),
            ('tick-bbbb-1', 'e1', 'Second', NULL),
            ('tick-bbbb-2', 'e1', 'Third', NULL);",
    )
    .unwrap();
    let mut params = register_params(project.path(), "a");

    params.ticket_id = Some("tick-aaaa".into());
    let links = resolve_links(project.path(), &params).unwrap();
    let (id, name) = links.ticket.unwrap();
    assert_eq!(id, "tick-aaaa-1");
    assert_eq!(name.chars().count(), 40);
    assert_eq!(
        links.goal_id.as_deref(),
        Some("goal-aaaa-1"),
        "the ticket's goal"
    );

    params.goal_id = Some("goal-bbbb".into());
    let links = resolve_links(project.path(), &params).unwrap();
    assert_eq!(
        links.goal_id.as_deref(),
        Some("goal-bbbb-1"),
        "a named goal wins"
    );
    params.goal_id = None;

    params.ticket_id = Some("tick-bbbb".into());
    let error = resolve_links(project.path(), &params).unwrap_err();
    assert!(
        error.contains("ticketId") && error.contains("more than one"),
        "{error}"
    );

    params.ticket_id = Some("nope".into());
    let error = resolve_links(project.path(), &params).unwrap_err();
    assert!(error.contains("ticketId"), "{error}");

    // A prefix is bound as a value, so this finds nothing rather than everything.
    params.ticket_id = Some("%%%%".into());
    assert!(resolve_links(project.path(), &params).is_err());

    params.ticket_id = None;
    params.goal_id = Some("zzzz".into());
    let error = resolve_links(project.path(), &params).unwrap_err();
    assert!(error.contains("goalId"), "{error}");
}

#[test]
fn a_report_round_trips_through_the_store() {
    let report = ExternalReport {
        active_ms: Some(1),
        ..ExternalReport::default()
    };
    let mut file = ExternalFile::default();
    let params = register_params(Path::new("/tmp/example-project"), "a");
    let app = tempfile::tempdir().unwrap();
    let mut entry = apply_register(
        &mut file,
        RegisterInput {
            params: &params,
            project_path: "/tmp/example-project",
            links: Links::default(),
        },
        &owner(),
        NOW,
    )
    .unwrap()
    .agent;
    entry.report = Some(report);
    store::update(app.path(), NOW, |file| {
        file.agents.push(entry.clone());
        Ok(((), true))
    })
    .unwrap();
    assert_eq!(store::read(app.path()).unwrap().agents, vec![entry]);
}
