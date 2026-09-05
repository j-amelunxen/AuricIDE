use super::setup_in_memory_db;
use crate::database::reviews::{
    agent_prompt_history_add_impl, agent_prompt_history_list_impl, pm_latest_ticket_review_impl,
};
use crate::database::types::{AgentPromptHistoryEntry, AGENT_PROMPT_HISTORY_CAP};
use rusqlite::{params, Connection};

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

    agent_prompt_history_add_impl(&conn, &make_history_entry("h1", "Fix the login bug")).unwrap();
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

fn insert_review(conn: &Connection, ticket_id: &str, pass: bool, reason: &str, created_at: &str) {
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
    let review = pm_latest_ticket_review_impl(&conn, "t1", Some("2026-01-02 00:00:00")).unwrap();
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
