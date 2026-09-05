use rusqlite::{params, Connection};

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

    apply_migration(
        conn,
        18,
        "add_ticket_due_date",
        "ALTER TABLE pm_tickets ADD COLUMN due_date TEXT;",
    )?;

    apply_migration(
        conn,
        19,
        "add_ticket_skills",
        "ALTER TABLE pm_tickets ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';",
    )?;

    Ok(())
}
