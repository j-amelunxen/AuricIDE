use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::Utc;
use rusqlite::Connection;

use crate::app_config::{global_namespace, AppCredentialsState};

use super::outbox::{claim_next, complete_attempt, purge_terminal};
use super::policy::{transition, AttemptResult};
use super::pushover::PushoverClient;
use super::types::{OutboxItem, PushoverConfig, Severity, PUSHOVER_NAMESPACE};

#[derive(Clone)]
pub struct DeliveryRouterState {
    db_path: PathBuf,
    credentials_path: PathBuf,
    client: PushoverClient,
    draining: Arc<AtomicBool>,
    requested: Arc<AtomicBool>,
}

impl DeliveryRouterState {
    pub fn new(db_path: PathBuf, credentials_path: PathBuf) -> Self {
        Self {
            db_path,
            credentials_path,
            client: PushoverClient::default(),
            draining: Arc::new(AtomicBool::new(false)),
            requested: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Coalesces bursts while guaranteeing a wake that races the end of a
    /// drain is observed before the worker goes idle.
    pub fn wake(&self) {
        self.requested.store(true, Ordering::Release);
        if self.draining.swap(true, Ordering::AcqRel) {
            return;
        }
        let state = self.clone();
        tauri::async_runtime::spawn(async move { state.run_requested().await });
    }

    /// Makes enablement non-retroactive even when it races startup draining:
    /// everything that existed before the switch becomes a terminal skip.
    pub fn skip_nonterminal(&self) -> Result<usize, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|error| format!("Failed to open delivery database: {error}"))?;
        conn.execute(
            "UPDATE notification_delivery_outbox
             SET status = 'skipped', lease_owner = NULL, lease_until = NULL,
                 last_error = 'Pushover was disabled when this notification was queued'
             WHERE channel = 'pushover' AND status IN ('pending', 'retry', 'processing')",
            [],
        )
        .map_err(|error| format!("Failed to skip disabled Pushover deliveries: {error}"))
    }

    async fn run_requested(self) {
        loop {
            self.requested.store(false, Ordering::Release);
            if let Err(error) =
                drain_ready(&self.db_path, &self.credentials_path, &self.client).await
            {
                eprintln!("Pushover delivery worker failed: {error}");
            }
            if self.requested.load(Ordering::Acquire) {
                continue;
            }
            self.draining.store(false, Ordering::Release);
            // Close the race between the check above and releasing ownership.
            if self.requested.load(Ordering::Acquire) && !self.draining.swap(true, Ordering::AcqRel)
            {
                continue;
            }
            break;
        }
    }
}

fn config_at(path: &Path) -> PushoverConfig {
    PushoverConfig::from_namespace(global_namespace(path, PUSHOVER_NAMESPACE))
}

fn route(item: &OutboxItem, config: &PushoverConfig) -> Option<AttemptResult> {
    if !config.enabled || !config.is_configured() {
        return Some(AttemptResult::Disabled);
    }
    if !Severity::parse(&item.severity).meets(config.minimum_severity) {
        return Some(AttemptResult::BelowThreshold);
    }
    None
}

pub async fn drain_ready(
    db_path: &Path,
    credentials_path: &Path,
    client: &PushoverClient,
) -> Result<usize, String> {
    let mut conn = Connection::open(db_path)
        .map_err(|error| format!("Failed to open notification delivery database: {error}"))?;
    purge_terminal(&conn, Utc::now())?;
    let worker_id = format!(
        "{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    );
    let mut handled = 0;

    while let Some(item) = claim_next(&mut conn, &worker_id, Utc::now())? {
        let config = config_at(credentials_path);
        let (result, error) = if let Some(result) = route(&item, &config) {
            (result, None)
        } else {
            match client.send(&config, &item).await {
                Ok(()) => (AttemptResult::Delivered, None),
                Err(failure) => (failure.result, Some(failure.message)),
            }
        };
        complete_attempt(
            &conn,
            item.id,
            &worker_id,
            transition(item.attempts, result),
            error.as_deref(),
            Utc::now(),
        )?;
        handled += 1;
    }
    Ok(handled)
}

#[tauri::command]
pub async fn pushover_send_test(
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<(), String> {
    let config = config_at(credentials.path());
    if !config.is_configured() {
        return Err("Enter both the Pushover API token and user key first".to_string());
    }
    let item = OutboxItem {
        id: 0,
        notification_uid: "settings-test".to_string(),
        title: "AuricIDE test".to_string(),
        body: Some("Pushover delivery is configured correctly.".to_string()),
        severity: "info".to_string(),
        project_name: None,
        origin: Some("Settings".to_string()),
        attempts: 1,
    };
    PushoverClient::default()
        .send(&config, &item)
        .await
        .map_err(|failure| failure.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn config(values: &[(&str, &str)]) -> PushoverConfig {
        PushoverConfig::from_namespace(
            values
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect::<BTreeMap<_, _>>(),
        )
    }

    fn item(severity: &str) -> OutboxItem {
        OutboxItem {
            id: 1,
            notification_uid: "n".to_string(),
            title: "Title".to_string(),
            body: None,
            severity: severity.to_string(),
            project_name: None,
            origin: None,
            attempts: 1,
        }
    }

    #[test]
    fn disabled_or_incomplete_configuration_skips_without_network() {
        assert_eq!(
            route(&item("error"), &config(&[])),
            Some(AttemptResult::Disabled)
        );
        assert_eq!(
            route(
                &item("error"),
                &config(&[("enabled", "true"), ("api_token", "token")])
            ),
            Some(AttemptResult::Disabled)
        );
    }

    #[test]
    fn default_routing_delivers_warn_and_error_only() {
        let enabled = config(&[
            ("enabled", "true"),
            ("api_token", "token"),
            ("user_key", "user"),
        ]);
        assert_eq!(
            route(&item("info"), &enabled),
            Some(AttemptResult::BelowThreshold)
        );
        assert_eq!(
            route(&item("success"), &enabled),
            Some(AttemptResult::BelowThreshold)
        );
        assert_eq!(route(&item("warn"), &enabled), None);
        assert_eq!(route(&item("error"), &enabled), None);
    }

    #[test]
    fn enabling_can_terminally_skip_every_older_nonterminal_row() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("notifications.db");
        let conn = crate::notifications::init_db(&db_path).unwrap();
        conn.execute(
            "INSERT INTO notifications (uid, source, title) VALUES ('old', 'ui', 'Old')",
            [],
        )
        .unwrap();
        drop(conn);
        let router = DeliveryRouterState::new(db_path.clone(), dir.path().join("credentials.json"));

        assert_eq!(router.skip_nonterminal().unwrap(), 1);
        let status: String = Connection::open(db_path)
            .unwrap()
            .query_row(
                "SELECT status FROM notification_delivery_outbox",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "skipped");
    }
}
