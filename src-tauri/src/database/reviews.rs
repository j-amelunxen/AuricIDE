use super::types::{AgentPromptHistoryEntry, TicketReview, AGENT_PROMPT_HISTORY_CAP};
use rusqlite::{params, Connection};

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
