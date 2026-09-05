use super::*;
use contract::{UsageWindow, WindowKind};
use std::collections::BTreeMap;

#[test]
fn the_feature_is_off_on_a_fresh_install() {
    assert!(!enabled_in(&BTreeMap::new()));
}

#[test]
fn only_the_literal_true_switches_it_on() {
    let on = BTreeMap::from([(ENABLED_PREF_KEY.to_string(), "true".to_string())]);
    assert!(enabled_in(&on));

    for value in ["false", "1", "yes", "TRUE", ""] {
        let prefs = BTreeMap::from([(ENABLED_PREF_KEY.to_string(), value.to_string())]);
        assert!(!enabled_in(&prefs), "{value:?} must not enable the feature");
    }
}

fn snapshot_at(observed_at: i64) -> UsageSnapshot {
    UsageSnapshot {
        provider: "codex".to_string(),
        plan_label: None,
        windows: vec![UsageWindow {
            limit_id: "codex".to_string(),
            limit_label: None,
            kind: WindowKind::SevenDay,
            label: "7 d".to_string(),
            used_percent: 40.0,
            resets_at: 1_787_301_067,
            window_minutes: 10080,
        }],
        credits: None,
        observed_at,
        source: "app-server".to_string(),
    }
}

#[test]
fn the_poller_looks_every_fifteen_minutes() {
    assert_eq!(TIMER_TICK_SECS, 15 * 60);
    assert_eq!(REFRESH_TTL_SECS, 15 * 60);
}

#[test]
fn an_unread_provider_always_needs_a_refresh() {
    assert!(needs_refresh(None, 1_000, REFRESH_TTL_SECS));
}

#[test]
fn a_recent_reading_is_left_alone() {
    let stored = snapshot_at(1_000);
    assert!(!needs_refresh(
        Some(&stored),
        1_000 + REFRESH_TTL_SECS - 1,
        REFRESH_TTL_SECS
    ));
}

#[test]
fn a_reading_at_exactly_the_ttl_is_refreshed() {
    let stored = snapshot_at(1_000);
    assert!(needs_refresh(
        Some(&stored),
        1_000 + REFRESH_TTL_SECS,
        REFRESH_TTL_SECS
    ));
}

#[test]
fn a_reading_from_the_future_is_refreshed_rather_than_trusted() {
    let stored = snapshot_at(9_000);
    assert!(needs_refresh(Some(&stored), 1_000, REFRESH_TTL_SECS));
}

#[test]
fn a_missing_claude_drop_does_not_erase_the_last_reading() {
    let dir = tempfile::tempdir().unwrap();
    let service = UsageLimitsService::new(dir.path().to_path_buf());
    service
        .store
        .put(UsageSnapshot {
            provider: "claude".to_string(),
            plan_label: None,
            windows: vec![UsageWindow {
                limit_id: "claude".to_string(),
                limit_label: None,
                kind: WindowKind::FiveHour,
                label: "5 h".to_string(),
                used_percent: 12.0,
                resets_at: 1_787_301_067,
                window_minutes: 300,
            }],
            credits: None,
            observed_at: 1_000,
            source: "statusline".to_string(),
        })
        .unwrap();

    let error = refresh_claude(&service, 2_000).expect_err("no drop file");
    assert!(
        error.to_string().starts_with("USAGE_UNAVAILABLE:"),
        "{error}"
    );
    let stored = service.store.read();
    assert_eq!(stored["claude"].windows[0].used_percent, 12.0);
}

#[test]
fn a_persisted_reading_is_on_the_history_trail() {
    let dir = tempfile::tempdir().unwrap();
    let service = UsageLimitsService::new(dir.path().to_path_buf());
    persist_snapshot(&service, &snapshot_at(1_000));

    let trail = service.history.read();
    assert_eq!(trail.len(), 1);
    assert_eq!(trail[0].provider, "codex");
    assert_eq!(trail[0].windows[0].used_percent, 40.0);
    assert_eq!(service.store.read()["codex"].windows[0].used_percent, 40.0);
}
