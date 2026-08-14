use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub struct DatabaseState {
    pub connections: Mutex<HashMap<String, Connection>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct KvEntry {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmEpic {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmContextItem {
    pub id: String,
    pub r#type: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTicket {
    pub id: String,
    pub epic_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub status_updated_at: String,
    pub sort_order: i32,
    pub working_directory: Option<String>,
    pub context: Option<Vec<PmContextItem>>,
    pub model_power: Option<String>,
    pub priority: String,
    #[serde(default)]
    pub needs_human_supervision: bool,
    #[serde(default)]
    pub goal_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTestCase {
    pub id: String,
    pub ticket_id: String,
    pub title: String,
    pub body: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmDependency {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmStatusHistoryEntry {
    pub id: String,
    pub ticket_id: String,
    pub from_status: Option<String>,
    pub to_status: String,
    pub changed_at: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmSavePayload {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmState {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Blueprint {
    pub id: String,
    pub name: String,
    pub tech_stack: String,
    pub goal: String,
    pub complexity: String,
    pub category: String,
    pub description: String,
    pub spec: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintState {
    pub blueprints: Vec<Blueprint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmRequirement {
    pub id: String,
    pub req_id: String,
    pub title: String,
    pub description: String,
    pub r#type: String,
    pub category: String,
    pub priority: String,
    pub status: String,
    pub rationale: String,
    pub acceptance_criteria: String,
    pub source: String,
    pub applies_to: String,
    pub last_verified_at: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmRequirementTestLink {
    pub id: String,
    pub requirement_id: String,
    pub test_case_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequirementsState {
    pub requirements: Vec<PmRequirement>,
    pub test_links: Vec<PmRequirementTestLink>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoal {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: String,
    pub success_criteria: String,
    pub status: String,
    pub priority: String,
    pub goal_prompt: String,
    pub created_by: String,
    pub achieved_at: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalRun {
    pub id: String,
    pub goal_id: String,
    pub agent_id: String,
    pub ticket_id: Option<String>,
    pub prompt: String,
    pub model: String,
    pub provider: String,
    pub source: String,
    pub outcome: String,
    pub summary: String,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalRequirementLink {
    pub id: String,
    pub goal_id: String,
    pub requirement_id: String,
    pub created_at: String,
}

/// One step of a goal's line. The stored status is only done|planned|fog:
/// "front" is derived by the layout, never persisted, so no writer (UI, MCP,
/// planner commit) has to maintain an exactly-one-front invariant. The
/// `predicate` crosses IPC as a JSON string (the appliesTo pattern).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalStation {
    pub id: String,
    pub goal_id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub evidence_kind: String,
    pub predicate: String,
    pub evidence_note: String,
    #[serde(default = "default_station_source_context")]
    pub source_context: String,
    pub ticket_id: Option<String>,
    pub lane: i32,
    pub sort_order: i32,
    pub last_checked_at: Option<String>,
    pub done_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn default_station_source_context() -> String {
    "null".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalsState {
    pub goals: Vec<PmGoal>,
    pub goal_runs: Vec<PmGoalRun>,
    pub requirement_links: Vec<PmGoalRequirementLink>,
    #[serde(default)]
    pub stations: Vec<PmGoalStation>,
}

/// Row-level sync payload: upserts + explicit deletions. Unlike a replace-all
/// save, rows written concurrently by the MCP server (agent-created goals,
/// runs, links) survive a frontend save untouched.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoalsSyncPayload {
    pub goals: Vec<PmGoal>,
    pub goal_runs: Vec<PmGoalRun>,
    pub requirement_links: Vec<PmGoalRequirementLink>,
    #[serde(default)]
    pub stations: Vec<PmGoalStation>,
    #[serde(default)]
    pub deleted_goal_ids: Vec<String>,
    #[serde(default)]
    pub deleted_run_ids: Vec<String>,
    #[serde(default)]
    pub deleted_link_ids: Vec<String>,
    #[serde(default)]
    pub deleted_station_ids: Vec<String>,
}

/// How many spawn prompts the per-project history retains; older rows are pruned.
pub const AGENT_PROMPT_HISTORY_CAP: usize = 100;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TicketReview {
    pub ticket_id: String,
    pub pass: bool,
    pub reason: String,
    pub reviewer: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptHistoryEntry {
    pub id: String,
    pub prompt: String,
    pub agent_name: String,
    pub model: String,
    pub provider: String,
    pub cwd: Option<String>,
    pub source: String,
    #[serde(default)]
    pub created_at: String,
}

pub fn ensure_auric_dir(project_path: &str) -> Result<PathBuf, String> {
    let auric_dir = Path::new(project_path).join(".auric");
    fs::create_dir_all(&auric_dir).map_err(|e| format!("Failed to create .auric dir: {}", e))?;

    let gitignore_path = auric_dir.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(&gitignore_path, "*\n")
            .map_err(|e| format!("Failed to write .auric/.gitignore: {}", e))?;
    }

    Ok(auric_dir)
}

/// Applies a single migration if it has not already been recorded, then records
/// it. Each migration's SQL runs via `execute_batch`, so multi-statement bodies
/// are supported. Idempotent: a migration whose id is already in `_migrations`
/// is skipped.
pub(crate) fn apply_migration(
    conn: &Connection,
    id: i64,
    name: &str,
    sql: &str,
) -> Result<(), String> {
    let applied: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if applied {
        return Ok(());
    }

    conn.execute_batch(sql)
        .map_err(|e| format!("Failed to apply migration {} ({}): {}", id, name, e))?;

    conn.execute(
        "INSERT INTO _migrations (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| format!("Failed to record migration {}: {}", id, e))?;

    Ok(())
}

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

    apply_migration(
        conn,
        1,
        "create_kv_store",
        "CREATE TABLE kv_store (
            namespace  TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (namespace, key)
        );",
    )?;

    apply_migration(
        conn,
        2,
        "create_pm_tables",
        "CREATE TABLE pm_epics (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE pm_tickets (
            id          TEXT PRIMARY KEY,
            epic_id     TEXT NOT NULL REFERENCES pm_epics(id) ON DELETE CASCADE,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'open',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_tickets_epic ON pm_tickets(epic_id);

        CREATE TABLE pm_test_cases (
            id          TEXT PRIMARY KEY,
            ticket_id   TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL DEFAULT '',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_test_cases_ticket ON pm_test_cases(ticket_id);

        CREATE TABLE pm_dependencies (
            id          TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            source_id   TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id   TEXT NOT NULL,
            UNIQUE(source_id, target_id)
        );
        CREATE INDEX idx_deps_source ON pm_dependencies(source_id);
        CREATE INDEX idx_deps_target ON pm_dependencies(target_id);",
    )?;

    apply_migration(
        conn,
        3,
        "add_ticket_context",
        "ALTER TABLE pm_tickets ADD COLUMN context TEXT NOT NULL DEFAULT '[]';",
    )?;

    apply_migration(
        conn,
        4,
        "add_status_updated_at_working_directory",
        "ALTER TABLE pm_tickets ADD COLUMN status_updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00';
         ALTER TABLE pm_tickets ADD COLUMN working_directory TEXT;",
    )?;

    apply_migration(
        conn,
        5,
        "add_ticket_priority",
        "ALTER TABLE pm_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';",
    )?;

    apply_migration(
        conn,
        6,
        "add_ticket_model_power",
        "ALTER TABLE pm_tickets ADD COLUMN model_power TEXT;",
    )?;

    apply_migration(
        conn,
        7,
        "add_ticket_needs_human_supervision",
        "ALTER TABLE pm_tickets ADD COLUMN needs_human_supervision INTEGER NOT NULL DEFAULT 0;",
    )?;

    apply_migration(
        conn,
        8,
        "create_pm_status_history",
        "CREATE TABLE pm_status_history (
            id TEXT PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT NOT NULL,
            changed_at TEXT NOT NULL DEFAULT (datetime('now')),
            source TEXT NOT NULL DEFAULT 'ui'
        );
        CREATE INDEX idx_status_history_ticket ON pm_status_history(ticket_id);

        -- Backfill creation events
        INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
        SELECT hex(randomblob(16)), id, NULL,
          CASE WHEN status IN ('done','archived','in_progress') THEN 'open' ELSE status END,
          created_at, 'backfill'
        FROM pm_tickets;

        -- Backfill current-status events for non-open tickets
        INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
        SELECT hex(randomblob(16)), id, 'open', status, status_updated_at, 'backfill'
        FROM pm_tickets WHERE status != 'open';",
    )?;

    apply_migration(
        conn,
        9,
        "create_blueprints",
        "CREATE TABLE blueprints (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            tech_stack  TEXT NOT NULL DEFAULT '',
            goal        TEXT NOT NULL DEFAULT '',
            complexity  TEXT NOT NULL DEFAULT 'MEDIUM',
            category    TEXT NOT NULL DEFAULT 'architectures',
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_blueprints_category ON blueprints(category);",
    )?;

    apply_migration(
        conn,
        10,
        "blueprints_add_spec",
        "ALTER TABLE blueprints ADD COLUMN spec TEXT NOT NULL DEFAULT '';",
    )?;

    apply_migration(
        conn,
        11,
        "create_pm_requirements",
        "CREATE TABLE pm_requirements (
            id                  TEXT PRIMARY KEY,
            req_id              TEXT NOT NULL UNIQUE,
            title               TEXT NOT NULL,
            description         TEXT NOT NULL DEFAULT '',
            type                TEXT NOT NULL DEFAULT 'functional',
            category            TEXT NOT NULL DEFAULT '',
            priority            TEXT NOT NULL DEFAULT 'normal',
            status              TEXT NOT NULL DEFAULT 'draft',
            rationale           TEXT NOT NULL DEFAULT '',
            acceptance_criteria TEXT NOT NULL DEFAULT '',
            source              TEXT NOT NULL DEFAULT '',
            sort_order          INTEGER NOT NULL DEFAULT 0,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX idx_pm_requirements_req_id ON pm_requirements(req_id);",
    )?;

    apply_migration(
        conn,
        12,
        "requirements_applies_to_test_links",
        "ALTER TABLE pm_requirements ADD COLUMN applies_to TEXT NOT NULL DEFAULT '[]';
         ALTER TABLE pm_requirements ADD COLUMN last_verified_at TEXT;
         CREATE TABLE pm_requirement_test_links (
             id              TEXT PRIMARY KEY,
             requirement_id  TEXT NOT NULL REFERENCES pm_requirements(id) ON DELETE CASCADE,
             test_case_id    TEXT NOT NULL REFERENCES pm_test_cases(id) ON DELETE CASCADE,
             created_at      TEXT NOT NULL DEFAULT (datetime('now')),
             UNIQUE(requirement_id, test_case_id)
         );
         CREATE INDEX idx_req_test_links_req ON pm_requirement_test_links(requirement_id);
         CREATE INDEX idx_req_test_links_tc ON pm_requirement_test_links(test_case_id);",
    )?;

    apply_migration(
        conn,
        13,
        "create_pm_goals",
        "CREATE TABLE pm_goals (
            id               TEXT PRIMARY KEY,
            parent_id        TEXT REFERENCES pm_goals(id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            success_criteria TEXT NOT NULL DEFAULT '',
            status           TEXT NOT NULL DEFAULT 'draft',
            priority         TEXT NOT NULL DEFAULT 'normal',
            goal_prompt      TEXT NOT NULL DEFAULT '',
            created_by       TEXT NOT NULL DEFAULT 'ui',
            achieved_at      TEXT,
            sort_order       INTEGER NOT NULL DEFAULT 0,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_goals_parent ON pm_goals(parent_id);

        ALTER TABLE pm_tickets ADD COLUMN goal_id TEXT;
        CREATE INDEX idx_tickets_goal ON pm_tickets(goal_id);

        CREATE TABLE pm_goal_runs (
            id          TEXT PRIMARY KEY,
            goal_id     TEXT NOT NULL REFERENCES pm_goals(id) ON DELETE CASCADE,
            agent_id    TEXT NOT NULL DEFAULT '',
            ticket_id   TEXT,
            prompt      TEXT NOT NULL DEFAULT '',
            model       TEXT NOT NULL DEFAULT '',
            provider    TEXT NOT NULL DEFAULT '',
            source      TEXT NOT NULL DEFAULT 'ui',
            outcome     TEXT NOT NULL DEFAULT 'running',
            summary     TEXT NOT NULL DEFAULT '',
            started_at  TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT
        );
        CREATE INDEX idx_goal_runs_goal ON pm_goal_runs(goal_id);

        CREATE TABLE pm_goal_requirement_links (
            id             TEXT PRIMARY KEY,
            goal_id        TEXT NOT NULL REFERENCES pm_goals(id) ON DELETE CASCADE,
            requirement_id TEXT NOT NULL REFERENCES pm_requirements(id) ON DELETE CASCADE,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(goal_id, requirement_id)
        );
        CREATE INDEX idx_goal_req_links_goal ON pm_goal_requirement_links(goal_id);",
    )?;

    apply_migration(
        conn,
        14,
        "create_agent_prompt_history",
        "CREATE TABLE agent_prompt_history (
            id         TEXT PRIMARY KEY,
            prompt     TEXT NOT NULL,
            agent_name TEXT NOT NULL DEFAULT '',
            model      TEXT NOT NULL DEFAULT '',
            provider   TEXT NOT NULL DEFAULT '',
            cwd        TEXT,
            source     TEXT NOT NULL DEFAULT 'ui',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_agent_prompt_history_created ON agent_prompt_history(created_at);",
    )?;

    apply_migration(
        conn,
        15,
        "create_pm_goal_stations",
        // Stations are the steps of a goal's line. `status` stores only
        // done|planned|fog — "front" is derived, so no writer has to maintain
        // an exactly-one-front invariant. `predicate` is JSON-in-TEXT (house
        // pattern, like pm_tickets.context). `lane` is reserved for branch
        // rendering and stays 0 for now.
        "CREATE TABLE pm_goal_stations (
            id              TEXT PRIMARY KEY,
            goal_id         TEXT NOT NULL REFERENCES pm_goals(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            kind            TEXT NOT NULL DEFAULT 'normal',
            status          TEXT NOT NULL DEFAULT 'planned',
            evidence_kind   TEXT NOT NULL DEFAULT 'claim',
            predicate       TEXT NOT NULL DEFAULT '{\"type\":\"undefined\"}',
            evidence_note   TEXT NOT NULL DEFAULT '',
            ticket_id       TEXT REFERENCES pm_tickets(id) ON DELETE SET NULL,
            lane            INTEGER NOT NULL DEFAULT 0,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            last_checked_at TEXT,
            done_at         TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_goal_stations_goal ON pm_goal_stations(goal_id);",
    )?;

    apply_migration(
        conn,
        16,
        "create_pm_ticket_reviews",
        // Keep in sync with src/mcp/db.ts migration 16.
        "CREATE TABLE pm_ticket_reviews (
            id          TEXT PRIMARY KEY,
            ticket_id   TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
            verdict     INTEGER NOT NULL,
            reason      TEXT NOT NULL,
            reviewer    TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_ticket_reviews_ticket ON pm_ticket_reviews(ticket_id);",
    )?;

    apply_migration(
        conn,
        17,
        "add_goal_station_source_context",
        "ALTER TABLE pm_goal_stations ADD COLUMN source_context TEXT NOT NULL DEFAULT 'null';",
    )?;

    Ok(())
}

/// Records the start prompt of a freshly spawned agent. Re-running an identical
/// prompt replaces the previous row (the history is a recency list, not an audit
/// log), and the table is pruned to `AGENT_PROMPT_HISTORY_CAP` newest rows.
/// Blank prompts are silently ignored.
pub fn agent_prompt_history_add_impl(
    conn: &Connection,
    entry: &AgentPromptHistoryEntry,
) -> Result<(), String> {
    if entry.prompt.trim().is_empty() {
        return Ok(());
    }

    conn.execute(
        "DELETE FROM agent_prompt_history WHERE prompt = ?1",
        params![entry.prompt],
    )
    .map_err(|e| format!("Failed to dedupe agent prompt history: {}", e))?;

    conn.execute(
        "INSERT INTO agent_prompt_history (id, prompt, agent_name, model, provider, cwd, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(NULLIF(?8, ''), datetime('now')))",
        params![
            entry.id,
            entry.prompt,
            entry.agent_name,
            entry.model,
            entry.provider,
            entry.cwd,
            entry.source,
            entry.created_at,
        ],
    )
    .map_err(|e| format!("Failed to insert agent prompt history: {}", e))?;

    conn.execute(
        "DELETE FROM agent_prompt_history WHERE id NOT IN (
            SELECT id FROM agent_prompt_history ORDER BY created_at DESC, rowid DESC LIMIT ?1
        )",
        params![AGENT_PROMPT_HISTORY_CAP as i64],
    )
    .map_err(|e| format!("Failed to prune agent prompt history: {}", e))?;

    Ok(())
}

pub fn agent_prompt_history_list_impl(
    conn: &Connection,
    limit: Option<usize>,
) -> Result<Vec<AgentPromptHistoryEntry>, String> {
    let limit = limit.unwrap_or(AGENT_PROMPT_HISTORY_CAP) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt, agent_name, model, provider, cwd, source, created_at
             FROM agent_prompt_history
             ORDER BY created_at DESC, rowid DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Failed to prepare agent prompt history query: {}", e))?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(AgentPromptHistoryEntry {
                id: row.get(0)?,
                prompt: row.get(1)?,
                agent_name: row.get(2)?,
                model: row.get(3)?,
                provider: row.get(4)?,
                cwd: row.get(5)?,
                source: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query agent prompt history: {}", e))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read agent prompt history rows: {}", e))
}

/// Returns the newest review that the conductor or a review agent recorded for `ticket_id`,
/// optionally restricted to reviews created at or after `since_iso`. `None`
/// when no matching row exists — the conductor reads that as "no verdict yet".
pub fn pm_latest_ticket_review_impl(
    conn: &Connection,
    ticket_id: &str,
    since_iso: Option<&str>,
) -> Result<Option<TicketReview>, String> {
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<TicketReview> {
        let verdict: i64 = row.get(1)?;
        Ok(TicketReview {
            ticket_id: row.get(0)?,
            pass: verdict != 0,
            reason: row.get(2)?,
            reviewer: row.get(3)?,
            created_at: row.get(4)?,
        })
    };

    let result = match since_iso {
        Some(since) => conn.query_row(
            "SELECT ticket_id, verdict, reason, reviewer, created_at
             FROM pm_ticket_reviews
             WHERE ticket_id = ?1 AND created_at >= ?2
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1",
            params![ticket_id, since],
            map_row,
        ),
        None => conn.query_row(
            "SELECT ticket_id, verdict, reason, reviewer, created_at
             FROM pm_ticket_reviews
             WHERE ticket_id = ?1
             ORDER BY created_at DESC, rowid DESC
             LIMIT 1",
            params![ticket_id],
            map_row,
        ),
    };

    match result {
        Ok(review) => Ok(Some(review)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query ticket review: {}", e)),
    }
}

pub fn init_db(project_path: &str) -> Result<Connection, String> {
    let auric_dir = ensure_auric_dir(project_path)?;
    let db_path = auric_dir.join("project.db");

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}

pub fn kv_get(conn: &Connection, namespace: &str, key: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
        params![namespace, key],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get key: {}", e)),
    }
}

pub fn kv_set(conn: &Connection, namespace: &str, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv_store (namespace, key, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(namespace, key) DO UPDATE SET value = ?3, updated_at = datetime('now')",
        params![namespace, key, value],
    )
    .map_err(|e| format!("Failed to set key: {}", e))?;

    Ok(())
}

pub fn kv_delete(conn: &Connection, namespace: &str, key: &str) -> Result<bool, String> {
    let changed = conn
        .execute(
            "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
            params![namespace, key],
        )
        .map_err(|e| format!("Failed to delete key: {}", e))?;

    Ok(changed > 0)
}

pub fn kv_list(conn: &Connection, namespace: &str) -> Result<Vec<KvEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT namespace, key, value, updated_at FROM kv_store
             WHERE namespace = ?1 ORDER BY key",
        )
        .map_err(|e| format!("Failed to prepare list query: {}", e))?;

    let entries = stmt
        .query_map(params![namespace], |row| {
            Ok(KvEntry {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to list keys: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

pub fn validate_no_cycles(deps: &[PmDependency]) -> Result<(), String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let mut graph: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut nodes: HashSet<&str> = HashSet::new();

    for dep in deps {
        nodes.insert(&dep.source_id);
        nodes.insert(&dep.target_id);
        graph
            .entry(&dep.source_id)
            .or_default()
            .push(&dep.target_id);
        *in_degree.entry(&dep.target_id).or_insert(0) += 1;
        in_degree.entry(&dep.source_id).or_insert(0);
    }

    let mut queue: VecDeque<&str> = VecDeque::new();
    for node in &nodes {
        if *in_degree.get(node).unwrap_or(&0) == 0 {
            queue.push_back(node);
        }
    }

    let mut visited = 0usize;
    while let Some(node) = queue.pop_front() {
        visited += 1;
        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                let deg = in_degree.get_mut(neighbor).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    if visited != nodes.len() {
        Err("Cycle detected in dependencies".to_string())
    } else {
        Ok(())
    }
}

/// Runs `f` inside a SQLite transaction, committing on success and rolling back
/// on any error. The error from `f` is propagated unchanged.
fn with_transaction<F>(conn: &Connection, f: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    match f() {
        Ok(()) => conn
            .execute_batch("COMMIT;")
            .map_err(|e| format!("Failed to commit transaction: {}", e)),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

pub fn pm_save_impl(conn: &Connection, payload: &PmSavePayload) -> Result<(), String> {
    validate_no_cycles(&payload.dependencies)?;

    with_transaction(conn, || {
        // Read existing ticket statuses before delete for history tracking
        let mut old_statuses: HashMap<String, String> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, status FROM pm_tickets")
                .map_err(|e| format!("Failed to read old statuses: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed to query old statuses: {}", e))?;
            for (id, status) in rows.flatten() {
                old_statuses.insert(id, status);
            }
        }

        conn.execute_batch(
            "DELETE FROM pm_dependencies;
             DELETE FROM pm_test_cases;
             DELETE FROM pm_tickets;
             DELETE FROM pm_epics;",
        )
        .map_err(|e| format!("Failed to clear PM tables: {}", e))?;

        for epic in &payload.epics {
            conn.execute(
                "INSERT INTO pm_epics (id, name, description, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    epic.id,
                    epic.name,
                    epic.description,
                    epic.sort_order,
                    epic.created_at,
                    epic.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert epic: {}", e))?;
        }

        for ticket in &payload.tickets {
            let context_json = serde_json::to_string(&ticket.context.as_ref().unwrap_or(&vec![]))
                .map_err(|e| format!("Failed to serialize context: {}", e))?;

            conn.execute(
                "INSERT INTO pm_tickets (id, epic_id, name, description, status, \
                 status_updated_at, sort_order, working_directory, context, model_power, priority, \
                 needs_human_supervision, goal_id, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    ticket.id,
                    ticket.epic_id,
                    ticket.name,
                    ticket.description,
                    ticket.status,
                    ticket.status_updated_at,
                    ticket.sort_order,
                    ticket.working_directory,
                    context_json,
                    ticket.model_power,
                    ticket.priority,
                    ticket.needs_human_supervision,
                    ticket.goal_id,
                    ticket.created_at,
                    ticket.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert ticket: {}", e))?;
        }

        // Insert status history entries for changed or new tickets
        for ticket in &payload.tickets {
            match old_statuses.get(&ticket.id) {
                Some(old_status) if old_status != &ticket.status => {
                    // Status changed
                    conn.execute(
                        "INSERT INTO pm_status_history \
                         (id, ticket_id, from_status, to_status, changed_at, source) \
                         VALUES (hex(randomblob(16)), ?1, ?2, ?3, datetime('now'), 'ui')",
                        params![ticket.id, old_status, ticket.status],
                    )
                    .map_err(|e| format!("Failed to insert status history: {}", e))?;
                }
                None => {
                    // New ticket
                    conn.execute(
                        "INSERT INTO pm_status_history \
                         (id, ticket_id, from_status, to_status, changed_at, source) \
                         VALUES (hex(randomblob(16)), ?1, NULL, ?2, datetime('now'), 'ui')",
                        params![ticket.id, ticket.status],
                    )
                    .map_err(|e| format!("Failed to insert status history: {}", e))?;
                }
                _ => {} // No change
            }
        }

        for tc in &payload.test_cases {
            conn.execute(
                "INSERT INTO pm_test_cases (id, ticket_id, title, body, sort_order, created_at, \
                 updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    tc.id,
                    tc.ticket_id,
                    tc.title,
                    tc.body,
                    tc.sort_order,
                    tc.created_at,
                    tc.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert test case: {}", e))?;
        }

        for dep in &payload.dependencies {
            conn.execute(
                "INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    dep.id,
                    dep.source_type,
                    dep.source_id,
                    dep.target_type,
                    dep.target_id
                ],
            )
            .map_err(|e| format!("Failed to insert dependency: {}", e))?;
        }

        Ok(())
    })
}

pub fn pm_load_impl(conn: &Connection) -> Result<PmState, String> {
    let mut epic_stmt = conn
        .prepare(
            "SELECT id, name, description, sort_order, created_at, updated_at FROM pm_epics \
             ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare epics query: {}", e))?;
    let epics: Vec<PmEpic> = epic_stmt
        .query_map([], |row| {
            Ok(PmEpic {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query epics: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut ticket_stmt = conn
        .prepare(
            "SELECT id, epic_id, name, description, status, status_updated_at, sort_order, \
             working_directory, context, model_power, priority, needs_human_supervision, \
             goal_id, created_at, updated_at FROM pm_tickets ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare tickets query: {}", e))?;
    let tickets: Vec<PmTicket> = ticket_stmt
        .query_map([], |row| {
            let context_json: String = row.get(8)?;
            let context: Vec<PmContextItem> = serde_json::from_str(&context_json).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;

            Ok(PmTicket {
                id: row.get(0)?,
                epic_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                status_updated_at: row.get(5)?,
                sort_order: row.get(6)?,
                working_directory: row.get(7)?,
                context: Some(context),
                model_power: row.get(9)?,
                priority: row.get(10)?,
                needs_human_supervision: row.get(11)?,
                goal_id: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .map_err(|e| format!("Failed to query tickets: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut tc_stmt = conn
        .prepare(
            "SELECT id, ticket_id, title, body, sort_order, created_at, updated_at \
             FROM pm_test_cases ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare test_cases query: {}", e))?;
    let test_cases: Vec<PmTestCase> = tc_stmt
        .query_map([], |row| {
            Ok(PmTestCase {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query test_cases: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut dep_stmt = conn
        .prepare("SELECT id, source_type, source_id, target_type, target_id FROM pm_dependencies")
        .map_err(|e| format!("Failed to prepare dependencies query: {}", e))?;
    let dependencies: Vec<PmDependency> = dep_stmt
        .query_map([], |row| {
            Ok(PmDependency {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_id: row.get(2)?,
                target_type: row.get(3)?,
                target_id: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query dependencies: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(PmState {
        epics,
        tickets,
        test_cases,
        dependencies,
    })
}

pub fn pm_load_history_impl(conn: &Connection) -> Result<Vec<PmStatusHistoryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, ticket_id, from_status, to_status, changed_at, source \
             FROM pm_status_history ORDER BY changed_at ASC",
        )
        .map_err(|e| format!("Failed to prepare history query: {}", e))?;
    let entries = stmt
        .query_map([], |row| {
            Ok(PmStatusHistoryEntry {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                from_status: row.get(2)?,
                to_status: row.get(3)?,
                changed_at: row.get(4)?,
                source: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query history: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

pub fn pm_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_status_history;
         DELETE FROM pm_dependencies;
         DELETE FROM pm_test_cases;
         DELETE FROM pm_tickets;
         DELETE FROM pm_epics;",
    )
    .map_err(|e| format!("Failed to clear PM tables: {}", e))
}

pub fn blueprints_save_impl(conn: &Connection, payload: &BlueprintState) -> Result<(), String> {
    with_transaction(conn, || {
        conn.execute("DELETE FROM blueprints", [])
            .map_err(|e| format!("Failed to clear blueprints: {}", e))?;

        for bp in &payload.blueprints {
            conn.execute(
                "INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description, spec, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    bp.id,
                    bp.name,
                    bp.tech_stack,
                    bp.goal,
                    bp.complexity,
                    bp.category,
                    bp.description,
                    bp.spec,
                    bp.created_at,
                    bp.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert blueprint: {}", e))?;
        }

        Ok(())
    })
}

pub fn blueprints_load_impl(conn: &Connection) -> Result<BlueprintState, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, tech_stack, goal, complexity, category, description, spec, created_at, updated_at \
             FROM blueprints ORDER BY category, name",
        )
        .map_err(|e| format!("Failed to prepare blueprints query: {}", e))?;
    let blueprints: Vec<Blueprint> = stmt
        .query_map([], |row| {
            Ok(Blueprint {
                id: row.get(0)?,
                name: row.get(1)?,
                tech_stack: row.get(2)?,
                goal: row.get(3)?,
                complexity: row.get(4)?,
                category: row.get(5)?,
                description: row.get(6)?,
                spec: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed to query blueprints: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(BlueprintState { blueprints })
}

pub fn blueprints_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM blueprints", [])
        .map_err(|e| format!("Failed to clear blueprints: {}", e))?;
    Ok(())
}

pub fn requirements_save_impl(
    conn: &Connection,
    payload: &RequirementsState,
) -> Result<(), String> {
    with_transaction(conn, || {
        conn.execute("DELETE FROM pm_requirements", [])
            .map_err(|e| format!("Failed to clear requirements: {}", e))?;

        for req in &payload.requirements {
            conn.execute(
                "INSERT INTO pm_requirements (id, req_id, title, description, type, category, priority, status, rationale, acceptance_criteria, source, applies_to, last_verified_at, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    req.id,
                    req.req_id,
                    req.title,
                    req.description,
                    req.r#type,
                    req.category,
                    req.priority,
                    req.status,
                    req.rationale,
                    req.acceptance_criteria,
                    req.source,
                    req.applies_to,
                    req.last_verified_at,
                    req.sort_order,
                    req.created_at,
                    req.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert requirement: {}", e))?;
        }

        for link in &payload.test_links {
            conn.execute(
                "INSERT INTO pm_requirement_test_links (id, requirement_id, test_case_id, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![link.id, link.requirement_id, link.test_case_id, link.created_at],
            )
            .map_err(|e| format!("Failed to insert requirement test link: {}", e))?;
        }

        Ok(())
    })
}

pub fn requirements_load_impl(conn: &Connection) -> Result<RequirementsState, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, req_id, title, description, type, category, priority, status, rationale, acceptance_criteria, source, applies_to, last_verified_at, sort_order, created_at, updated_at \
             FROM pm_requirements ORDER BY sort_order, req_id",
        )
        .map_err(|e| format!("Failed to prepare requirements query: {}", e))?;
    let requirements: Vec<PmRequirement> = stmt
        .query_map([], |row| {
            Ok(PmRequirement {
                id: row.get(0)?,
                req_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                r#type: row.get(4)?,
                category: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                rationale: row.get(8)?,
                acceptance_criteria: row.get(9)?,
                source: row.get(10)?,
                applies_to: row.get(11)?,
                last_verified_at: row.get(12)?,
                sort_order: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("Failed to query requirements: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut link_stmt = conn
        .prepare(
            "SELECT id, requirement_id, test_case_id, created_at \
             FROM pm_requirement_test_links ORDER BY created_at",
        )
        .map_err(|e| format!("Failed to prepare test links query: {}", e))?;
    let test_links: Vec<PmRequirementTestLink> = link_stmt
        .query_map([], |row| {
            Ok(PmRequirementTestLink {
                id: row.get(0)?,
                requirement_id: row.get(1)?,
                test_case_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query test links: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(RequirementsState {
        requirements,
        test_links,
    })
}

pub fn requirements_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_requirement_test_links;
         DELETE FROM pm_requirements;",
    )
    .map_err(|e| format!("Failed to clear requirements: {}", e))?;
    Ok(())
}

/// Row-level goals sync: upserts every row in the payload and deletes only the
/// explicitly listed ids. Rows created concurrently by the MCP subprocess are
/// never touched — the frontend draft is NOT the source of truth for rows it
/// has never seen.
pub fn goals_sync_impl(conn: &Connection, payload: &GoalsSyncPayload) -> Result<(), String> {
    with_transaction(conn, || {
        // Goals may arrive in any order; defer FK checks so a child can be
        // upserted before its parent within the transaction.
        conn.execute_batch("PRAGMA defer_foreign_keys = ON;")
            .map_err(|e| format!("Failed to defer foreign keys: {}", e))?;

        for id in &payload.deleted_goal_ids {
            // Cascades to child goals, runs, and requirement links
            conn.execute("DELETE FROM pm_goals WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal: {}", e))?;
        }
        for id in &payload.deleted_run_ids {
            conn.execute("DELETE FROM pm_goal_runs WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal run: {}", e))?;
        }
        for id in &payload.deleted_link_ids {
            conn.execute(
                "DELETE FROM pm_goal_requirement_links WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("Failed to delete goal requirement link: {}", e))?;
        }
        for id in &payload.deleted_station_ids {
            conn.execute("DELETE FROM pm_goal_stations WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal station: {}", e))?;
        }

        for goal in &payload.goals {
            conn.execute(
                "INSERT INTO pm_goals (id, parent_id, name, description, success_criteria, \
                 status, priority, goal_prompt, created_by, achieved_at, sort_order, \
                 created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) \
                 ON CONFLICT(id) DO UPDATE SET \
                 parent_id = excluded.parent_id, name = excluded.name, \
                 description = excluded.description, \
                 success_criteria = excluded.success_criteria, status = excluded.status, \
                 priority = excluded.priority, goal_prompt = excluded.goal_prompt, \
                 created_by = excluded.created_by, achieved_at = excluded.achieved_at, \
                 sort_order = excluded.sort_order, updated_at = excluded.updated_at",
                params![
                    goal.id,
                    goal.parent_id,
                    goal.name,
                    goal.description,
                    goal.success_criteria,
                    goal.status,
                    goal.priority,
                    goal.goal_prompt,
                    goal.created_by,
                    goal.achieved_at,
                    goal.sort_order,
                    goal.created_at,
                    goal.updated_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal: {}", e))?;
        }

        for run in &payload.goal_runs {
            conn.execute(
                "INSERT INTO pm_goal_runs (id, goal_id, agent_id, ticket_id, prompt, model, \
                 provider, source, outcome, summary, started_at, finished_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
                 ON CONFLICT(id) DO UPDATE SET \
                 goal_id = excluded.goal_id, agent_id = excluded.agent_id, \
                 ticket_id = excluded.ticket_id, prompt = excluded.prompt, \
                 model = excluded.model, provider = excluded.provider, \
                 source = excluded.source, outcome = excluded.outcome, \
                 summary = excluded.summary, finished_at = excluded.finished_at",
                params![
                    run.id,
                    run.goal_id,
                    run.agent_id,
                    run.ticket_id,
                    run.prompt,
                    run.model,
                    run.provider,
                    run.source,
                    run.outcome,
                    run.summary,
                    run.started_at,
                    run.finished_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal run: {}", e))?;
        }

        for link in &payload.requirement_links {
            conn.execute(
                "INSERT INTO pm_goal_requirement_links (id, goal_id, requirement_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(id) DO NOTHING",
                params![link.id, link.goal_id, link.requirement_id, link.created_at],
            )
            .map_err(|e| format!("Failed to upsert goal requirement link: {}", e))?;
        }

        for station in &payload.stations {
            conn.execute(
                "INSERT INTO pm_goal_stations (id, goal_id, name, kind, status, \
                 evidence_kind, predicate, evidence_note, source_context, ticket_id, lane, sort_order, \
                 last_checked_at, done_at, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) \
                 ON CONFLICT(id) DO UPDATE SET \
                 goal_id = excluded.goal_id, name = excluded.name, kind = excluded.kind, \
                 status = excluded.status, evidence_kind = excluded.evidence_kind, \
                 predicate = excluded.predicate, evidence_note = excluded.evidence_note, \
                 source_context = excluded.source_context, \
                 ticket_id = excluded.ticket_id, lane = excluded.lane, \
                 sort_order = excluded.sort_order, \
                 last_checked_at = excluded.last_checked_at, done_at = excluded.done_at, \
                 updated_at = excluded.updated_at",
                params![
                    station.id,
                    station.goal_id,
                    station.name,
                    station.kind,
                    station.status,
                    station.evidence_kind,
                    station.predicate,
                    station.evidence_note,
                    station.source_context,
                    station.ticket_id,
                    station.lane,
                    station.sort_order,
                    station.last_checked_at,
                    station.done_at,
                    station.created_at,
                    station.updated_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal station: {}", e))?;
        }

        Ok(())
    })
}

pub fn goals_load_impl(conn: &Connection) -> Result<GoalsState, String> {
    let mut goal_stmt = conn
        .prepare(
            "SELECT id, parent_id, name, description, success_criteria, status, priority, \
             goal_prompt, created_by, achieved_at, sort_order, created_at, updated_at \
             FROM pm_goals ORDER BY sort_order, created_at",
        )
        .map_err(|e| format!("Failed to prepare goals query: {}", e))?;
    let goals: Vec<PmGoal> = goal_stmt
        .query_map([], |row| {
            Ok(PmGoal {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                success_criteria: row.get(4)?,
                status: row.get(5)?,
                priority: row.get(6)?,
                goal_prompt: row.get(7)?,
                created_by: row.get(8)?,
                achieved_at: row.get(9)?,
                sort_order: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|e| format!("Failed to query goals: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut run_stmt = conn
        .prepare(
            "SELECT id, goal_id, agent_id, ticket_id, prompt, model, provider, source, \
             outcome, summary, started_at, finished_at \
             FROM pm_goal_runs ORDER BY started_at",
        )
        .map_err(|e| format!("Failed to prepare goal runs query: {}", e))?;
    let goal_runs: Vec<PmGoalRun> = run_stmt
        .query_map([], |row| {
            Ok(PmGoalRun {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                agent_id: row.get(2)?,
                ticket_id: row.get(3)?,
                prompt: row.get(4)?,
                model: row.get(5)?,
                provider: row.get(6)?,
                source: row.get(7)?,
                outcome: row.get(8)?,
                summary: row.get(9)?,
                started_at: row.get(10)?,
                finished_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query goal runs: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut link_stmt = conn
        .prepare(
            "SELECT id, goal_id, requirement_id, created_at \
             FROM pm_goal_requirement_links ORDER BY created_at",
        )
        .map_err(|e| format!("Failed to prepare goal requirement links query: {}", e))?;
    let requirement_links: Vec<PmGoalRequirementLink> = link_stmt
        .query_map([], |row| {
            Ok(PmGoalRequirementLink {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                requirement_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query goal requirement links: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut station_stmt = conn
        .prepare(
            "SELECT id, goal_id, name, kind, status, evidence_kind, predicate, \
             evidence_note, source_context, ticket_id, lane, sort_order, last_checked_at, done_at, \
             created_at, updated_at \
             FROM pm_goal_stations ORDER BY goal_id, sort_order, created_at",
        )
        .map_err(|e| format!("Failed to prepare goal stations query: {}", e))?;
    let stations: Vec<PmGoalStation> = station_stmt
        .query_map([], |row| {
            Ok(PmGoalStation {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                status: row.get(4)?,
                evidence_kind: row.get(5)?,
                predicate: row.get(6)?,
                evidence_note: row.get(7)?,
                source_context: row.get(8)?,
                ticket_id: row.get(9)?,
                lane: row.get(10)?,
                sort_order: row.get(11)?,
                last_checked_at: row.get(12)?,
                done_at: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("Failed to query goal stations: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GoalsState {
        goals,
        goal_runs,
        requirement_links,
        stations,
    })
}

pub fn goals_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_goal_stations;
         DELETE FROM pm_goal_requirement_links;
         DELETE FROM pm_goal_runs;
         DELETE FROM pm_goals;",
    )
    .map_err(|e| format!("Failed to clear goals: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn test_ensure_auric_dir_creates_directory_and_gitignore() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_str().unwrap();

        let auric_dir = ensure_auric_dir(project_path).unwrap();

        assert!(auric_dir.exists());
        assert!(auric_dir.is_dir());

        let gitignore = auric_dir.join(".gitignore");
        assert!(gitignore.exists());
        assert_eq!(fs::read_to_string(gitignore).unwrap(), "*\n");
    }

    #[test]
    fn test_ensure_auric_dir_idempotent() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_str().unwrap();

        ensure_auric_dir(project_path).unwrap();
        ensure_auric_dir(project_path).unwrap();

        let gitignore = dir.path().join(".auric/.gitignore");
        assert_eq!(fs::read_to_string(gitignore).unwrap(), "*\n");
    }

    #[test]
    fn test_run_migrations_creates_tables() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // _migrations table should exist with entries
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 17);

        // kv_store table should exist
        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='kv_store'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(table_exists);
    }

    #[test]
    fn test_run_migrations_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 17);
    }

    #[test]
    fn test_init_db_creates_db_file() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_str().unwrap();

        let conn = init_db(project_path).unwrap();

        // DB file should exist
        let db_path = dir.path().join(".auric/project.db");
        assert!(db_path.exists());

        // Tables should be created
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 17);
    }

    #[test]
    fn test_kv_set_and_get() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, Some("dark".to_string()));
    }

    #[test]
    fn test_kv_get_missing_key_returns_none() {
        let conn = setup_in_memory_db();

        let value = kv_get(&conn, "settings", "nonexistent").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn test_kv_set_upserts() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "theme", "light").unwrap();

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, Some("light".to_string()));
    }

    #[test]
    fn test_kv_delete_existing_key() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        let deleted = kv_delete(&conn, "settings", "theme").unwrap();
        assert!(deleted);

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn test_kv_delete_missing_key_returns_false() {
        let conn = setup_in_memory_db();

        let deleted = kv_delete(&conn, "settings", "nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_kv_list_returns_entries_for_namespace() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "font", "mono").unwrap();
        kv_set(&conn, "other", "key", "val").unwrap();

        let entries = kv_list(&conn, "settings").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "font"); // alphabetical
        assert_eq!(entries[1].key, "theme");
    }

    #[test]
    fn test_kv_list_empty_namespace() {
        let conn = setup_in_memory_db();

        let entries = kv_list(&conn, "empty").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_kv_namespaces_are_isolated() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "ns1", "key", "value1").unwrap();
        kv_set(&conn, "ns2", "key", "value2").unwrap();

        assert_eq!(
            kv_get(&conn, "ns1", "key").unwrap(),
            Some("value1".to_string())
        );
        assert_eq!(
            kv_get(&conn, "ns2", "key").unwrap(),
            Some("value2".to_string())
        );
    }

    #[test]
    fn test_pm_migration_creates_tables() {
        let conn = setup_in_memory_db();

        let tables = [
            "pm_epics",
            "pm_tickets",
            "pm_test_cases",
            "pm_dependencies",
            "pm_status_history",
            "blueprints",
            "pm_requirements",
            "pm_requirement_test_links",
            "pm_goals",
            "pm_goal_runs",
            "pm_goal_requirement_links",
            "pm_goal_stations",
            "pm_ticket_reviews",
        ];
        for table in &tables {
            let exists: bool = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                        table
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "Table {} should exist", table);
        }

        let migration_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(migration_count, 17);
    }

    fn make_test_payload() -> PmSavePayload {
        PmSavePayload {
            epics: vec![PmEpic {
                id: "e1".to_string(),
                name: "Epic One".to_string(),
                description: "First epic".to_string(),
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            tickets: vec![PmTicket {
                id: "t1".to_string(),
                epic_id: "e1".to_string(),
                name: "Ticket One".to_string(),
                description: "First ticket".to_string(),
                status: "open".to_string(),
                status_updated_at: "2026-01-01 00:00:00".to_string(),
                sort_order: 0,
                working_directory: Some("/tmp".to_string()),
                context: Some(vec![PmContextItem {
                    id: "c1".to_string(),
                    r#type: "snippet".to_string(),
                    value: "some context".to_string(),
                }]),
                model_power: Some("high".to_string()),
                priority: "normal".to_string(),
                needs_human_supervision: false,
                goal_id: None,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_cases: vec![PmTestCase {
                id: "tc1".to_string(),
                ticket_id: "t1".to_string(),
                title: "Test Case One".to_string(),
                body: "Test body".to_string(),
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            dependencies: vec![PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "t1".to_string(),
                target_type: "ticket".to_string(),
                target_id: "t2".to_string(),
            }],
        }
    }

    #[test]
    fn test_pm_save_and_load_roundtrip() {
        let conn = setup_in_memory_db();
        let payload = make_test_payload();

        pm_save_impl(&conn, &payload).unwrap();
        let state = pm_load_impl(&conn).unwrap();

        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.epics[0].id, "e1");
        assert_eq!(state.epics[0].name, "Epic One");

        assert_eq!(state.tickets.len(), 1);
        assert_eq!(state.tickets[0].id, "t1");
        assert_eq!(state.tickets[0].epic_id, "e1");
        assert_eq!(state.tickets[0].context.as_ref().unwrap().len(), 1);
        assert_eq!(
            state.tickets[0].context.as_ref().unwrap()[0].value,
            "some context"
        );
        assert_eq!(state.tickets[0].model_power, Some("high".to_string()));

        assert_eq!(state.test_cases.len(), 1);
        assert_eq!(state.test_cases[0].id, "tc1");
        assert_eq!(state.test_cases[0].ticket_id, "t1");

        assert_eq!(state.dependencies.len(), 1);
        assert_eq!(state.dependencies[0].source_id, "t1");
        assert_eq!(state.dependencies[0].target_id, "t2");
    }

    #[test]
    fn test_pm_save_replaces_existing() {
        let conn = setup_in_memory_db();

        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        let payload2 = PmSavePayload {
            epics: vec![PmEpic {
                id: "e2".to_string(),
                name: "Epic Two".to_string(),
                description: "Second epic".to_string(),
                sort_order: 0,
                created_at: "2026-02-01 00:00:00".to_string(),
                updated_at: "2026-02-01 00:00:00".to_string(),
            }],
            tickets: vec![],
            test_cases: vec![],
            dependencies: vec![],
        };
        pm_save_impl(&conn, &payload2).unwrap();

        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.epics[0].id, "e2");
        assert_eq!(state.tickets.len(), 0);
        assert_eq!(state.test_cases.len(), 0);
        assert_eq!(state.dependencies.len(), 0);
    }

    #[test]
    fn test_pm_clear_empties_tables() {
        let conn = setup_in_memory_db();
        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        // Verify not empty
        let state_before = pm_load_impl(&conn).unwrap();
        assert!(!state_before.epics.is_empty());

        pm_clear_impl(&conn).unwrap();

        let state_after = pm_load_impl(&conn).unwrap();
        assert_eq!(state_after.epics.len(), 0);
        assert_eq!(state_after.tickets.len(), 0);
        assert_eq!(state_after.test_cases.len(), 0);
        assert_eq!(state_after.dependencies.len(), 0);
    }

    #[test]
    fn test_validate_no_cycles_ok() {
        let deps = vec![
            PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "a".to_string(),
                target_type: "ticket".to_string(),
                target_id: "b".to_string(),
            },
            PmDependency {
                id: "d2".to_string(),
                source_type: "ticket".to_string(),
                source_id: "b".to_string(),
                target_type: "ticket".to_string(),
                target_id: "c".to_string(),
            },
        ];
        assert!(validate_no_cycles(&deps).is_ok());
    }

    #[test]
    fn test_export_import_roundtrip_preserves_data() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_str().unwrap();

        // 1. Initialize DB and add data
        let conn = init_db(project_path).unwrap();
        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "font", "mono").unwrap();
        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        // Verify data exists before export
        assert_eq!(
            kv_get(&conn, "settings", "theme").unwrap(),
            Some("dark".to_string())
        );
        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.tickets.len(), 1);
        assert_eq!(state.test_cases.len(), 1);
        assert_eq!(state.dependencies.len(), 1);

        // 2. Export: checkpoint WAL and copy DB file (mirrors db_export)
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        let db_path = dir.path().join(".auric/project.db");
        let export_path = dir.path().join("backup.db");
        fs::copy(&db_path, &export_path).unwrap();

        // 3. Import: close connection, delete files, copy, re-init (mirrors db_import)
        drop(conn);
        let _ = fs::remove_file(dir.path().join(".auric/project.db-wal"));
        let _ = fs::remove_file(dir.path().join(".auric/project.db-shm"));
        fs::remove_file(&db_path).unwrap();
        fs::copy(&export_path, &db_path).unwrap();
        let conn = init_db(project_path).unwrap();

        // 4. Verify ALL data survived the roundtrip
        let theme = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(theme, Some("dark".to_string()), "KV data lost after import");

        let font = kv_get(&conn, "settings", "font").unwrap();
        assert_eq!(font, Some("mono".to_string()), "KV data lost after import");

        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1, "Epics lost after import");
        assert_eq!(state.epics[0].id, "e1");
        assert_eq!(state.tickets.len(), 1, "Tickets lost after import");
        assert_eq!(state.tickets[0].id, "t1");
        assert_eq!(state.test_cases.len(), 1, "Test cases lost after import");
        assert_eq!(
            state.dependencies.len(),
            1,
            "Dependencies lost after import"
        );
    }

    #[test]
    fn test_migration_8_creates_status_history_table() {
        let conn = setup_in_memory_db();

        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' \
                 AND name='pm_status_history'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists, "pm_status_history table should exist");
    }

    #[test]
    fn test_pm_save_detects_status_change_inserts_history() {
        let conn = setup_in_memory_db();

        // First save: ticket with status "open"
        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        // Second save: same ticket with status "in_progress"
        let mut payload2 = make_test_payload();
        payload2.tickets[0].status = "in_progress".to_string();
        pm_save_impl(&conn, &payload2).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        // Should have: creation event from first save + change event from second save
        assert!(
            history.len() >= 2,
            "Expected at least 2 history entries, got {}",
            history.len()
        );

        // Find the status change entry
        let change = history
            .iter()
            .find(|h| h.from_status.as_deref() == Some("open") && h.to_status == "in_progress");
        assert!(
            change.is_some(),
            "Should have a status change from open to in_progress"
        );
    }

    #[test]
    fn test_pm_save_detects_new_ticket_inserts_creation_event() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            !history.is_empty(),
            "Should have at least one history entry"
        );

        // The creation event should have no from_status
        let creation = history
            .iter()
            .find(|h| h.ticket_id == "t1" && h.from_status.is_none());
        assert!(creation.is_some(), "Should have a creation event for t1");
        assert_eq!(creation.unwrap().to_status, "open");
        assert_eq!(creation.unwrap().source, "ui");
    }

    #[test]
    fn test_pm_save_no_history_when_status_unchanged() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history_after_first = pm_load_history_impl(&conn).unwrap();
        let count_after_first = history_after_first.len();

        // Save again with no status change
        pm_save_impl(&conn, &payload).unwrap();

        let history_after_second = pm_load_history_impl(&conn).unwrap();
        assert_eq!(
            history_after_second.len(),
            count_after_first,
            "No new history entries should be created when status is unchanged"
        );
    }

    #[test]
    fn test_pm_load_history_returns_ordered_entries() {
        let conn = setup_in_memory_db();

        // Save with open status
        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        // Change to in_progress
        let mut payload2 = make_test_payload();
        payload2.tickets[0].status = "in_progress".to_string();
        pm_save_impl(&conn, &payload2).unwrap();

        // Change to done
        let mut payload3 = make_test_payload();
        payload3.tickets[0].status = "done".to_string();
        pm_save_impl(&conn, &payload3).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            history.len() >= 3,
            "Expected at least 3 history entries, got {}",
            history.len()
        );

        // Verify ordering by changed_at ASC
        for i in 1..history.len() {
            assert!(
                history[i].changed_at >= history[i - 1].changed_at,
                "History should be ordered by changed_at ASC"
            );
        }
    }

    #[test]
    fn test_pm_clear_clears_history() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            !history.is_empty(),
            "Should have history entries before clear"
        );

        pm_clear_impl(&conn).unwrap();

        let history_after = pm_load_history_impl(&conn).unwrap();
        assert!(
            history_after.is_empty(),
            "History should be empty after clear"
        );
    }

    #[test]
    fn test_validate_no_cycles_detects_cycle() {
        let deps = vec![
            PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "a".to_string(),
                target_type: "ticket".to_string(),
                target_id: "b".to_string(),
            },
            PmDependency {
                id: "d2".to_string(),
                source_type: "ticket".to_string(),
                source_id: "b".to_string(),
                target_type: "ticket".to_string(),
                target_id: "a".to_string(),
            },
        ];
        let result = validate_no_cycles(&deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cycle"));
    }

    #[test]
    fn test_requirements_save_and_load_roundtrip() {
        let conn = setup_in_memory_db();
        let payload = RequirementsState {
            requirements: vec![PmRequirement {
                id: "r1".to_string(),
                req_id: "REQ-AUTH-01".to_string(),
                title: "User Login".to_string(),
                description: "Users must be able to log in".to_string(),
                r#type: "functional".to_string(),
                category: "auth".to_string(),
                priority: "high".to_string(),
                status: "draft".to_string(),
                rationale: "Core feature".to_string(),
                acceptance_criteria: "- Can log in with email".to_string(),
                source: "spec.md".to_string(),
                applies_to: "[]".to_string(),
                last_verified_at: None,
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_links: vec![],
        };

        requirements_save_impl(&conn, &payload).unwrap();
        let state = requirements_load_impl(&conn).unwrap();

        assert_eq!(state.requirements.len(), 1);
        assert_eq!(state.requirements[0].id, "r1");
        assert_eq!(state.requirements[0].req_id, "REQ-AUTH-01");
        assert_eq!(state.requirements[0].title, "User Login");
        assert_eq!(state.requirements[0].r#type, "functional");
        assert_eq!(state.requirements[0].category, "auth");
        assert_eq!(state.test_links.len(), 0);
    }

    #[test]
    fn test_requirements_clear() {
        let conn = setup_in_memory_db();
        let payload = RequirementsState {
            requirements: vec![PmRequirement {
                id: "r1".to_string(),
                req_id: "REQ-01".to_string(),
                title: "Test".to_string(),
                description: "".to_string(),
                r#type: "functional".to_string(),
                category: "".to_string(),
                priority: "normal".to_string(),
                status: "draft".to_string(),
                rationale: "".to_string(),
                acceptance_criteria: "".to_string(),
                source: "".to_string(),
                applies_to: "[]".to_string(),
                last_verified_at: None,
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &payload).unwrap();
        requirements_clear_impl(&conn).unwrap();
        let state = requirements_load_impl(&conn).unwrap();
        assert_eq!(state.requirements.len(), 0);
        assert_eq!(state.test_links.len(), 0);
    }

    #[test]
    fn test_requirements_save_replaces_existing() {
        let conn = setup_in_memory_db();
        let payload1 = RequirementsState {
            requirements: vec![PmRequirement {
                id: "r1".to_string(),
                req_id: "REQ-01".to_string(),
                title: "Old".to_string(),
                description: "".to_string(),
                r#type: "functional".to_string(),
                category: "".to_string(),
                priority: "normal".to_string(),
                status: "draft".to_string(),
                rationale: "".to_string(),
                acceptance_criteria: "".to_string(),
                source: "".to_string(),
                applies_to: "[]".to_string(),
                last_verified_at: None,
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &payload1).unwrap();

        let payload2 = RequirementsState {
            requirements: vec![PmRequirement {
                id: "r2".to_string(),
                req_id: "REQ-02".to_string(),
                title: "New".to_string(),
                description: "".to_string(),
                r#type: "non_functional".to_string(),
                category: "perf".to_string(),
                priority: "critical".to_string(),
                status: "active".to_string(),
                rationale: "".to_string(),
                acceptance_criteria: "".to_string(),
                source: "".to_string(),
                applies_to: r#"["module-a"]"#.to_string(),
                last_verified_at: Some("2026-03-01 00:00:00".to_string()),
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &payload2).unwrap();

        let state = requirements_load_impl(&conn).unwrap();
        assert_eq!(state.requirements.len(), 1);
        assert_eq!(state.requirements[0].id, "r2");
        assert_eq!(state.requirements[0].title, "New");
        assert_eq!(state.requirements[0].applies_to, r#"["module-a"]"#);
        assert_eq!(
            state.requirements[0].last_verified_at,
            Some("2026-03-01 00:00:00".to_string())
        );
    }

    fn make_test_requirement(id: &str, req_id: &str) -> PmRequirement {
        PmRequirement {
            id: id.to_string(),
            req_id: req_id.to_string(),
            title: format!("Requirement {}", id),
            description: "".to_string(),
            r#type: "functional".to_string(),
            category: "".to_string(),
            priority: "normal".to_string(),
            status: "draft".to_string(),
            rationale: "".to_string(),
            acceptance_criteria: "".to_string(),
            source: "".to_string(),
            applies_to: "[]".to_string(),
            last_verified_at: None,
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }
    }

    #[test]
    fn test_requirement_test_links_save_and_load() {
        let conn = setup_in_memory_db();

        // Need a ticket and test case for the FK to work
        let pm_payload = make_test_payload();
        pm_save_impl(&conn, &pm_payload).unwrap();

        let payload = RequirementsState {
            requirements: vec![make_test_requirement("r1", "REQ-01")],
            test_links: vec![PmRequirementTestLink {
                id: "tl1".to_string(),
                requirement_id: "r1".to_string(),
                test_case_id: "tc1".to_string(),
                created_at: "2026-01-01 00:00:00".to_string(),
            }],
        };

        requirements_save_impl(&conn, &payload).unwrap();
        let state = requirements_load_impl(&conn).unwrap();

        assert_eq!(state.requirements.len(), 1);
        assert_eq!(state.test_links.len(), 1);
        assert_eq!(state.test_links[0].id, "tl1");
        assert_eq!(state.test_links[0].requirement_id, "r1");
        assert_eq!(state.test_links[0].test_case_id, "tc1");
    }

    #[test]
    fn test_requirement_test_links_cleared_with_requirements() {
        let conn = setup_in_memory_db();

        let pm_payload = make_test_payload();
        pm_save_impl(&conn, &pm_payload).unwrap();

        let payload = RequirementsState {
            requirements: vec![make_test_requirement("r1", "REQ-01")],
            test_links: vec![PmRequirementTestLink {
                id: "tl1".to_string(),
                requirement_id: "r1".to_string(),
                test_case_id: "tc1".to_string(),
                created_at: "2026-01-01 00:00:00".to_string(),
            }],
        };
        requirements_save_impl(&conn, &payload).unwrap();

        requirements_clear_impl(&conn).unwrap();
        let state = requirements_load_impl(&conn).unwrap();

        assert_eq!(state.requirements.len(), 0);
        assert_eq!(state.test_links.len(), 0);
    }

    #[test]
    fn test_requirement_applies_to_and_last_verified_at_roundtrip() {
        let conn = setup_in_memory_db();

        let mut req = make_test_requirement("r1", "REQ-01");
        req.applies_to = r#"["auth","payments"]"#.to_string();
        req.last_verified_at = Some("2026-03-07 12:00:00".to_string());

        let payload = RequirementsState {
            requirements: vec![req],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &payload).unwrap();
        let state = requirements_load_impl(&conn).unwrap();

        assert_eq!(state.requirements[0].applies_to, r#"["auth","payments"]"#);
        assert_eq!(
            state.requirements[0].last_verified_at,
            Some("2026-03-07 12:00:00".to_string())
        );
    }

    #[test]
    fn test_requirement_last_verified_at_nullable() {
        let conn = setup_in_memory_db();

        let payload = RequirementsState {
            requirements: vec![make_test_requirement("r1", "REQ-01")],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &payload).unwrap();
        let state = requirements_load_impl(&conn).unwrap();

        assert_eq!(state.requirements[0].last_verified_at, None);
    }

    fn make_test_goal(id: &str, parent_id: Option<&str>) -> PmGoal {
        PmGoal {
            id: id.to_string(),
            parent_id: parent_id.map(|p| p.to_string()),
            name: format!("Goal {}", id),
            description: "".to_string(),
            success_criteria: "".to_string(),
            status: "draft".to_string(),
            priority: "normal".to_string(),
            goal_prompt: "".to_string(),
            created_by: "ui".to_string(),
            achieved_at: None,
            sort_order: 0,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }
    }

    fn sync_payload(
        goals: Vec<PmGoal>,
        goal_runs: Vec<PmGoalRun>,
        requirement_links: Vec<PmGoalRequirementLink>,
    ) -> GoalsSyncPayload {
        GoalsSyncPayload {
            goals,
            goal_runs,
            requirement_links,
            ..Default::default()
        }
    }

    fn make_test_station(id: &str, goal_id: &str, sort_order: i32) -> PmGoalStation {
        PmGoalStation {
            id: id.to_string(),
            goal_id: goal_id.to_string(),
            name: "A station".to_string(),
            kind: "normal".to_string(),
            status: "planned".to_string(),
            evidence_kind: "claim".to_string(),
            predicate: "{\"type\":\"undefined\"}".to_string(),
            evidence_note: "".to_string(),
            source_context: "null".to_string(),
            ticket_id: None,
            lane: 0,
            sort_order,
            last_checked_at: None,
            done_at: None,
            created_at: "2026-01-01 00:00:00".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }
    }

    #[test]
    fn test_goal_stations_roundtrip_ordered_by_sort_order() {
        let conn = setup_in_memory_db();
        let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        let mut second = make_test_station("s2", "g1", 1);
        second.name = "Call the customer".to_string();
        second.kind = "human".to_string();
        second.evidence_kind = "human".to_string();
        second.predicate = "{\"type\":\"human\"}".to_string();
        second.source_context =
            "{\"importId\":\"video-1\",\"notes\":[\"Client approval\"]}".to_string();
        payload.stations = vec![second, make_test_station("s1", "g1", 0)];

        goals_sync_impl(&conn, &payload).unwrap();
        let state = goals_load_impl(&conn).unwrap();

        assert_eq!(state.stations.len(), 2);
        assert_eq!(state.stations[0].id, "s1");
        assert_eq!(state.stations[1].id, "s2");
        assert_eq!(state.stations[1].name, "Call the customer");
        assert_eq!(state.stations[1].kind, "human");
        assert_eq!(state.stations[1].predicate, "{\"type\":\"human\"}");
        assert!(state.stations[1].source_context.contains("video-1"));
    }

    #[test]
    fn test_goal_stations_upsert_updates_existing_row() {
        let conn = setup_in_memory_db();
        let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        payload.stations = vec![make_test_station("s1", "g1", 0)];
        goals_sync_impl(&conn, &payload).unwrap();

        let mut updated = make_test_station("s1", "g1", 3);
        updated.status = "done".to_string();
        updated.evidence_kind = "human".to_string();
        updated.done_at = Some("2026-01-02 00:00:00".to_string());
        payload.stations = vec![updated];
        goals_sync_impl(&conn, &payload).unwrap();

        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.stations.len(), 1);
        assert_eq!(state.stations[0].status, "done");
        assert_eq!(state.stations[0].evidence_kind, "human");
        assert_eq!(state.stations[0].sort_order, 3);
        assert_eq!(
            state.stations[0].done_at,
            Some("2026-01-02 00:00:00".to_string())
        );
    }

    #[test]
    fn test_deleted_station_ids_remove_only_listed_rows() {
        let conn = setup_in_memory_db();
        let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        payload.stations = vec![
            make_test_station("s1", "g1", 0),
            make_test_station("s2", "g1", 1),
        ];
        goals_sync_impl(&conn, &payload).unwrap();

        payload.stations = vec![];
        payload.deleted_station_ids = vec!["s1".to_string()];
        goals_sync_impl(&conn, &payload).unwrap();

        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.stations.len(), 1);
        assert_eq!(state.stations[0].id, "s2");
    }

    #[test]
    fn test_deleting_a_goal_cascades_to_its_stations() {
        let conn = setup_in_memory_db();
        let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        payload.stations = vec![make_test_station("s1", "g1", 0)];
        goals_sync_impl(&conn, &payload).unwrap();

        payload.stations = vec![];
        payload.goals = vec![];
        payload.deleted_goal_ids = vec!["g1".to_string()];
        goals_sync_impl(&conn, &payload).unwrap();

        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.goals.len(), 0);
        assert_eq!(state.stations.len(), 0);
    }

    #[test]
    fn test_goals_clear_also_clears_stations() {
        let conn = setup_in_memory_db();
        let mut payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        payload.stations = vec![make_test_station("s1", "g1", 0)];
        goals_sync_impl(&conn, &payload).unwrap();
        goals_clear_impl(&conn).unwrap();
        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.stations.len(), 0);
    }

    #[test]
    fn test_goals_save_and_load_roundtrip() {
        let conn = setup_in_memory_db();

        let mut root = make_test_goal("g1", None);
        root.name = "Ship orchestration".to_string();
        root.success_criteria = "- All sub-goals achieved".to_string();
        root.status = "active".to_string();
        root.goal_prompt = "Achieve orchestration".to_string();

        // Child listed BEFORE its parent to prove save order is not a constraint
        let payload = sync_payload(vec![make_test_goal("g2", Some("g1")), root], vec![], vec![]);

        goals_sync_impl(&conn, &payload).unwrap();
        let state = goals_load_impl(&conn).unwrap();

        assert_eq!(state.goals.len(), 2);
        let g1 = state.goals.iter().find(|g| g.id == "g1").unwrap();
        let g2 = state.goals.iter().find(|g| g.id == "g2").unwrap();
        assert_eq!(g1.name, "Ship orchestration");
        assert_eq!(g1.success_criteria, "- All sub-goals achieved");
        assert_eq!(g1.status, "active");
        assert_eq!(g1.goal_prompt, "Achieve orchestration");
        assert_eq!(g1.parent_id, None);
        assert_eq!(g2.parent_id, Some("g1".to_string()));
    }

    #[test]
    fn test_goals_clear() {
        let conn = setup_in_memory_db();
        let payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        goals_sync_impl(&conn, &payload).unwrap();
        goals_clear_impl(&conn).unwrap();
        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.goals.len(), 0);
        assert_eq!(state.goal_runs.len(), 0);
        assert_eq!(state.requirement_links.len(), 0);
    }

    #[test]
    fn test_goal_runs_and_requirement_links_roundtrip() {
        let conn = setup_in_memory_db();

        let req_payload = RequirementsState {
            requirements: vec![make_test_requirement("r1", "REQ-01")],
            test_links: vec![],
        };
        requirements_save_impl(&conn, &req_payload).unwrap();

        let payload = sync_payload(
            vec![make_test_goal("g1", None)],
            vec![PmGoalRun {
                id: "run1".to_string(),
                goal_id: "g1".to_string(),
                agent_id: "agent-1".to_string(),
                ticket_id: None,
                prompt: "Do the thing".to_string(),
                model: "sonnet".to_string(),
                provider: "claude".to_string(),
                source: "conductor".to_string(),
                outcome: "running".to_string(),
                summary: "".to_string(),
                started_at: "2026-01-01 00:00:00".to_string(),
                finished_at: None,
            }],
            vec![PmGoalRequirementLink {
                id: "grl1".to_string(),
                goal_id: "g1".to_string(),
                requirement_id: "r1".to_string(),
                created_at: "2026-01-01 00:00:00".to_string(),
            }],
        );

        goals_sync_impl(&conn, &payload).unwrap();
        let state = goals_load_impl(&conn).unwrap();

        assert_eq!(state.goal_runs.len(), 1);
        assert_eq!(state.goal_runs[0].prompt, "Do the thing");
        assert_eq!(state.goal_runs[0].source, "conductor");
        assert_eq!(state.goal_runs[0].outcome, "running");
        assert_eq!(state.goal_runs[0].finished_at, None);
        assert_eq!(state.requirement_links.len(), 1);
        assert_eq!(state.requirement_links[0].requirement_id, "r1");
    }

    #[test]
    fn test_ticket_goal_id_roundtrip() {
        let conn = setup_in_memory_db();

        let goals = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        goals_sync_impl(&conn, &goals).unwrap();

        let mut pm_payload = make_test_payload();
        pm_payload.tickets[0].goal_id = Some("g1".to_string());
        pm_save_impl(&conn, &pm_payload).unwrap();

        let state = pm_load_impl(&conn).unwrap();
        let ticket = state.tickets.iter().find(|t| t.id == "t1").unwrap();
        assert_eq!(ticket.goal_id, Some("g1".to_string()));
    }

    #[test]
    fn test_goals_sync_preserves_mcp_created_rows() {
        let conn = setup_in_memory_db();

        // Frontend saves its draft
        let payload = sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]);
        goals_sync_impl(&conn, &payload).unwrap();

        // MCP subprocess concurrently creates a goal + run the frontend never saw
        conn.execute(
            "INSERT INTO pm_goals (id, parent_id, name) VALUES ('mcp-goal', 'g1', 'Agent subgoal')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pm_goal_runs (id, goal_id, agent_id, prompt) VALUES ('mcp-run', 'mcp-goal', 'agent-9', 'p')",
            [],
        )
        .unwrap();

        // Frontend saves again — MCP rows must survive
        let mut g1 = make_test_goal("g1", None);
        g1.name = "Renamed by UI".to_string();
        let payload2 = sync_payload(vec![g1], vec![], vec![]);
        goals_sync_impl(&conn, &payload2).unwrap();

        let state = goals_load_impl(&conn).unwrap();
        assert_eq!(state.goals.len(), 2);
        assert!(state.goals.iter().any(|g| g.id == "mcp-goal"));
        assert_eq!(state.goal_runs.len(), 1);
        assert_eq!(
            state.goals.iter().find(|g| g.id == "g1").unwrap().name,
            "Renamed by UI"
        );
    }

    #[test]
    fn test_goals_sync_deletes_only_listed_ids() {
        let conn = setup_in_memory_db();

        let payload = sync_payload(
            vec![
                make_test_goal("keep", None),
                make_test_goal("doomed", None),
                make_test_goal("doomed-child", Some("doomed")),
            ],
            vec![],
            vec![],
        );
        goals_sync_impl(&conn, &payload).unwrap();

        let delete_payload = GoalsSyncPayload {
            deleted_goal_ids: vec!["doomed".to_string()],
            ..Default::default()
        };
        goals_sync_impl(&conn, &delete_payload).unwrap();

        let state = goals_load_impl(&conn).unwrap();
        // Cascade removes the child; "keep" survives
        assert_eq!(state.goals.len(), 1);
        assert_eq!(state.goals[0].id, "keep");
    }

    fn make_history_entry(id: &str, prompt: &str) -> AgentPromptHistoryEntry {
        AgentPromptHistoryEntry {
            id: id.to_string(),
            prompt: prompt.to_string(),
            agent_name: "Agent".to_string(),
            model: "claude-opus-4-6".to_string(),
            provider: "claude".to_string(),
            cwd: Some("/repo".to_string()),
            source: "ui".to_string(),
            created_at: String::new(),
        }
    }

    #[test]
    fn test_agent_prompt_history_add_and_list() {
        let conn = setup_in_memory_db();

        agent_prompt_history_add_impl(&conn, &make_history_entry("h1", "Fix the login bug"))
            .unwrap();
        agent_prompt_history_add_impl(&conn, &make_history_entry("h2", "Write docs")).unwrap();

        let entries = agent_prompt_history_list_impl(&conn, None).unwrap();
        assert_eq!(entries.len(), 2);
        // Newest first
        assert_eq!(entries[0].id, "h2");
        assert_eq!(entries[0].prompt, "Write docs");
        assert_eq!(entries[1].id, "h1");
        assert_eq!(entries[1].agent_name, "Agent");
        assert_eq!(entries[1].provider, "claude");
        assert_eq!(entries[1].cwd.as_deref(), Some("/repo"));
        assert!(!entries[0].created_at.is_empty());
    }

    #[test]
    fn test_agent_prompt_history_respects_limit() {
        let conn = setup_in_memory_db();
        for i in 0..5 {
            agent_prompt_history_add_impl(
                &conn,
                &make_history_entry(&format!("h{}", i), &format!("prompt {}", i)),
            )
            .unwrap();
        }

        let entries = agent_prompt_history_list_impl(&conn, Some(2)).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "h4");
    }

    #[test]
    fn test_agent_prompt_history_dedupes_identical_prompt() {
        let conn = setup_in_memory_db();

        agent_prompt_history_add_impl(&conn, &make_history_entry("h1", "same prompt")).unwrap();
        agent_prompt_history_add_impl(&conn, &make_history_entry("h2", "other prompt")).unwrap();
        agent_prompt_history_add_impl(&conn, &make_history_entry("h3", "same prompt")).unwrap();

        let entries = agent_prompt_history_list_impl(&conn, None).unwrap();
        // Re-running the same prompt replaces the old row and moves it to the top
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "h3");
        assert_eq!(entries[0].prompt, "same prompt");
        assert_eq!(entries[1].id, "h2");
    }

    #[test]
    fn test_agent_prompt_history_prunes_to_cap() {
        let conn = setup_in_memory_db();
        let total = AGENT_PROMPT_HISTORY_CAP + 20;
        for i in 0..total {
            let mut entry = make_history_entry(&format!("h{}", i), &format!("prompt {}", i));
            // Deterministic ordering even with identical datetime('now') values
            entry.created_at = format!("2026-07-10 00:{:02}:{:02}", i / 60, i % 60);
            agent_prompt_history_add_impl(&conn, &entry).unwrap();
        }

        let entries = agent_prompt_history_list_impl(&conn, None).unwrap();
        assert_eq!(entries.len(), AGENT_PROMPT_HISTORY_CAP);
        // Newest survives, oldest were pruned
        assert_eq!(entries[0].id, format!("h{}", total - 1));
        assert!(entries.iter().all(|e| e.id != "h0"));
    }

    #[test]
    fn test_agent_prompt_history_skips_blank_prompt() {
        let conn = setup_in_memory_db();
        agent_prompt_history_add_impl(&conn, &make_history_entry("h1", "   ")).unwrap();
        let entries = agent_prompt_history_list_impl(&conn, None).unwrap();
        assert!(entries.is_empty());
    }

    fn seed_ticket(conn: &Connection, ticket_id: &str) {
        conn.execute(
            "INSERT INTO pm_epics (id, name) VALUES ('epic-1', 'Epic') \
             ON CONFLICT(id) DO NOTHING",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pm_tickets (id, epic_id, name) VALUES (?1, 'epic-1', 'Ticket')",
            params![ticket_id],
        )
        .unwrap();
    }

    fn insert_review(
        conn: &Connection,
        ticket_id: &str,
        pass: bool,
        reason: &str,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO pm_ticket_reviews (id, ticket_id, verdict, reason, reviewer, created_at)
             VALUES (hex(randomblob(16)), ?1, ?2, ?3, 'review-agent', ?4)",
            params![ticket_id, pass as i64, reason, created_at],
        )
        .unwrap();
    }

    #[test]
    fn test_pm_latest_ticket_review_returns_newest_row() {
        let conn = setup_in_memory_db();
        seed_ticket(&conn, "t1");
        insert_review(&conn, "t1", false, "missing tests", "2026-01-01 00:00:00");
        insert_review(&conn, "t1", true, "looks good", "2026-01-02 00:00:00");

        let review = pm_latest_ticket_review_impl(&conn, "t1", None)
            .unwrap()
            .unwrap();
        assert!(review.pass);
        assert_eq!(review.reason, "looks good");
        assert_eq!(review.reviewer, "review-agent");
        assert_eq!(review.ticket_id, "t1");
    }

    #[test]
    fn test_pm_latest_ticket_review_since_filter_excludes_older_rows() {
        let conn = setup_in_memory_db();
        seed_ticket(&conn, "t1");
        insert_review(&conn, "t1", true, "before the retry", "2026-01-01 00:00:00");

        // Nothing was written at/after the retry timestamp yet.
        let review =
            pm_latest_ticket_review_impl(&conn, "t1", Some("2026-01-02 00:00:00")).unwrap();
        assert!(review.is_none());

        insert_review(&conn, "t1", false, "after the retry", "2026-01-03 00:00:00");
        let review = pm_latest_ticket_review_impl(&conn, "t1", Some("2026-01-02 00:00:00"))
            .unwrap()
            .unwrap();
        assert_eq!(review.reason, "after the retry");
    }

    #[test]
    fn test_pm_latest_ticket_review_returns_none_when_no_reviews_exist() {
        let conn = setup_in_memory_db();
        seed_ticket(&conn, "t1");

        let review = pm_latest_ticket_review_impl(&conn, "t1", None).unwrap();
        assert!(review.is_none());
    }

    #[test]
    fn test_pm_latest_ticket_review_scopes_by_ticket_id() {
        let conn = setup_in_memory_db();
        seed_ticket(&conn, "t1");
        seed_ticket(&conn, "t2");
        insert_review(&conn, "t2", true, "for t2 only", "2026-01-01 00:00:00");

        let review = pm_latest_ticket_review_impl(&conn, "t1", None).unwrap();
        assert!(review.is_none());
    }
}
