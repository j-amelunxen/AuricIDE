use super::schema::generate_uid;
use super::types::{
    AgentLaunchClaimInput, AgentLaunchRunInput, LaunchClaimOutcome, LaunchGrant, LaunchGrantInput,
    Notification, NotificationInput, NOTIFICATION_CAP,
};
use rusqlite::{params, Connection, OptionalExtension};

pub const SELECT_COLUMNS: &str =
    "id, uid, created_at, project_path, project_name, source, origin, \
     kind, severity, title, body, actions, dedupe_key, ref_kind, ref_id, \
     read_at, answered_at, answer, expires_at";

pub fn row_to_notification(row: &rusqlite::Row) -> rusqlite::Result<Notification> {
    let raw_actions: String = row.get(11)?;
    Ok(Notification {
        id: row.get(0)?,
        uid: row.get(1)?,
        created_at: row.get(2)?,
        project_path: row.get(3)?,
        project_name: row.get(4)?,
        source: row.get(5)?,
        origin: row.get(6)?,
        kind: row.get(7)?,
        severity: row.get(8)?,
        title: row.get(9)?,
        body: row.get(10)?,
        // A row written by hand or by an older client must not sink the whole
        // list; an unreadable actions blob degrades to "no buttons".
        actions: serde_json::from_str(&raw_actions).unwrap_or_else(|_| serde_json::json!([])),
        dedupe_key: row.get(12)?,
        ref_kind: row.get(13)?,
        ref_id: row.get(14)?,
        read_at: row.get(15)?,
        answered_at: row.get(16)?,
        answer: row.get(17)?,
        expires_at: row.get(18)?,
    })
}

/// Writes one notification and returns the row as stored.
///
/// A `dedupe_key` replaces the previous row rather than updating it in place:
/// the row id is the drain cursor every client reads from, so a bumped
/// notification needs a *new* id or clients that already drained past the old
/// one would never see it again. Same delete-then-insert shape as
/// `agent_prompt_history_add_impl`.
pub fn dispatch_impl(
    conn: &mut Connection,
    input: &NotificationInput,
) -> Result<Notification, String> {
    let kind = input.kind.clone().unwrap_or_else(|| "info".to_string());
    let severity = input.severity.clone().unwrap_or_else(|| "info".to_string());
    let actions = input
        .actions
        .clone()
        .unwrap_or_else(|| serde_json::json!([]))
        .to_string();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin notification transaction: {}", e))?;

    // A bump keeps the identity of the notification it replaces. Two things
    // depend on that: an agent waiting on `notify_answer_get(uid)` would
    // otherwise lose track of its own question, and a client merging by uid
    // would show the old row alongside the new one.
    let inherited_uid: Option<String> = match &input.dedupe_key {
        Some(key) => tx
            .query_row(
                "SELECT uid FROM notifications WHERE dedupe_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .ok(),
        None => None,
    };
    let uid = input
        .uid
        .clone()
        .or(inherited_uid)
        .unwrap_or_else(generate_uid);

    if let Some(key) = &input.dedupe_key {
        tx.execute(
            "DELETE FROM notifications WHERE dedupe_key = ?1",
            params![key],
        )
        .map_err(|e| format!("Failed to dedupe notification: {}", e))?;
    }
    // A re-dispatch under the same uid replaces too, so a retrying dispatcher
    // cannot mint duplicates against the UNIQUE index.
    tx.execute("DELETE FROM notifications WHERE uid = ?1", params![uid])
        .map_err(|e| format!("Failed to replace notification: {}", e))?;

    tx.execute(
        "INSERT INTO notifications
            (uid, project_path, project_name, source, origin, kind, severity,
             title, body, actions, dedupe_key, ref_kind, ref_id, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            uid,
            input.project_path,
            input.project_name,
            input.source,
            input.origin,
            kind,
            severity,
            input.title,
            input.body,
            actions,
            input.dedupe_key,
            input.ref_kind,
            input.ref_id,
            input.expires_at,
        ],
    )
    .map_err(|e| format!("Failed to insert notification: {}", e))?;

    prune(&tx)?;

    let notification = tx
        .query_row(
            &format!(
                "SELECT {} FROM notifications WHERE uid = ?1",
                SELECT_COLUMNS
            ),
            params![uid],
            row_to_notification,
        )
        .map_err(|e| format!("Failed to read back notification: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit notification: {}", e))?;

    Ok(notification)
}

/// Trims history back to `NOTIFICATION_CAP`.
///
/// Only rows the user has actually dealt with are eligible — read, and for a
/// question also answered. An unread backlog past the cap is kept instead:
/// dropping it would make the unread count disagree with the list, and a count
/// that lies is worse than a long list.
pub fn prune(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications
            WHERE read_at IS NOT NULL AND (kind <> 'ask' OR answered_at IS NOT NULL)
            ORDER BY id ASC
            LIMIT MAX(0, (SELECT COUNT(*) FROM notifications) - ?1)
        )",
        params![NOTIFICATION_CAP as i64],
    )
    .map_err(|e| format!("Failed to prune notifications: {}", e))?;

    Ok(())
}

/// Newest first. `since_id` narrows to what a client has not drained yet;
/// expired rows never surface.
pub fn list_impl(
    conn: &Connection,
    since_id: Option<i64>,
    limit: Option<usize>,
    project_path: Option<&str>,
) -> Result<Vec<Notification>, String> {
    let sql = format!(
        "SELECT {} FROM notifications
         WHERE id > ?1
           AND (?2 IS NULL OR project_path = ?2)
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY id DESC
         LIMIT ?3",
        SELECT_COLUMNS
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare notifications query: {}", e))?;

    let rows = stmt
        .query_map(
            params![
                since_id.unwrap_or(0),
                project_path,
                limit.unwrap_or(NOTIFICATION_CAP) as i64
            ],
            row_to_notification,
        )
        .map_err(|e| format!("Failed to query notifications: {}", e))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read notifications: {}", e))
}

/// Marks the given notifications read. Already-read rows keep their original
/// timestamp — when you first saw something is not something a second click
/// should rewrite.
pub fn mark_read_impl(conn: &Connection, uids: &[String]) -> Result<(), String> {
    for uid in uids {
        conn.execute(
            "UPDATE notifications SET read_at = datetime('now')
             WHERE uid = ?1 AND read_at IS NULL",
            params![uid],
        )
        .map_err(|e| format!("Failed to mark notification read: {}", e))?;
    }
    Ok(())
}

pub fn mark_all_read_impl(conn: &Connection, project_path: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE notifications SET read_at = datetime('now')
         WHERE read_at IS NULL AND (?1 IS NULL OR project_path = ?1)",
        params![project_path],
    )
    .map_err(|e| format!("Failed to mark notifications read: {}", e))?;
    Ok(())
}

/// Records the chosen action. Reading it back is how a waiting agent learns
/// the decision, so an answer is written once and never overwritten — asking
/// the same question twice would leave the agent guessing which reply is live.
pub fn answer_impl(conn: &Connection, uid: &str, answer: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE notifications
         SET answer = ?2, answered_at = datetime('now'), read_at = COALESCE(read_at, datetime('now'))
         WHERE uid = ?1 AND answered_at IS NULL",
        params![uid, answer],
    )
    .map_err(|e| format!("Failed to answer notification: {}", e))?;
    Ok(())
}

pub fn unread_count_impl(conn: &Connection, project_path: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM notifications
         WHERE read_at IS NULL
           AND (?1 IS NULL OR project_path = ?1)
           AND (expires_at IS NULL OR expires_at > datetime('now'))",
        params![project_path],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to count unread notifications: {}", e))
}

/// Clears settled notifications. Unanswered questions are spared — clearing
/// the list is a tidying gesture, not an answer, and a silently dropped
/// question is one an agent waits on forever.
pub fn clear_impl(conn: &Connection, project_path: Option<&str>) -> Result<(), String> {
    conn.execute(
        "DELETE FROM notifications
         WHERE (?1 IS NULL OR project_path = ?1)
           AND (kind <> 'ask' OR answered_at IS NOT NULL)",
        params![project_path],
    )
    .map_err(|e| format!("Failed to clear notifications: {}", e))?;
    Ok(())
}

/// Deletes the named notifications. The same guard as `clear_impl`, in the
/// SQL rather than left to the caller: the MCP server writes to this database
/// too, so "an unanswered question is never dropped" has to hold at the
/// boundary, not in one slice.
pub fn delete_impl(conn: &Connection, uids: &[String]) -> Result<(), String> {
    for uid in uids {
        conn.execute(
            "DELETE FROM notifications
            WHERE uid = ?1 AND (kind <> 'ask' OR answered_at IS NOT NULL)",
            params![uid],
        )
        .map_err(|e| format!("Failed to delete notification: {}", e))?;
    }
    Ok(())
}

/// A launch request is a row MCP `request_agent_launch` wrote: agent source,
/// that origin, and the `agent-launch:` key. The MCP `notify` tools refuse
/// both the origin and the key prefix, so plain `notify` cannot shape one.
pub fn is_launch_request(conn: &Connection, uid: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM notifications
          WHERE uid = ?1 AND source = 'agent' AND origin = 'request_agent_launch'
            AND dedupe_key LIKE 'agent-launch:%')",
        params![uid],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to look up launch request: {}", e))
}

const LAUNCH_RUN_STATUSES: [&str; 5] = ["running", "interrupted", "completed", "failed", "killed"];

/// Records what became of an agent launch request.
///
/// Only a row that really is a launch request (see `is_launch_request`)
/// gets a run. The backend writes the status (`agents::launch_runs`): at
/// spawn, at exit, at kill, and `interrupted` for a run the last IDE session
/// left behind. Writes arrive from threads and processes in any order, so
/// every transition is bound to the agent that owns the run:
///
/// - `running` opens a new run, reopens an `interrupted` one (a resume is a
///   new agent on the same request), or refreshes the owner's own record,
///   and stamps this process as the owner (`owner_pid`).
/// - An `interrupted` run belongs to nobody alive: `running` or a verdict of
///   any agent takes it over (a resumed agent may end before its own
///   `running` landed). Otherwise `interrupted` and a verdict apply only to
///   the owner's open run: a late write of an old agent never touches the
///   run a resumed agent now owns.
/// - The frontend sends `summary_only`: it never sets a status.
/// - A verdict is final. A late `running` of the same agent cannot reopen
///   it; like any write of the owner it only fills in missing name,
///   provider and model.
/// - An `interrupted` run does not free a slot: the claim of an instance
///   that really died is freed by its dead pid
///   (`release_orphaned_launch_claims_impl`), and a second instance sharing
///   the persistence file may call a live agent interrupted.
///
/// The frontend's summary may arrive after the backend's verdict; it is taken
/// for the owner as long as the run has none.
pub fn record_launch_run_impl(
    conn: &Connection,
    input: &AgentLaunchRunInput,
) -> Result<(), String> {
    if !LAUNCH_RUN_STATUSES.contains(&input.status.as_str()) {
        return Err(format!("Unknown launch run status '{}'", input.status));
    }
    let finished =
        !input.summary_only && !matches!(input.status.as_str(), "running" | "interrupted");
    if !is_launch_request(conn, &input.request_uid)? {
        if finished {
            // Frees the slot even when the request row is already gone.
            release_launch_claim_impl(conn, &input.request_uid)?;
        }
        return Err(format!(
            "'{}' is not an agent launch request",
            input.request_uid
        ));
    }
    if input.summary_only {
        return record_launch_run_summary(conn, input);
    }
    conn.execute(
        "INSERT INTO agent_launch_runs
            (request_uid, agent_id, agent_name, provider, model, status, summary, error,
             finished_at, owner_pid)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?9 THEN datetime('now') END, ?10)
         ON CONFLICT(request_uid) DO UPDATE SET
            agent_id = excluded.agent_id,
            agent_name = COALESCE(excluded.agent_name, agent_name),
            provider = COALESCE(excluded.provider, provider),
            model = COALESCE(excluded.model, model),
            status = excluded.status,
            summary = COALESCE(excluded.summary, summary),
            error = COALESCE(excluded.error, error),
            finished_at = excluded.finished_at,
            owner_pid = CASE WHEN excluded.status = 'running'
                             THEN excluded.owner_pid ELSE owner_pid END,
            updated_at = datetime('now')
         WHERE (agent_launch_runs.status = 'interrupted' AND excluded.status <> 'interrupted')
            OR (agent_launch_runs.status = 'running'
                AND agent_launch_runs.agent_id = excluded.agent_id)",
        params![
            input.request_uid,
            input.agent_id,
            input.agent_name,
            input.provider,
            input.model,
            input.status,
            input.summary,
            input.error,
            finished,
            std::process::id(),
        ],
    )
    .map_err(|e| format!("Failed to record launch run: {}", e))?;
    conn.execute(
        "UPDATE agent_launch_runs SET
            agent_name = COALESCE(agent_name, ?3),
            provider = COALESCE(provider, ?4),
            model = COALESCE(model, ?5)
          WHERE request_uid = ?1 AND agent_id = ?2",
        params![
            input.request_uid,
            input.agent_id,
            input.agent_name,
            input.provider,
            input.model
        ],
    )
    .map_err(|e| format!("Failed to record launch run identity: {}", e))?;
    // The slot is freed by the verdict that counts, not by a late one of an
    // agent that no longer owns the run.
    if finished && run_ended_by(conn, input)? {
        release_launch_claim_impl(conn, &input.request_uid)?;
    }
    record_launch_run_summary(conn, input)
}

/// The frontend's part: the summary it derived from the logs, for the agent
/// that owns the run, as long as the run has none.
fn record_launch_run_summary(conn: &Connection, input: &AgentLaunchRunInput) -> Result<(), String> {
    if input.summary.is_some() {
        conn.execute(
            "UPDATE agent_launch_runs SET summary = ?3, updated_at = datetime('now')
              WHERE request_uid = ?1 AND agent_id = ?2 AND summary IS NULL",
            params![input.request_uid, input.agent_id, input.summary],
        )
        .map_err(|e| format!("Failed to record launch run summary: {}", e))?;
    }
    Ok(())
}

fn run_ended_by(conn: &Connection, input: &AgentLaunchRunInput) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_launch_runs
          WHERE request_uid = ?1 AND agent_id = ?2 AND status = ?3)",
        params![input.request_uid, input.agent_id, input.status],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to read launch run: {}", e))
}

/// Runs a dead IDE instance left `running`: marked `interrupted`.
///
/// A run's status is written by the process that owns it, and any of those
/// writes can be lost: a failed write, a crash before the retry, a quit. A
/// run whose owner is no longer alive cannot be running, so the next start
/// of any instance corrects it here; a live instance's runs are left alone.
pub fn reconcile_orphaned_launch_runs_impl(
    conn: &Connection,
    is_alive: &dyn Fn(u32) -> bool,
) -> Result<usize, String> {
    let owners: Vec<i64> = conn
        .prepare("SELECT DISTINCT owner_pid FROM agent_launch_runs WHERE status = 'running'")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<i64>>>()
        })
        .map_err(|e| format!("Failed to read launch run owners: {}", e))?;
    let mut reconciled = 0;
    for owner in owners {
        let alive = u32::try_from(owner).is_ok_and(|pid| pid != 0 && is_alive(pid));
        if !alive {
            reconciled += conn
                .execute(
                    "UPDATE agent_launch_runs SET status = 'interrupted', updated_at = datetime('now')
                      WHERE status = 'running' AND owner_pid = ?1",
                    params![owner],
                )
                .map_err(|e| format!("Failed to mark orphaned launch runs: {}", e))?;
        }
    }
    Ok(reconciled)
}

/// Whether `agent_id`'s run for this request already has its verdict.
pub fn launch_run_is_final_for(
    conn: &Connection,
    request_uid: &str,
    agent_id: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM agent_launch_runs
          WHERE request_uid = ?1 AND agent_id = ?2
            AND status IN ('completed', 'failed', 'killed'))",
        params![request_uid, agent_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to read launch run: {}", e))
}

/// Hard ceilings, mirrored from `src/lib/notifications/launchGrants.ts` and
/// enforced once more by the table's CHECK constraints (migration 7).
pub const MAX_GRANT_CONCURRENT: i64 = 5;
pub const MAX_GRANT_BUDGET: i64 = 50;

// Threat model of launch grants and claims (decision Jennifer 2026-09-26,
// missions/goal-native/shared/notes/2026-09-26-09-bedrohungsmodell-und-verzeichnis.md):
// in scope are races, several app instances on one inbox file, failed writes,
// requests forged through MCP or `notify`, and injected input. Out of scope,
// on purpose and tracked as its own topic: a started agent with shell access
// that writes to this SQLite file (or the app prefs) directly, or that starts
// its own MCP server process with a forged environment (for example a second
// `auric-pm` with `AURIC_AGENT_CWD` set to another repository, review r3
// blocker 1; notes/2026-09-26-09-antwort-nach-r3.md). Grants, claims
// and usage therefore live in the app-global inbox database, written only
// through the IDE's Tauri commands; no MCP tool reads or writes them.

/// Puts Jennifer's grant for one mission root in force, replacing the one
/// before it, and returns the stored row. Every failure is returned, so the UI
/// shows a grant only after this acknowledged it.
pub fn save_launch_grant_impl(
    conn: &mut Connection,
    input: &LaunchGrantInput,
) -> Result<LaunchGrant, String> {
    if input.id.trim().is_empty()
        || input.project_path.trim().is_empty()
        || input.root_goal_id.trim().is_empty()
    {
        return Err("A launch grant needs an id, a project and a mission root".to_string());
    }
    if !(1..=MAX_GRANT_CONCURRENT).contains(&input.max_concurrent)
        || !(1..=MAX_GRANT_BUDGET).contains(&input.launch_budget)
    {
        return Err(format!(
            "Launch grant limits out of range (max {}, budget {})",
            input.max_concurrent, input.launch_budget
        ));
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to save launch grant: {}", e))?;
    tx.execute(
        "UPDATE agent_launch_grants SET revoked_at = datetime('now')
          WHERE project_path = ?1 AND root_goal_id = ?2 AND revoked_at IS NULL",
        params![input.project_path, input.root_goal_id],
    )
    .map_err(|e| format!("Failed to replace launch grant: {}", e))?;
    tx.execute(
        "INSERT INTO agent_launch_grants
            (id, project_path, root_goal_id, root_goal_name, max_concurrent, launch_budget)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.id,
            input.project_path,
            input.root_goal_id,
            input.root_goal_name,
            input.max_concurrent,
            input.launch_budget
        ],
    )
    .map_err(|e| format!("Failed to save launch grant: {}", e))?;
    let saved =
        grant_in_force(&tx, &input.id)?.ok_or_else(|| "Launch grant was not stored".to_string())?;
    tx.commit()
        .map_err(|e| format!("Failed to commit launch grant: {}", e))?;
    Ok(saved)
}

/// Revokes a grant. The row stays, stamped, so a claim that still carries its
/// id finds it and refuses.
///
/// Succeeds only when this call revoked the grant in force with exactly that
/// id (one atomic UPDATE). Review r3, blocker 3: a stale id (replaced from
/// another app instance, or already revoked) or an unknown one is an error,
/// never a success — otherwise the caller would show "off" while another
/// grant keeps authorising starts. A write that fails is an error too.
pub fn revoke_launch_grant_impl(conn: &Connection, grant_id: &str) -> Result<(), String> {
    let revoked = conn
        .execute(
            "UPDATE agent_launch_grants SET revoked_at = datetime('now')
              WHERE id = ?1 AND revoked_at IS NULL",
            params![grant_id],
        )
        .map_err(|e| format!("Failed to revoke launch grant: {}", e))?;
    if revoked == 1 {
        return Ok(());
    }
    Err(stale_revoke_reason(conn, grant_id))
}

/// Why a revoke changed nothing, for the UI. Read after the UPDATE, so it can
/// only describe the state; the outcome (an error) is already decided.
fn stale_revoke_reason(conn: &Connection, grant_id: &str) -> String {
    let unreadable =
        |e: rusqlite::Error| format!("Launch grant '{grant_id}' was not revoked ({e})");
    let scope: Option<(String, String)> = match conn
        .query_row(
            "SELECT project_path, root_goal_id FROM agent_launch_grants WHERE id = ?1",
            params![grant_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
    {
        Ok(scope) => scope,
        Err(e) => return unreadable(e),
    };
    let Some((project_path, root_goal_id)) = scope else {
        return format!("Launch grant '{grant_id}' does not exist; nothing was revoked");
    };
    let current: Option<String> = match conn
        .query_row(
            "SELECT id FROM agent_launch_grants
              WHERE project_path = ?1 AND root_goal_id = ?2 AND revoked_at IS NULL",
            params![project_path, root_goal_id],
            |row| row.get(0),
        )
        .optional()
    {
        Ok(current) => current,
        Err(e) => return unreadable(e),
    };
    match current {
        Some(current) => format!(
            "Launch grant '{grant_id}' is no longer in force; grant '{current}' for this \
             mission is, and was not revoked"
        ),
        None => format!("Launch grant '{grant_id}' was already revoked; nothing was revoked"),
    }
}

const GRANT_COLUMNS: &str = "g.id, g.project_path, g.root_goal_id, g.root_goal_name,
     g.max_concurrent, g.launch_budget, g.granted_at,
     COALESCE(u.launches_used, 0)
     FROM agent_launch_grants g
     LEFT JOIN agent_launch_grant_usage u ON u.grant_id = g.id";

fn row_to_grant(row: &rusqlite::Row) -> rusqlite::Result<LaunchGrant> {
    Ok(LaunchGrant {
        id: row.get(0)?,
        project_path: row.get(1)?,
        root_goal_id: row.get(2)?,
        root_goal_name: row.get(3)?,
        max_concurrent: row.get(4)?,
        launch_budget: row.get(5)?,
        granted_at: row.get(6)?,
        launches_used: row.get(7)?,
    })
}

fn grant_in_force(conn: &Connection, grant_id: &str) -> Result<Option<LaunchGrant>, String> {
    let sql = format!("SELECT {GRANT_COLUMNS} WHERE g.id = ?1 AND g.revoked_at IS NULL");
    match conn.query_row(&sql, params![grant_id], row_to_grant) {
        Ok(grant) => Ok(Some(grant)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read launch grant: {}", e)),
    }
}

/// The grants in force, optionally for one project, with their usage.
pub fn list_launch_grants_impl(
    conn: &Connection,
    project_path: Option<&str>,
) -> Result<Vec<LaunchGrant>, String> {
    let sql = format!(
        "SELECT {GRANT_COLUMNS}
          WHERE g.revoked_at IS NULL AND (?1 IS NULL OR g.project_path = ?1)
          ORDER BY g.granted_at, g.id"
    );
    conn.prepare(&sql)
        .and_then(|mut statement| {
            statement
                .query_map(params![project_path], row_to_grant)?
                .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|e| format!("Failed to list launch grants: {}", e))
}

/// Whether `goal_id` is `root_id` or below it in the project's own goal tree
/// (`<project>/.auric/project.db`, read-only), as it is right now. Bounded
/// and cycle-safe; a missing goal is not under anything. An unreadable
/// database is an error, which the claim turns into "no start".
pub fn goal_is_under_root_in_project(
    project_path: &str,
    goal_id: &str,
    root_id: &str,
) -> Result<bool, String> {
    let path = std::path::Path::new(project_path)
        .join(".auric")
        .join("project.db");
    if !path.is_file() {
        return Err(format!("Project database not found: {}", path.display()));
    }
    let db = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open project database: {}", e))?;
    // Every step, the root included, must be a row that exists right now: a
    // deleted root is under nothing and nothing is under it, even while a
    // grant for it is still in force and a goal still names it as parent.
    let mut current = Some(goal_id.to_string());
    let mut seen = std::collections::HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            return Ok(false);
        }
        let parent = match db.query_row(
            "SELECT parent_id FROM pm_goals WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        ) {
            Ok(parent) => parent,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
            Err(e) => return Err(format!("Failed to read goal tree: {}", e)),
        };
        if id == root_id {
            return Ok(true);
        }
        current = parent;
    }
    Ok(false)
}

/// Where a launch request points: its project and its goal, from the row.
fn request_target(conn: &Connection, uid: &str) -> Result<(String, String), String> {
    conn.query_row(
        "SELECT COALESCE(project_path, ''), COALESCE(ref_id, '') FROM notifications WHERE uid = ?1",
        params![uid],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(|e| format!("Failed to read launch request: {}", e))
}

/// Answers "is this goal under that mission root in that project, now?".
pub type GoalAncestry<'a> = &'a dyn Fn(&str, &str, &str) -> Result<bool, String>;

/// Takes one launch request for an automatic start, atomically.
///
/// In one immediate transaction: the row must be a real, unread, unanswered
/// launch request; the grant id must name a grant row that is in force (not
/// revoked, not replaced) for the request's own project; the request's goal
/// must sit under that grant's mission root in the project's goal tree as it
/// is now (`ancestry`, in production `goal_is_under_root_in_project`); the
/// grant must have budget left and its root a free slot. Limits, project and
/// root come from the grant row, never from the caller. A slot stays taken
/// until the start is resolved as failed or the agent's run is recorded as
/// finished: an unclear outcome keeps it (fail closed). Only then is the
/// request marked read (the exclusive claim), the slot reserved and the budget
/// booked. Any other outcome, or any error, changes nothing. Immediate mode
/// takes the write lock up front, so a second app instance with its own
/// connection waits and then sees the first one's claim or revoke.
// code-gate: complexity-cyclomatic - one transaction, each `?` is a DB error path; splitting would split the lock
pub fn claim_launch_impl(
    conn: &mut Connection,
    input: &AgentLaunchClaimInput,
    ancestry: GoalAncestry,
) -> Result<LaunchClaimOutcome, String> {
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to start launch claim: {}", e))?;

    if !is_launch_request(&tx, &input.request_uid)? {
        return Ok(LaunchClaimOutcome::NotARequest);
    }
    let open: bool = tx
        .query_row(
            "SELECT read_at IS NULL AND answered_at IS NULL
               AND NOT EXISTS(SELECT 1 FROM agent_launch_claims WHERE request_uid = ?1)
             FROM notifications WHERE uid = ?1",
            params![input.request_uid],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read launch request: {}", e))?;
    if !open {
        return Ok(LaunchClaimOutcome::AlreadyClaimed);
    }
    let (project_path, goal_id) = request_target(&tx, &input.request_uid)?;
    let grant = match grant_in_force(&tx, &input.grant_id)? {
        Some(grant) if !project_path.is_empty() && grant.project_path == project_path => grant,
        _ => return Ok(LaunchClaimOutcome::NoGrant),
    };
    if goal_id.is_empty() || !ancestry(&project_path, &goal_id, &grant.root_goal_id)? {
        return Ok(LaunchClaimOutcome::OutsideRoot);
    }
    if grant.launches_used >= grant.launch_budget {
        return Ok(LaunchClaimOutcome::BudgetSpent);
    }
    let running: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM agent_launch_claims WHERE root_goal_id = ?1",
            params![grant.root_goal_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to count running launches: {}", e))?;
    if running >= grant.max_concurrent {
        return Ok(LaunchClaimOutcome::AtCapacity);
    }

    let write = |sql: &str, values: &[&dyn rusqlite::ToSql]| {
        tx.execute(sql, values)
            .map_err(|e| format!("Failed to book launch claim: {}", e))
    };
    write(
        "UPDATE notifications SET read_at = datetime('now') WHERE uid = ?1",
        &[&input.request_uid],
    )?;
    write(
        "INSERT INTO agent_launch_claims (request_uid, grant_id, root_goal_id, goal_id, owner_pid)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        &[
            &input.request_uid,
            &grant.id,
            &grant.root_goal_id,
            &goal_id,
            &i64::from(std::process::id()),
        ],
    )?;
    write(
        "INSERT INTO agent_launch_grant_usage (grant_id, launches_used) VALUES (?1, 1)
         ON CONFLICT(grant_id) DO UPDATE SET launches_used = launches_used + 1",
        &[&grant.id],
    )?;
    tx.commit()
        .map_err(|e| format!("Failed to commit launch claim: {}", e))?;
    Ok(LaunchClaimOutcome::Claimed)
}

/// Frees the slot a claim holds. The budget stays spent. Idempotent.
pub fn release_launch_claim_impl(conn: &Connection, request_uid: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM agent_launch_claims WHERE request_uid = ?1",
        params![request_uid],
    )
    .map_err(|e| format!("Failed to release launch claim: {}", e))?;
    Ok(())
}

/// Automatic starts this grant has paid for so far. The app reads it with
/// the grant list (`list_launch_grants_impl`); tests read it directly.
#[cfg(test)]
pub fn launch_grant_usage_impl(conn: &Connection, grant_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE((SELECT launches_used FROM agent_launch_grant_usage WHERE grant_id = ?1), 0)",
        params![grant_id],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to read launch grant usage: {}", e))
}

/// Frees the slots of app instances that no longer run. An agent is a child
/// of the instance's PTY and ends with it, so its slot would otherwise stay
/// taken forever and block the mission. Claims of live instances (another
/// build running side by side) are left alone. Returns how many were freed.
pub fn release_orphaned_launch_claims_impl(
    conn: &Connection,
    is_alive: &dyn Fn(u32) -> bool,
) -> Result<usize, String> {
    let owners: Vec<i64> = conn
        .prepare("SELECT DISTINCT owner_pid FROM agent_launch_claims")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<i64>>>()
        })
        .map_err(|e| format!("Failed to read launch claim owners: {}", e))?;
    let mut freed = 0;
    for owner in owners {
        let alive = u32::try_from(owner).is_ok_and(|pid| pid != 0 && is_alive(pid));
        if !alive {
            freed += conn
                .execute(
                    "DELETE FROM agent_launch_claims WHERE owner_pid = ?1",
                    params![owner],
                )
                .map_err(|e| format!("Failed to free orphaned launch claims: {}", e))?;
        }
    }
    Ok(freed)
}

/// True while a process with this id exists. `EPERM` still means it exists.
#[cfg(unix)]
pub fn process_is_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: signal 0 performs only the existence and permission check.
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Without a cheap check, every owner counts as alive: slots stay taken.
#[cfg(not(unix))]
pub fn process_is_alive(_pid: u32) -> bool {
    true
}
