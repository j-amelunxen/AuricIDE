//! `pm_agent_usage` in `<project>/.auric/project.db`: append a row, read them
//! back, and read the status a ticket had when a run started.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OpenFlags, Row};

use super::record::{CostSource, MatchKind, Outcome, RunKind, RunSource, UsageRecord};

/// Long enough to wait out the IDE's own write, short enough that a run's end
/// is not held up for long by a locked database.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

pub fn project_db_path(project_path: &Path) -> PathBuf {
    project_path.join(".auric").join("project.db")
}

/// The project's database, only if it already exists: an agent outside an
/// initialised project is not recorded, and recording must never create one.
/// Migrations are run so a database from before the usage table gains it.
pub fn open_existing(project_path: &Path) -> Result<Option<Connection>, String> {
    let path = project_db_path(project_path);
    if !path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| format!("Failed to set the busy timeout: {e}"))?;
    crate::database::run_migrations(&conn)?;
    Ok(Some(conn))
}

pub fn insert(conn: &Connection, row: &UsageRecord) -> Result<(), String> {
    let unpriced = row
        .unpriced_models
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO pm_agent_usage (
            id, agent_id, ticket_id, goal_id, run_kind, run_source, provider, model, headless,
            session_id, ticket_status_at_start, started_at, finished_at, duration_ms, outcome,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
            cost_usd, cost_source, match_kind, estimate_cost_usd, estimate_input_tokens,
            estimate_output_tokens, estimate_cache_read_tokens, estimate_cache_write_tokens,
            unpriced_models, model_usage_json, num_turns
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,
                   ?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31)",
        params![
            row.id,
            row.agent_id,
            row.ticket_id,
            row.goal_id,
            row.run_kind.as_str(),
            row.run_source.as_str(),
            row.provider,
            row.model,
            row.headless,
            row.session_id,
            row.ticket_status_at_start,
            row.started_at,
            row.finished_at,
            row.duration_ms,
            row.outcome.as_str(),
            row.input_tokens,
            row.output_tokens,
            row.cache_read_tokens,
            row.cache_write_tokens,
            row.reasoning_tokens,
            row.cost_usd,
            row.cost_source.as_str(),
            row.match_kind.as_str(),
            row.estimate_cost_usd,
            row.estimate_input_tokens,
            row.estimate_output_tokens,
            row.estimate_cache_read_tokens,
            row.estimate_cache_write_tokens,
            unpriced,
            row.model_usage_json,
            row.num_turns,
        ],
    )
    .map_err(|e| format!("Failed to record agent usage: {e}"))?;
    Ok(())
}

/// Every row, newest run first.
pub fn load(conn: &Connection) -> Result<Vec<UsageRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT * FROM pm_agent_usage ORDER BY started_at DESC, rowid DESC")
        .map_err(|e| format!("Failed to read agent usage: {e}"))?;
    let rows = stmt
        .query_map([], read_row)
        .map_err(|e| format!("Failed to read agent usage: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read agent usage: {e}"))?;
    Ok(rows)
}

fn read_row(row: &Row) -> rusqlite::Result<UsageRecord> {
    let unpriced: Option<String> = row.get("unpriced_models")?;
    let text = |name: &str| row.get::<_, String>(name);
    Ok(UsageRecord {
        id: row.get("id")?,
        agent_id: row.get("agent_id")?,
        ticket_id: row.get("ticket_id")?,
        goal_id: row.get("goal_id")?,
        run_kind: RunKind::parse(&text("run_kind")?).unwrap_or(RunKind::Other),
        run_source: RunSource::parse(&text("run_source")?).unwrap_or(RunSource::Other),
        provider: row.get("provider")?,
        model: row.get("model")?,
        headless: row.get("headless")?,
        session_id: row.get("session_id")?,
        ticket_status_at_start: row.get("ticket_status_at_start")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        duration_ms: row.get("duration_ms")?,
        outcome: Outcome::parse(&text("outcome")?).unwrap_or(Outcome::Error),
        input_tokens: row.get("input_tokens")?,
        output_tokens: row.get("output_tokens")?,
        cache_read_tokens: row.get("cache_read_tokens")?,
        cache_write_tokens: row.get("cache_write_tokens")?,
        reasoning_tokens: row.get("reasoning_tokens")?,
        cost_usd: row.get("cost_usd")?,
        cost_source: CostSource::parse(&text("cost_source")?).unwrap_or(CostSource::None),
        match_kind: MatchKind::parse(&text("match_kind")?).unwrap_or(MatchKind::Exact),
        estimate_cost_usd: row.get("estimate_cost_usd")?,
        estimate_input_tokens: row.get("estimate_input_tokens")?,
        estimate_output_tokens: row.get("estimate_output_tokens")?,
        estimate_cache_read_tokens: row.get("estimate_cache_read_tokens")?,
        estimate_cache_write_tokens: row.get("estimate_cache_write_tokens")?,
        unpriced_models: unpriced.and_then(|json| serde_json::from_str(&json).ok()),
        model_usage_json: row.get("model_usage_json")?,
        num_turns: row.get("num_turns")?,
    })
}

/// The status a ticket has right now, `None` when it does not exist.
pub fn ticket_status(conn: &Connection, ticket_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT status FROM pm_tickets WHERE id = ?1",
        params![ticket_id],
        |row| row.get(0),
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_usage::claude::parse_result;
    use crate::agent_usage::record::{build_record, Evidence, PriceLists, RunEnd, RunFacts};

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        crate::database::init_db(dir.path().to_str().unwrap()).unwrap();
        dir
    }

    fn row(id: &str, started: &str) -> UsageRecord {
        let claude = serde_json::from_str(crate::cc_usage::manifest::BUILT_IN_CLAUDE_CODE).unwrap();
        let codex = serde_json::from_str(crate::agent_usage::CODEX_PRICING).unwrap();
        build_record(
            id.into(),
            &RunFacts {
                agent_id: "agent-1".into(),
                provider: "claude".into(),
                requested_model: "haiku".into(),
                headless: true,
                ticket_id: Some("t1".into()),
                goal_id: Some("g1".into()),
                run_kind: RunKind::Review,
                run_source: RunSource::Conductor,
                session_id: None,
                ticket_status_at_start: Some("in_review".into()),
                started_at: started.parse().unwrap(),
            },
            &RunEnd {
                finished_at: "2026-09-30T12:00:00Z".parse().unwrap(),
                outcome: Outcome::Success,
            },
            &Evidence {
                cli_result: parse_result(include_str!("fixtures/claude-result.json")),
                claude_transcript: Some(
                    [(
                        "claude-haiku-4-5-20251001".to_string(),
                        crate::cc_usage::pricing::TokenCounts {
                            output: 5,
                            ..Default::default()
                        },
                    )]
                    .into(),
                ),
                ..Default::default()
            },
            &PriceLists {
                claude: Some(&claude),
                codex: Some(&codex),
            },
        )
    }

    #[test]
    fn a_row_survives_the_round_trip_field_for_field() {
        let dir = project();
        let conn = open_existing(dir.path()).unwrap().expect("a database");
        let mut original = row("u1", "2026-09-30T10:00:00Z");
        original.unpriced_models = Some(vec!["some-model".into()]);

        insert(&conn, &original).unwrap();

        assert_eq!(load(&conn).unwrap(), vec![original]);
    }

    #[test]
    fn rows_come_back_newest_run_first() {
        let dir = project();
        let conn = open_existing(dir.path()).unwrap().unwrap();
        insert(&conn, &row("old", "2026-09-30T08:00:00Z")).unwrap();
        insert(&conn, &row("new", "2026-09-30T11:00:00Z")).unwrap();
        insert(&conn, &row("mid", "2026-09-30T09:00:00Z")).unwrap();

        let ids: Vec<String> = load(&conn).unwrap().into_iter().map(|r| r.id).collect();

        assert_eq!(ids, ["new", "mid", "old"]);
    }

    #[test]
    fn a_project_without_a_database_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();

        assert!(open_existing(dir.path()).unwrap().is_none());
        assert!(
            !project_db_path(dir.path()).exists(),
            "recording never creates one"
        );
    }

    #[test]
    fn a_database_from_before_the_usage_table_gains_it_on_open() {
        let dir = project();
        {
            let conn = open_existing(dir.path()).unwrap().unwrap();
            conn.execute_batch("DROP TABLE pm_agent_usage; DELETE FROM _migrations WHERE id = 25;")
                .unwrap();
        }

        let conn = open_existing(dir.path()).unwrap().unwrap();

        insert(&conn, &row("u1", "2026-09-30T10:00:00Z")).unwrap();
        assert_eq!(load(&conn).unwrap().len(), 1);
    }

    #[test]
    fn the_same_row_id_cannot_be_recorded_twice() {
        let dir = project();
        let conn = open_existing(dir.path()).unwrap().unwrap();
        insert(&conn, &row("u1", "2026-09-30T10:00:00Z")).unwrap();

        assert!(insert(&conn, &row("u1", "2026-09-30T10:00:00Z")).is_err());
    }

    #[test]
    fn the_ticket_status_is_read_from_the_tickets_table() {
        let dir = project();
        let conn = open_existing(dir.path()).unwrap().unwrap();
        conn.execute_batch(
            "INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic');
             INSERT INTO pm_tickets (id, epic_id, name, status) VALUES ('t1', 'e1', 'T', 'in_review');",
        )
        .unwrap();

        assert_eq!(ticket_status(&conn, "t1").as_deref(), Some("in_review"));
        assert_eq!(ticket_status(&conn, "missing"), None);
    }
}
