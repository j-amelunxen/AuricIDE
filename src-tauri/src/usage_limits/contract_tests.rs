use super::*;

const CODEX_REAL: &str = include_str!("../../../fixtures/usage-limits/codex.rate-limits.json");
const CODEX_REAL_NORMALIZED: &str =
    include_str!("../../../fixtures/usage-limits/codex.rate-limits.normalized.json");
const CODEX_BOTH: &str =
    include_str!("../../../fixtures/usage-limits/codex.rate-limits.both-windows.json");
const CODEX_MULTI: &str =
    include_str!("../../../fixtures/usage-limits/codex.rate-limits.multi-limit.json");
const CODEX_MULTI_NORMALIZED: &str =
    include_str!("../../../fixtures/usage-limits/codex.rate-limits.multi-limit.normalized.json");
const CODEX_WRONG_TYPE: &str =
    include_str!("../../../fixtures/usage-limits/codex.rate-limits.wrong-type.json");

const CLAUDE_FULL: &str = include_str!("../../../fixtures/usage-limits/claude.statusline.json");
const CLAUDE_FULL_NORMALIZED: &str =
    include_str!("../../../fixtures/usage-limits/claude.statusline.normalized.json");
const CLAUDE_NONE: &str =
    include_str!("../../../fixtures/usage-limits/claude.statusline.no-rate-limits.json");
const CLAUDE_FIVE_ONLY: &str =
    include_str!("../../../fixtures/usage-limits/claude.statusline.five-hour-only.json");
const CLAUDE_WRONG_TYPE: &str =
    include_str!("../../../fixtures/usage-limits/claude.statusline.wrong-type.json");

const OBSERVED_AT: i64 = 1_787_300_000;

fn golden(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).expect("golden fixture must be valid JSON")
}

fn as_value(snapshot: &UsageSnapshot) -> serde_json::Value {
    serde_json::to_value(snapshot).expect("snapshot must serialize")
}

// ── Window classification ──────────────────────────────────────────

#[test]
fn windows_are_classified_by_duration_not_by_position() {
    assert_eq!(classify_window(10080), WindowKind::SevenDay);
    assert_eq!(classify_window(300), WindowKind::FiveHour);
    assert_eq!(classify_window(1440), WindowKind::Other);
    assert_eq!(classify_window(43200), WindowKind::Other);
}

#[test]
fn window_labels_stay_readable_for_unknown_durations() {
    assert_eq!(window_label(300), "5 h");
    assert_eq!(window_label(10080), "7 d");
    assert_eq!(window_label(1440), "1 d");
    assert_eq!(window_label(43200), "30 d");
    assert_eq!(window_label(90), "90 min");
}

// ── Codex ──────────────────────────────────────────────────────────

#[test]
fn codex_weekly_primary_normalizes_to_the_seven_day_window() {
    let raw: CodexRateLimitsResponse = parse_wire("codex", CODEX_REAL).expect("fixture parses");
    let snapshot = normalize_codex(raw, OBSERVED_AT);
    assert_eq!(as_value(&snapshot), golden(CODEX_REAL_NORMALIZED));
}

#[test]
fn codex_credit_balance_survives_as_text() {
    let raw: CodexRateLimitsResponse = parse_wire("codex", CODEX_REAL).expect("fixture parses");
    let snapshot = normalize_codex(raw, OBSERVED_AT);
    let credits = snapshot.credits.expect("fixture has credits");
    assert_eq!(credits.balance, "21979.6827500000");
}

#[test]
fn codex_reports_both_windows_when_both_are_present() {
    let raw: CodexRateLimitsResponse = parse_wire("codex", CODEX_BOTH).expect("fixture parses");
    let snapshot = normalize_codex(raw, OBSERVED_AT);
    let kinds: Vec<WindowKind> = snapshot.windows.iter().map(|w| w.kind).collect();
    assert_eq!(kinds, vec![WindowKind::FiveHour, WindowKind::SevenDay]);
    assert_eq!(snapshot.plan_label.as_deref(), Some("pro"));
}

#[test]
fn codex_surfaces_every_limit_id_not_just_the_default_bucket() {
    let raw: CodexRateLimitsResponse = parse_wire("codex", CODEX_MULTI).expect("fixture parses");
    let snapshot = normalize_codex(raw, OBSERVED_AT);
    assert_eq!(as_value(&snapshot), golden(CODEX_MULTI_NORMALIZED));
}

#[test]
fn codex_mistyped_percentage_names_the_field_rather_than_reading_as_zero() {
    let result: Result<CodexRateLimitsResponse, _> = parse_wire("codex", CODEX_WRONG_TYPE);
    let error = result.expect_err("a string percentage must not parse");
    let message = error.to_string();
    assert!(message.starts_with("USAGE_CONTRACT: codex:"), "{message}");
    assert!(
        message.contains("rateLimits.primary.usedPercent"),
        "{message}"
    );
}

// ── Claude ─────────────────────────────────────────────────────────

#[test]
fn claude_statusline_payload_normalizes_both_windows() {
    let raw: ClaudeStatusLinePayload = parse_wire("claude", CLAUDE_FULL).expect("fixture parses");
    let snapshot = normalize_claude(raw, OBSERVED_AT).expect("subscription payload normalizes");
    assert_eq!(as_value(&snapshot), golden(CLAUDE_FULL_NORMALIZED));
}

#[test]
fn claude_payload_without_rate_limits_is_not_subscribed() {
    let raw: ClaudeStatusLinePayload = parse_wire("claude", CLAUDE_NONE).expect("fixture parses");
    let error = normalize_claude(raw, OBSERVED_AT).expect_err("no quota to report");
    assert_eq!(
        error,
        UsageError::NotSubscribed {
            source: "claude".to_string()
        }
    );
}

#[test]
fn claude_missing_window_is_absent_never_zero_percent() {
    let raw: ClaudeStatusLinePayload =
        parse_wire("claude", CLAUDE_FIVE_ONLY).expect("fixture parses");
    let snapshot = normalize_claude(raw, OBSERVED_AT).expect("one window is enough");
    assert_eq!(snapshot.windows.len(), 1);
    assert_eq!(snapshot.windows[0].kind, WindowKind::FiveHour);
    assert!(!snapshot
        .windows
        .iter()
        .any(|w| w.kind == WindowKind::SevenDay));
}

#[test]
fn claude_mistyped_percentage_names_the_field() {
    let result: Result<ClaudeStatusLinePayload, _> = parse_wire("claude", CLAUDE_WRONG_TYPE);
    let error = result.expect_err("a string percentage must not parse");
    let message = error.to_string();
    assert!(message.starts_with("USAGE_CONTRACT: claude:"), "{message}");
    assert!(
        message.contains("rate_limits.five_hour.used_percentage"),
        "{message}"
    );
}

// ── Error surface ──────────────────────────────────────────────────

#[test]
fn errors_render_stable_machine_readable_prefixes() {
    assert!(UsageError::Unavailable {
        source: "codex".into(),
        detail: "not found on PATH".into()
    }
    .to_string()
    .starts_with("USAGE_UNAVAILABLE:"));
    assert!(UsageError::NotSubscribed {
        source: "claude".into()
    }
    .to_string()
    .starts_with("USAGE_NOT_SUBSCRIBED:"));
    assert!(UsageError::Contract {
        source: "codex".into(),
        detail: "field 'x' — bad".into()
    }
    .to_string()
    .starts_with("USAGE_CONTRACT:"));
    assert!(UsageError::Timeout {
        source: "codex".into(),
        seconds: 5
    }
    .to_string()
    .starts_with("USAGE_TIMEOUT:"));
}

#[test]
fn every_wire_fixture_is_still_readable() {
    for (name, body) in [
        ("codex.rate-limits.json", CODEX_REAL),
        ("codex.rate-limits.both-windows.json", CODEX_BOTH),
        ("codex.rate-limits.multi-limit.json", CODEX_MULTI),
        ("claude.statusline.json", CLAUDE_FULL),
        ("claude.statusline.no-rate-limits.json", CLAUDE_NONE),
        ("claude.statusline.five-hour-only.json", CLAUDE_FIVE_ONLY),
    ] {
        serde_json::from_str::<serde_json::Value>(body)
            .unwrap_or_else(|e| panic!("fixture {name} must be valid JSON: {e}"));
    }
}
