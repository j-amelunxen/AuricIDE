use super::*;
use crate::agent_usage::capture::codex_price_list;
use crate::agent_usage::claude::session_tokens;
use crate::cc_usage::manifest::{UsagePlugin, BUILT_IN_CLAUDE_CODE};
use std::fs;

const CLAUDE_SESSION: &str = "9c5f6f43-fd2c-469e-868d-0f2918f324f3";
const HAIKU: &str = "claude-haiku-4-5-20251001";
/// Before the fixture's first turn (10:49:09) and after its last.
const STARTED: &str = "2026-09-30T10:49:00.000Z";
const FINISHED: &str = "2026-09-30T11:00:00.000Z";

fn project() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    crate::database::init_db(dir.path().to_str().unwrap()).unwrap();
    let conn = crate::agent_usage::store::open_existing(dir.path())
        .unwrap()
        .unwrap();
    (dir, conn)
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

/// What the fixture transcript holds, summed over models: the booked tokens
/// of a run that was read from it.
fn fixture_tokens(home: &Path) -> TokenCounts {
    let files = find_session_files(&home.join(CLAUDE_PROJECTS_DIR), CLAUDE_SESSION);
    session_tokens(&files, 0)
        .values()
        .fold(TokenCounts::default(), |mut sum, counts| {
            sum += *counts;
            sum
        })
}

fn claude_list() -> UsagePlugin {
    serde_json::from_str(BUILT_IN_CLAUDE_CODE).unwrap()
}

/// The shipped list without Haiku 4.5: the state the run was booked under.
fn list_without_haiku() -> UsagePlugin {
    let mut list = claude_list();
    list.pricing
        .models
        .retain(|model| model.id != "claude-haiku-4-5");
    list
}

struct Row<'a> {
    id: &'a str,
    provider: &'a str,
    model: &'a str,
    cost_source: &'a str,
    cost_usd: Option<f64>,
    tokens: TokenCounts,
}

fn insert(conn: &Connection, row: Row) {
    conn.execute(
        "INSERT INTO pm_agent_usage (id, agent_id, run_kind, run_source, provider, model,
            session_id, started_at, finished_at, duration_ms, outcome, input_tokens,
            output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
            cost_usd, cost_source, unpriced_models)
         VALUES (?1, 'a', 'goal', 'conductor', ?2, ?3, ?4, ?5, ?6, 0, 'success', ?7, ?8, ?9,
                 ?10, ?11, ?12, ?13, ?14)",
        params![
            row.id,
            row.provider,
            row.model,
            CLAUDE_SESSION,
            STARTED,
            FINISHED,
            row.tokens.input as i64,
            row.tokens.output as i64,
            row.tokens.cache_read as i64,
            (row.tokens.cache_write5m + row.tokens.cache_write1h) as i64,
            row.tokens.thinking as i64,
            row.cost_usd,
            row.cost_source,
            row.cost_usd
                .is_none()
                .then(|| format!("[\"{}\"]", row.model)),
        ],
    )
    .unwrap();
}

fn cost_of(conn: &Connection, id: &str) -> (Option<f64>, Option<String>) {
    conn.query_row(
        "SELECT cost_usd, unpriced_models FROM pm_agent_usage WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .unwrap()
}

fn formats(provider: &str) -> Option<TranscriptFormat> {
    match provider {
        "claude" => Some(TranscriptFormat::ClaudeJsonl),
        "codex" => Some(TranscriptFormat::CodexRollout),
        _ => None,
    }
}

fn run(conn: &mut Connection, home: &Path, claude: &UsagePlugin) -> RepriceReport {
    reprice_unpriced(
        conn,
        home,
        formats,
        &PriceLists {
            claude: Some(claude),
            codex: codex_price_list(),
        },
    )
    .unwrap()
}

fn unpriced_claude_run(id: &str, tokens: TokenCounts) -> Row<'_> {
    Row {
        id,
        provider: "claude",
        model: HAIKU,
        cost_source: "estimated",
        cost_usd: None,
        tokens,
    }
}

#[test]
fn a_run_booked_before_its_model_was_priced_gets_the_price_the_booking_would_have_given() {
    let home = claude_home();
    let (_dir, mut conn) = project();
    insert(
        &conn,
        unpriced_claude_run("r1", fixture_tokens(home.path())),
    );

    let report = run(&mut conn, home.path(), &claude_list());

    // The same figure a booking with the current list would have written.
    let files = find_session_files(&home.path().join(CLAUDE_PROJECTS_DIR), CLAUDE_SESSION);
    let expected = price_models(
        Some(&claude_list()),
        &session_tokens(&files, 0),
        "2026-09-30",
    )
    .cost_usd
    .unwrap();
    let (cost, unpriced) = cost_of(&conn, "r1");
    assert_eq!(cost, Some(expected));
    assert!(expected > 0.0);
    assert_eq!(unpriced, None, "a priced run names no unpriced model");
    assert_eq!(
        report,
        RepriceReport {
            unpriced: 1,
            repriced: 1,
            ..Default::default()
        }
    );
}

#[test]
fn a_model_the_list_still_does_not_know_stays_unpriced_and_is_named() {
    let home = claude_home();
    let (_dir, mut conn) = project();
    insert(
        &conn,
        unpriced_claude_run("r1", fixture_tokens(home.path())),
    );

    let report = run(&mut conn, home.path(), &list_without_haiku());

    assert_eq!(cost_of(&conn, "r1").0, None, "never priced at zero");
    assert_eq!(report.still_unpriced, 1);
    assert_eq!(report.repriced, 0);
    assert_eq!(report.unpriced_models, vec![HAIKU.to_string()]);
}

#[test]
fn a_run_whose_transcript_is_gone_is_left_as_it_was() {
    let home = claude_home();
    let tokens = fixture_tokens(home.path());
    let empty_home = tempfile::tempdir().unwrap();
    let (_dir, mut conn) = project();
    insert(&conn, unpriced_claude_run("r1", tokens));

    let report = run(&mut conn, empty_home.path(), &claude_list());

    assert_eq!(cost_of(&conn, "r1").0, None);
    assert_eq!(report.missing_evidence, 1);
}

#[test]
fn a_transcript_that_no_longer_adds_up_to_the_booked_tokens_is_not_priced() {
    // The price is written next to the booked tokens. Pricing different
    // tokens than the row shows would make the row contradict itself.
    let home = claude_home();
    let mut tokens = fixture_tokens(home.path());
    tokens.output += 1;
    let (_dir, mut conn) = project();
    insert(&conn, unpriced_claude_run("r1", tokens));

    let report = run(&mut conn, home.path(), &claude_list());

    assert_eq!(cost_of(&conn, "r1").0, None);
    assert_eq!(report.changed_evidence, 1);
}

#[test]
fn turns_after_the_run_ended_do_not_belong_to_it() {
    // A session resumed after the run appends turns to the same transcript.
    let home = claude_home();
    let booked = fixture_tokens(home.path());
    let later_turn = include_str!("fixtures/claude-transcript.jsonl")
        .lines()
        .find(|line| line.contains("\"output_tokens\""))
        .unwrap()
        .replace("2026-09-30T10:4", "2026-09-30T14:4")
        .replace("msg_", "msg_resumed_")
        .replace("req_", "req_resumed_");
    let transcript = home
        .path()
        .join(".claude/projects/-Users-dev-project")
        .join(format!("{CLAUDE_SESSION}.jsonl"));
    let mut text = fs::read_to_string(&transcript).unwrap();
    text.push_str(&later_turn);
    text.push('\n');
    fs::write(&transcript, text).unwrap();
    let (_dir, mut conn) = project();
    insert(&conn, unpriced_claude_run("r1", booked));

    let report = run(&mut conn, home.path(), &claude_list());

    assert_eq!(report.repriced, 1, "{report:?}");
}

#[test]
fn a_codex_run_is_priced_from_its_own_row() {
    let home = tempfile::tempdir().unwrap();
    let (_dir, mut conn) = project();
    let model = codex_price_list().unwrap().pricing.models[0].id.clone();
    insert(
        &conn,
        Row {
            id: "c1",
            provider: "codex",
            model: &model,
            cost_source: "estimated",
            cost_usd: None,
            tokens: TokenCounts {
                input: 1_000_000,
                output: 0,
                ..Default::default()
            },
        },
    );

    let report = run(&mut conn, home.path(), &claude_list());

    let rate = codex_price_list().unwrap().pricing.models[0].rates[0].input_per_m_tok;
    assert_eq!(report.repriced, 1);
    assert_eq!(cost_of(&conn, "c1").0, Some(rate));
}

#[test]
fn runs_that_already_have_a_price_or_came_from_the_cli_are_never_touched() {
    let home = claude_home();
    let tokens = fixture_tokens(home.path());
    let (_dir, mut conn) = project();
    insert(
        &conn,
        Row {
            cost_usd: Some(1.5),
            ..unpriced_claude_run("priced", tokens)
        },
    );
    insert(
        &conn,
        Row {
            cost_source: "cli",
            ..unpriced_claude_run("cli", tokens)
        },
    );
    insert(
        &conn,
        Row {
            cost_source: "none",
            ..unpriced_claude_run("none", tokens)
        },
    );

    let report = run(&mut conn, home.path(), &claude_list());

    assert_eq!(report.unpriced, 0);
    assert_eq!(cost_of(&conn, "priced").0, Some(1.5));
    assert_eq!(cost_of(&conn, "cli").0, None);
    assert_eq!(cost_of(&conn, "none").0, None);
}

#[test]
fn a_provider_that_no_longer_declares_a_transcript_is_skipped() {
    let home = claude_home();
    let (_dir, mut conn) = project();
    insert(
        &conn,
        Row {
            provider: "gone",
            ..unpriced_claude_run("r1", fixture_tokens(home.path()))
        },
    );

    let report = run(&mut conn, home.path(), &claude_list());

    assert_eq!(report.missing_evidence, 1);
    assert_eq!(cost_of(&conn, "r1").0, None);
}

/// Reprices a copy of a real project's database against this machine's real
/// transcripts; the project itself is never written. Run with
/// `AURIC_REPRICE_PROJECT=/path/to/project cargo test reprices_a_copy -- --ignored --nocapture`.
#[test]
#[ignore]
fn reprices_a_copy_of_a_real_project_against_the_real_transcripts() {
    let source = std::env::var("AURIC_REPRICE_PROJECT").expect("AURIC_REPRICE_PROJECT");
    let copy = tempfile::tempdir().unwrap();
    fs::create_dir_all(copy.path().join(".auric")).unwrap();
    // `VACUUM INTO`, not a file copy: the database runs in WAL mode and the
    // newest rows may still sit in the `-wal` file a plain copy leaves behind.
    let target = copy.path().join(".auric/project.db");
    Connection::open_with_flags(
        Path::new(&source).join(".auric/project.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap()
    .execute("VACUUM INTO ?1", [target.to_str().unwrap()])
    .unwrap();
    let mut conn = crate::agent_usage::store::open_existing(copy.path())
        .unwrap()
        .unwrap();
    let home = dirs::home_dir().expect("a home directory");

    let report = run(&mut conn, &home, &claude_list());

    println!("{report:#?}");
    let accounted =
        report.repriced + report.still_unpriced + report.missing_evidence + report.changed_evidence;
    assert_eq!(accounted, report.unpriced, "every run is accounted for");
}
