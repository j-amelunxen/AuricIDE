use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use super::policy::{DeliveryStatus, Transition};
use super::types::OutboxItem;

const LEASE_SECS: i64 = 120;
const TERMINAL_RETENTION_DAYS: i64 = 30;
const MAX_TERMINAL_ROWS: i64 = 5_000;
const TS_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

fn timestamp(at: DateTime<Utc>) -> String {
    at.format(TS_FORMAT).to_string()
}

/// Keeps the delivery ledger useful for diagnosis without turning it into a
/// permanent second notification archive.
pub fn purge_terminal(conn: &Connection, now: DateTime<Utc>) -> Result<usize, String> {
    let expired_before = timestamp(now - Duration::days(TERMINAL_RETENTION_DAYS));
    let expired = conn
        .execute(
            "DELETE FROM notification_delivery_outbox
             WHERE status IN ('delivered', 'dead', 'skipped') AND created_at < ?1",
            params![expired_before],
        )
        .map_err(|error| format!("Failed to purge expired delivery history: {error}"))?;
    let overflow = conn
        .execute(
            "DELETE FROM notification_delivery_outbox
             WHERE id IN (
                 SELECT id FROM notification_delivery_outbox
                 WHERE status IN ('delivered', 'dead', 'skipped')
                 ORDER BY id DESC
                 LIMIT -1 OFFSET ?1
             )",
            params![MAX_TERMINAL_ROWS],
        )
        .map_err(|error| format!("Failed to cap delivery history: {error}"))?;
    Ok(expired + overflow)
}

/// Claims one ready event with a short SQLite lease. The HTTP request happens
/// after this transaction commits, so a slow network never blocks producers.
pub fn claim_next(
    conn: &mut Connection,
    worker_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<OutboxItem>, String> {
    let now_raw = timestamp(now);
    let lease_until = timestamp(now + Duration::seconds(LEASE_SECS));
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Failed to start delivery claim: {error}"))?;

    let id = tx
        .query_row(
            "SELECT id FROM notification_delivery_outbox
             WHERE channel = 'pushover'
               AND (
                    (status IN ('pending', 'retry') AND available_at <= ?1)
                 OR (status = 'processing' AND lease_until <= ?1)
               )
             ORDER BY id
             LIMIT 1",
            params![now_raw],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to find pending delivery: {error}"))?;

    let Some(id) = id else {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    };

    tx.execute(
        "UPDATE notification_delivery_outbox
         SET status = 'processing', attempts = attempts + 1,
             lease_owner = ?2, lease_until = ?3
         WHERE id = ?1",
        params![id, worker_id, lease_until],
    )
    .map_err(|error| format!("Failed to claim delivery: {error}"))?;

    let item = tx
        .query_row(
            "SELECT id, notification_uid, title, body, severity, project_name,
                    origin, attempts
             FROM notification_delivery_outbox WHERE id = ?1",
            params![id],
            |row| {
                Ok(OutboxItem {
                    id: row.get(0)?,
                    notification_uid: row.get(1)?,
                    title: row.get(2)?,
                    body: row.get(3)?,
                    severity: row.get(4)?,
                    project_name: row.get(5)?,
                    origin: row.get(6)?,
                    attempts: row.get::<_, u32>(7)?,
                })
            },
        )
        .map_err(|error| format!("Failed to read claimed delivery: {error}"))?;
    tx.commit()
        .map_err(|error| format!("Failed to commit delivery claim: {error}"))?;
    Ok(Some(item))
}

pub fn complete_attempt(
    conn: &Connection,
    item_id: i64,
    worker_id: &str,
    decision: Transition,
    error: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let available_at = decision
        .retry_after_secs
        .map(|seconds| timestamp(now + Duration::seconds(seconds as i64)))
        .unwrap_or_else(|| timestamp(now));
    let delivered_at = (decision.status == DeliveryStatus::Delivered).then(|| timestamp(now));
    let changed = conn
        .execute(
            "UPDATE notification_delivery_outbox
             SET status = ?3, available_at = ?4, lease_owner = NULL,
                 lease_until = NULL, delivered_at = ?5, last_error = ?6
             WHERE id = ?1 AND lease_owner = ?2 AND status = 'processing'",
            params![
                item_id,
                worker_id,
                decision.status.as_str(),
                available_at,
                delivered_at,
                error
            ],
        )
        .map_err(|err| format!("Failed to finish delivery: {err}"))?;
    if changed == 1 {
        Ok(())
    } else {
        Err("Delivery lease was lost before completion".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::delivery::policy::{transition, AttemptResult};
    use crate::notifications::{dispatch_impl, run_migrations, NotificationInput};

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn enqueue(conn: &mut Connection) {
        dispatch_impl(
            conn,
            &NotificationInput {
                uid: None,
                project_path: None,
                project_name: None,
                source: "ui".to_string(),
                origin: None,
                kind: None,
                severity: Some("warn".to_string()),
                title: "Test".to_string(),
                body: None,
                actions: None,
                dedupe_key: None,
                ref_kind: None,
                ref_id: None,
                expires_at: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn a_live_lease_prevents_a_second_claim() {
        let mut conn = database();
        enqueue(&mut conn);
        let now = Utc::now();
        assert!(claim_next(&mut conn, "one", now).unwrap().is_some());
        assert!(claim_next(&mut conn, "two", now).unwrap().is_none());
    }

    #[test]
    fn an_expired_lease_is_recovered_and_attempt_count_advances() {
        let mut conn = database();
        enqueue(&mut conn);
        let now = Utc::now();
        claim_next(&mut conn, "crashed", now).unwrap();

        let recovered = claim_next(&mut conn, "replacement", now + Duration::minutes(3))
            .unwrap()
            .unwrap();
        assert_eq!(recovered.attempts, 2);
    }

    #[test]
    fn completion_requires_the_current_lease_owner() {
        let mut conn = database();
        enqueue(&mut conn);
        let now = Utc::now();
        let item = claim_next(&mut conn, "owner", now).unwrap().unwrap();
        let decision = transition(item.attempts, AttemptResult::Delivered);

        assert!(complete_attempt(&conn, item.id, "stranger", decision, None, now).is_err());
        complete_attempt(&conn, item.id, "owner", decision, None, now).unwrap();
        assert!(claim_next(&mut conn, "again", now).unwrap().is_none());
    }

    #[test]
    fn terminal_delivery_history_is_age_bounded() {
        let conn = database();
        conn.execute(
            "INSERT INTO notification_delivery_outbox
             (notification_row_id, notification_uid, channel, payload_fingerprint,
              title, severity, status, created_at)
             VALUES (1, 'old', 'pushover', 'old', 'Old', 'warn', 'delivered',
                     datetime('now', '-31 days'))",
            [],
        )
        .unwrap();

        assert_eq!(purge_terminal(&conn, Utc::now()).unwrap(), 1);
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM notification_delivery_outbox",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
