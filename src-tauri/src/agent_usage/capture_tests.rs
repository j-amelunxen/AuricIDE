use super::*;
use crate::agent_usage::claude::parse_result;
use crate::agent_usage::record::{CostSource, RunKind, RunSource};
use crate::providers::UsageConfig;
use std::fs;

const CLAUDE_SESSION: &str = "9c5f6f43-fd2c-469e-868d-0f2918f324f3";
const CODEX_SESSION: &str = "01a0f1ef-8a2f-7a73-9006-386b97777a5a";
const CLAUDE_USAGE: &str = r#"{
  "result": { "format": "claude-json", "headlessArgs": ["--output-format", "json"] },
  "transcript": { "format": "claude-jsonl", "sessionIdFlag": "--session-id" }
}"#;
const CODEX_USAGE: &str =
    r#"{ "transcript": { "format": "codex-rollout", "sessionIdFrom": "output" } }"#;

fn started_at() -> DateTime<Utc> {
    "2026-09-30T10:50:00Z".parse().unwrap()
}

fn facts(provider: &str, headless: bool, session_id: Option<&str>) -> RunFacts {
    RunFacts {
        agent_id: "agent-3".into(),
        provider: provider.into(),
        requested_model: "auto".into(),
        headless,
        ticket_id: Some("t1".into()),
        goal_id: None,
        run_kind: RunKind::Ticket,
        run_source: RunSource::Ui,
        session_id: session_id.map(str::to_string),
        ticket_status_at_start: Some("open".into()),
        started_at: if provider == "claude" {
            claude_started_at()
        } else {
            started_at()
        },
    }
}

/// Before the fixture's first turn (10:49:09), which a claude run started later would not own.
fn claude_started_at() -> DateTime<Utc> {
    "2026-09-30T10:49:00Z".parse().unwrap()
}

fn claude_capture(project: &Path, headless: bool) -> UsageCapture {
    UsageCapture::new(
        facts("claude", headless, Some(CLAUDE_SESSION)),
        project.to_path_buf(),
        Some("/Users/dev/project".into()),
        Some(serde_json::from_str::<UsageConfig>(CLAUDE_USAGE).unwrap()),
    )
}

fn codex_capture(project: &Path, cwd: Option<&str>) -> UsageCapture {
    UsageCapture::new(
        facts("codex", false, None),
        project.to_path_buf(),
        cwd.map(str::to_string),
        Some(serde_json::from_str::<UsageConfig>(CODEX_USAGE).unwrap()),
    )
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    crate::database::init_db(dir.path().to_str().unwrap()).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn claude_home() -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let project_dir = home.path().join(".claude/projects/-Users-dev-project");
    write(
        &project_dir.join(format!("{CLAUDE_SESSION}.jsonl")),
        include_str!("fixtures/claude-transcript.jsonl"),
    );
    write(
        &project_dir
            .join(CLAUDE_SESSION)
            .join("subagents/agent-a1.jsonl"),
        include_str!("fixtures/claude-subagent.jsonl"),
    );
    home
}

fn codex_home(day: &str, file: &str) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    write(
        &home.path().join(".codex/sessions").join(day).join(file),
        include_str!("fixtures/codex-rollout.jsonl"),
    );
    home
}

fn claude_plugin() -> UsagePlugin {
    serde_json::from_str(crate::cc_usage::manifest::BUILT_IN_CLAUDE_CODE).unwrap()
}

#[test]
fn the_codex_price_list_parses() {
    let list = codex_price_list().expect("the shipped price list");
    let sol = list
        .model_for("gpt-5.6-sol")
        .expect("gpt-5.6-sol is listed");
    assert_eq!(sol.rates[0].input_per_m_tok, 4.0);
    assert_eq!(sol.rates[0].output_per_m_tok, 20.0);
    assert_eq!(list.pricing.currency, "USD");
    for model in [
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
    ] {
        assert!(list.model_for(model).is_some(), "{model} is listed");
    }
    assert_eq!(list.pricing.cache.read, 0.1);
}

#[test]
fn a_headless_claude_run_is_booked_with_the_cli_cost_and_the_benchmark() {
    let (project, home) = (project(), claude_home());
    let capture = claude_capture(project.path(), true);
    let result = parse_result(include_str!("fixtures/claude-result.json"));

    let row = capture
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Success,
            result,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.cost_source, CostSource::Cli);
    assert!((row.cost_usd.unwrap() - 0.12199465).abs() < 1e-9);
    assert!((row.estimate_cost_usd.unwrap() - 0.12199465).abs() < 1e-6);
    assert_eq!(
        row.estimate_output_tokens,
        Some(1007),
        "main + subagent transcript"
    );
    let stored = store::load(&store::open_existing(project.path()).unwrap().unwrap()).unwrap();
    assert_eq!(stored, vec![row]);
}

#[test]
fn a_killed_claude_run_is_booked_from_its_transcript_alone() {
    let (project, home) = (project(), claude_home());
    let capture = claude_capture(project.path(), true);

    let row = capture
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Killed,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.outcome, Outcome::Killed);
    assert_eq!(row.cost_source, CostSource::Estimated);
    assert_eq!(row.output_tokens, 1007);
}

#[test]
fn a_run_is_booked_once_however_many_ends_claim_it() {
    let (project, home) = (project(), claude_home());
    let capture = claude_capture(project.path(), true);

    let first = capture
        .book(
            home.path(),
            None,
            Outcome::Killed,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap();
    let second = capture
        .clone()
        .book(
            home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap();

    assert!(first.is_some());
    assert!(second.is_none());
    let stored = store::load(&store::open_existing(project.path()).unwrap().unwrap()).unwrap();
    assert_eq!(stored.len(), 1);
}

#[test]
fn a_claude_run_without_a_transcript_still_gets_a_row_without_tokens() {
    let (project, empty_home) = (project(), tempfile::tempdir().unwrap());
    let capture = claude_capture(project.path(), false);

    let row = capture
        .book(
            empty_home.path(),
            Some(&claude_plugin()),
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.cost_source, CostSource::None);
    assert_eq!(row.output_tokens, 0);
    assert_eq!(row.outcome, Outcome::Success);
}

#[test]
fn a_project_without_a_database_books_nothing_and_creates_none() {
    let (bare, home) = (tempfile::tempdir().unwrap(), claude_home());
    let capture = claude_capture(bare.path(), true);

    let row = capture
        .book(
            home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap();

    assert!(row.is_none());
    assert!(!bare.path().join(".auric").exists());
}

#[test]
fn a_codex_run_is_found_by_the_id_read_from_its_output() {
    let project = project();
    let local_day = started_at()
        .with_timezone(&Local)
        .format("%Y/%m/%d")
        .to_string();
    let home = codex_home(
        &local_day,
        &format!("rollout-2026-09-30T12-50-03-{CODEX_SESSION}.jsonl"),
    );
    let capture = codex_capture(project.path(), Some("/Users/dev/project"));
    capture.sniff(&format!("session id: {CODEX_SESSION}\r\n"));

    let row = capture
        .book(
            home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.match_kind, MatchKind::Exact);
    assert_eq!(row.model.as_deref(), Some("gpt-5.6-sol"));
    assert_eq!(row.cache_read_tokens, 26_880);
    assert_eq!(row.session_id.as_deref(), Some(CODEX_SESSION));
    assert!((row.cost_usd.unwrap() - 0.123016).abs() < 1e-9);
}

#[test]
fn an_interactive_codex_run_is_matched_by_directory_and_time_and_says_it_guessed() {
    let project = project();
    let local_day = started_at()
        .with_timezone(&Local)
        .format("%Y/%m/%d")
        .to_string();
    let home = codex_home(
        &local_day,
        "rollout-2026-09-30T12-50-03-01a0f1ef-0000-0000-0000-000000000000.jsonl",
    );
    let capture = codex_capture(project.path(), Some("/Users/dev/project"));

    let row = capture
        .book(
            home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.match_kind, MatchKind::Heuristic);
    assert_eq!(row.output_tokens, 132);
}

#[test]
fn an_interactive_codex_run_in_another_directory_is_not_claimed() {
    let project = project();
    let local_day = started_at()
        .with_timezone(&Local)
        .format("%Y/%m/%d")
        .to_string();
    let home = codex_home(
        &local_day,
        "rollout-2026-09-30T12-50-03-01a0f1ef-0000-0000-0000-000000000000.jsonl",
    );
    let capture = codex_capture(project.path(), Some("/Users/dev/elsewhere"));

    let row = capture
        .book(
            home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .expect("a row");

    assert_eq!(row.cost_source, CostSource::None);
    assert_eq!(row.output_tokens, 0);
}

#[test]
fn only_a_headless_provider_with_a_result_format_holds_output_back() {
    let project = project();

    assert!(claude_capture(project.path(), true).holds_back_result());
    assert!(!claude_capture(project.path(), false).holds_back_result());
    assert!(!codex_capture(project.path(), None).holds_back_result());
}

#[test]
fn only_a_provider_that_reports_its_id_in_the_output_is_sniffed() {
    let project = project();

    assert!(codex_capture(project.path(), None).sniffs_output());
    assert!(!claude_capture(project.path(), true).sniffs_output());
}

fn agent_config(json: &str) -> crate::agents::AgentConfig {
    serde_json::from_str(json).unwrap()
}

fn seed_ticket(project: &Path, id: &str, status: &str) {
    let conn = store::open_existing(project).unwrap().unwrap();
    conn.execute_batch(&format!(
        "INSERT OR IGNORE INTO pm_epics (id, name) VALUES ('e1', 'Epic');
         INSERT INTO pm_tickets (id, epic_id, name, status) VALUES ('{id}', 'e1', 'T', '{status}');"
    ))
    .unwrap();
}

fn for_spawn(config: &crate::agents::AgentConfig, project: &Path) -> Option<UsageCapture> {
    UsageCapture::for_spawn(
        config,
        project,
        "claude",
        None,
        Some(CLAUDE_SESSION.into()),
        1_790_765_400_000,
    )
    .unwrap()
    .map(|capture| capture.with_agent_id("agent-3"))
}

#[test]
fn a_spawn_remembers_the_status_the_ticket_had_when_the_run_started() {
    let project = project();
    seed_ticket(project.path(), "t1", "in_review");
    let config = agent_config(
        r#"{"name":"n","model":"haiku","task":"t","headless":true,
            "spawnedByTicketId":"t1","runSource":"conductor"}"#,
    );

    let row = for_spawn(&config, project.path())
        .unwrap()
        .book(
            tempfile::tempdir().unwrap().path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .unwrap();

    assert_eq!(row.ticket_status_at_start.as_deref(), Some("in_review"));
    assert_eq!(row.ticket_id.as_deref(), Some("t1"));
    assert_eq!(row.run_source, RunSource::Conductor);
    assert_eq!(row.run_kind, RunKind::Ticket);
    assert_eq!(
        row.model.as_deref(),
        Some("haiku"),
        "no evidence: the requested model stands in"
    );
    assert_eq!(row.session_id.as_deref(), Some(CLAUDE_SESSION));
    assert!(row.headless);
    assert_eq!(row.started_at, "2026-09-30T10:50:00.000Z");
}

#[test]
fn a_review_run_is_booked_on_the_ticket_it_reviews() {
    let project = project();
    seed_ticket(project.path(), "t9", "in_review");
    let config = agent_config(
        r#"{"name":"n","model":"auto","task":"t","reviewOfTicketId":"t9","spawnedByGoalId":"g1"}"#,
    );

    let row = for_spawn(&config, project.path())
        .unwrap()
        .book(
            tempfile::tempdir().unwrap().path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .unwrap();

    assert_eq!(row.ticket_id.as_deref(), Some("t9"));
    assert_eq!(row.goal_id.as_deref(), Some("g1"));
    assert_eq!(row.run_kind, RunKind::Review);
    assert_eq!(row.ticket_status_at_start.as_deref(), Some("in_review"));
    assert_eq!(row.run_source, RunSource::Other, "absent source is other");
}

#[test]
fn a_spawn_in_a_folder_without_a_project_database_is_not_captured() {
    let bare = tempfile::tempdir().unwrap();
    let config = agent_config(r#"{"name":"n","model":"auto","task":"t"}"#);

    assert!(for_spawn(&config, bare.path()).is_none());
}

fn lay_out_claude_transcript(home: &Path, with_subagent: bool) {
    let project_dir = home.join(".claude/projects/-Users-dev-project");
    write(
        &project_dir.join(format!("{CLAUDE_SESSION}.jsonl")),
        include_str!("fixtures/claude-transcript.jsonl"),
    );
    if with_subagent {
        write(
            &project_dir
                .join(CLAUDE_SESSION)
                .join("subagents/agent-a1.jsonl"),
            include_str!("fixtures/claude-subagent.jsonl"),
        );
    }
}

#[test]
fn a_transcript_that_lands_after_the_exit_is_waited_for() {
    let (project, home) = (project(), tempfile::tempdir().unwrap());
    let late = home.path().to_path_buf();
    let writer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        lay_out_claude_transcript(&late, true);
    });

    let row = claude_capture(project.path(), false)
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Poll(std::time::Duration::from_secs(3)),
        )
        .unwrap()
        .unwrap();
    writer.join().unwrap();

    assert_eq!(row.output_tokens, 1007);
}

#[test]
fn a_transcript_still_missing_its_last_lines_is_waited_for_against_the_cli_total() {
    let (project, home) = (project(), tempfile::tempdir().unwrap());
    lay_out_claude_transcript(home.path(), false);
    let late = home.path().to_path_buf();
    let writer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        lay_out_claude_transcript(&late, true);
    });

    let row = claude_capture(project.path(), true)
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Success,
            parse_result(include_str!("fixtures/claude-result.json")),
            started_at(),
            EvidenceWait::Poll(std::time::Duration::from_secs(3)),
        )
        .unwrap()
        .unwrap();
    writer.join().unwrap();

    assert_eq!(
        row.estimate_output_tokens,
        Some(1007),
        "the CLI said 1007, the file caught up"
    );
}

#[test]
fn the_wait_is_bounded_and_the_row_is_still_written() {
    let (project, empty_home) = (project(), tempfile::tempdir().unwrap());
    let began = std::time::Instant::now();

    let row = claude_capture(project.path(), false)
        .book(
            empty_home.path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Poll(std::time::Duration::from_millis(300)),
        )
        .unwrap()
        .unwrap();

    assert!(began.elapsed() < std::time::Duration::from_secs(2));
    assert_eq!(row.cost_source, CostSource::None);
}

#[test]
fn skipping_the_evidence_books_the_run_without_tokens() {
    let (project, home) = (project(), claude_home());

    let row = claude_capture(project.path(), true)
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Killed,
            None,
            started_at(),
            EvidenceWait::Skip,
        )
        .unwrap()
        .unwrap();

    assert_eq!(row.outcome, Outcome::Killed);
    assert_eq!(row.cost_source, CostSource::None);
    assert_eq!(row.output_tokens, 0);
}

#[test]
fn turns_from_before_the_runs_own_start_are_not_its_cost() {
    let (project, home) = (project(), claude_home());
    let mut late_facts = facts("claude", true, Some(CLAUDE_SESSION));
    late_facts.started_at = "2026-09-30T10:49:14Z".parse().unwrap();
    let capture = UsageCapture::new(
        late_facts,
        project.path().to_path_buf(),
        None,
        Some(serde_json::from_str::<UsageConfig>(CLAUDE_USAGE).unwrap()),
    );

    let row = capture
        .book(
            home.path(),
            Some(&claude_plugin()),
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Now,
        )
        .unwrap()
        .unwrap();

    assert!(
        row.output_tokens < 1007,
        "the turn at 10:49:13 is not counted"
    );
}

#[test]
fn the_event_carries_the_project_path_exactly_as_the_agent_was_started_with() {
    let project = project();
    let as_opened = format!("{}/./", project.path().display());
    let config = agent_config(&format!(
        r#"{{"name":"n","model":"auto","task":"t","projectPath":"{as_opened}"}}"#
    ));

    let capture = for_spawn(&config, project.path()).unwrap();

    assert_eq!(capture.event_project_path(), as_opened);
}

#[test]
fn an_unreadable_project_database_is_reported_not_swallowed() {
    let dir = tempfile::tempdir().unwrap();
    write(
        &dir.path().join(".auric/project.db"),
        "this is not a database",
    );
    let config = agent_config(r#"{"name":"n","model":"auto","task":"t"}"#);

    let outcome =
        UsageCapture::for_spawn(&config, dir.path(), "claude", None, None, 1_790_765_400_000);

    assert!(outcome.is_err());
}

#[test]
fn the_agent_id_is_assigned_after_the_capture_is_prepared() {
    let project = project();
    let config = agent_config(r#"{"name":"n","model":"auto","task":"t"}"#);
    let capture = UsageCapture::for_spawn(
        &config,
        project.path(),
        "claude",
        None,
        None,
        1_790_765_400_000,
    )
    .unwrap()
    .unwrap()
    .with_agent_id("agent-42");

    let row = capture
        .book(
            tempfile::tempdir().unwrap().path(),
            None,
            Outcome::Success,
            None,
            started_at(),
            EvidenceWait::Skip,
        )
        .unwrap()
        .unwrap();

    assert_eq!(row.agent_id, "agent-42");
}
