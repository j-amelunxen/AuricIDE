//! Contract for the two CLI quota sources.
//!
//! This module is the single source of truth for what we expect from
//! `codex app-server` and from the JSON Claude Code pipes to a configured
//! `statusLine` command. Raw wire shapes live here, all validation happens
//! here, and the frontend only ever sees [`UsageSnapshot`]. The fixtures under
//! `fixtures/usage-limits/` are validated against this contract in the tests
//! below, so the mock lane and the real clients cannot drift apart quietly.
//!
//! Both sources may add fields freely (`codex app-server` is marked
//! `[experimental]`), so unknown fields are tolerated — but a field we DO
//! consume that is missing or mistyped fails loudly, naming the source and the
//! field path. A percentage that silently became `0` would read as "plenty of
//! quota left", which is the worst thing this feature could claim.
//!
//! Reality check (2026-08-15, live `codex` 0.147.0, ChatGPT Plus account):
//! `rateLimits.primary` carried `windowDurationMins: 10080` — the *weekly*
//! window — and `secondary` was `null`. The widely repeated assumption that
//! primary is the 5-hour window and secondary the weekly one is wrong. Windows
//! are therefore classified by duration and never by position.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Error taxonomy for the quota boundary. `Display` renders a stable
/// machine-readable prefix (`USAGE_*:`) so the frontend can branch on the class
/// while the rest of the message names exactly which source and field broke.
#[derive(Debug, Clone, PartialEq)]
pub enum UsageError {
    /// The CLI is not installed, or not reachable on this machine.
    Unavailable { source: String, detail: String },
    /// The CLI ran but reports no subscription quota (API-key account).
    NotSubscribed { source: String },
    /// The CLI answered, but not in a shape we can consume.
    Contract { source: String, detail: String },
    /// The CLI did not answer in time.
    Timeout { source: String, seconds: u64 },
}

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsageError::Unavailable { source, detail } => {
                write!(f, "USAGE_UNAVAILABLE: {source} — {detail}")
            }
            UsageError::NotSubscribed { source } => write!(
                f,
                "USAGE_NOT_SUBSCRIBED: {source} reports no subscription quota (API-key account?)"
            ),
            UsageError::Contract { source, detail } => {
                write!(f, "USAGE_CONTRACT: {source}: {detail}")
            }
            UsageError::Timeout { source, seconds } => {
                write!(
                    f,
                    "USAGE_TIMEOUT: {source} did not answer within {seconds}s"
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Raw wire shapes — codex app-server, `account/rateLimits/read`
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CodexRateLimitsResponse {
    #[serde(rename = "rateLimits")]
    pub rate_limits: Option<CodexLimitBucket>,
    /// Present alongside `rateLimits`. The map's existence is the reason we
    /// read it rather than the single top-level bucket: a second window living
    /// under another limit id would otherwise be invisible.
    #[serde(rename = "rateLimitsByLimitId", default)]
    pub by_limit_id: BTreeMap<String, CodexLimitBucket>,
}

#[derive(Debug, Deserialize)]
pub struct CodexLimitBucket {
    #[serde(rename = "limitId", default)]
    pub limit_id: Option<String>,
    #[serde(rename = "limitName", default)]
    pub limit_name: Option<String>,
    #[serde(default)]
    pub primary: Option<CodexWindow>,
    #[serde(default)]
    pub secondary: Option<CodexWindow>,
    #[serde(default)]
    pub credits: Option<CodexCredits>,
    #[serde(rename = "planType", default)]
    pub plan_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CodexWindow {
    #[serde(rename = "usedPercent")]
    pub used_percent: f64,
    #[serde(rename = "windowDurationMins")]
    pub window_duration_mins: i64,
    #[serde(rename = "resetsAt")]
    pub resets_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct CodexCredits {
    /// Kept as a string all the way to the UI. The server deliberately sends
    /// `"21979.6827500000"` as text; parsing it to `f64` throws away precision
    /// it went out of its way to preserve.
    #[serde(default)]
    pub balance: Option<String>,
    #[serde(default)]
    pub unlimited: bool,
}

// ---------------------------------------------------------------------------
// Raw wire shapes — Claude Code statusLine stdin payload
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClaudeStatusLinePayload {
    /// Absent for API-key accounts, and for subscription accounts until the
    /// first API response of the session. Each window may be absent on its own.
    #[serde(rename = "rate_limits", default)]
    pub rate_limits: Option<ClaudeRateLimits>,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeRateLimits {
    #[serde(default)]
    pub five_hour: Option<ClaudeWindow>,
    #[serde(default)]
    pub seven_day: Option<ClaudeWindow>,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeWindow {
    pub used_percentage: f64,
    pub resets_at: i64,
}

// ---------------------------------------------------------------------------
// Normalized shapes — the only thing that crosses IPC
// ---------------------------------------------------------------------------

/// Which known window a duration corresponds to. Derived from the duration for
/// both providers, so there is one classifier rather than two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowKind {
    #[serde(rename = "5h")]
    FiveHour,
    #[serde(rename = "7d")]
    SevenDay,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub limit_id: String,
    pub limit_label: Option<String>,
    pub kind: WindowKind,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: i64,
    /// Kept so a future 30-day window stays distinguishable from any other
    /// `Other`, rather than collapsing into one unnamed bucket.
    pub window_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCredits {
    pub balance: String,
    pub unlimited: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub provider: String,
    pub plan_label: Option<String>,
    /// Sorted by window length, then limit id, so the order is the same on
    /// every read. An empty list means "no window reported" — which the UI
    /// must render as nothing, never as 0 %.
    pub windows: Vec<UsageWindow>,
    pub credits: Option<UsageCredits>,
    pub observed_at: i64,
    pub source: String,
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

/// Parses a wire payload, naming the exact field path when it does not match.
pub fn parse_wire<T: DeserializeOwned>(source: &str, body: &str) -> Result<T, UsageError> {
    let deserializer = &mut serde_json::Deserializer::from_str(body);
    serde_path_to_error::deserialize(deserializer).map_err(|e| UsageError::Contract {
        source: source.to_string(),
        detail: format!("field '{}' — {}", e.path(), e.inner()),
    })
}

/// Minutes tolerated around the nominal 5-hour window (4 h to 8 h).
const FIVE_HOUR_RANGE: std::ops::RangeInclusive<i64> = 240..=480;
/// Minutes tolerated around the nominal 7-day window (6 d to 8 d).
const SEVEN_DAY_RANGE: std::ops::RangeInclusive<i64> = 8640..=11520;

/// Classifies a window by how long it is. Never by where it appeared in the
/// response — see the module docs for why that distinction is load-bearing.
pub fn classify_window(minutes: i64) -> WindowKind {
    if FIVE_HOUR_RANGE.contains(&minutes) {
        WindowKind::FiveHour
    } else if SEVEN_DAY_RANGE.contains(&minutes) {
        WindowKind::SevenDay
    } else {
        WindowKind::Other
    }
}

/// A short human label for a window length.
pub fn window_label(minutes: i64) -> String {
    match classify_window(minutes) {
        WindowKind::FiveHour => "5 h".to_string(),
        WindowKind::SevenDay => "7 d".to_string(),
        WindowKind::Other => {
            if minutes > 0 && minutes % 1440 == 0 {
                format!("{} d", minutes / 1440)
            } else if minutes > 0 && minutes % 60 == 0 {
                format!("{} h", minutes / 60)
            } else {
                format!("{minutes} min")
            }
        }
    }
}

/// Normalizes a codex `account/rateLimits/read` result.
///
/// `observed_at` is injected rather than read from the clock so the whole
/// function stays pure and the golden fixtures can assert on it.
pub fn normalize_codex(raw: CodexRateLimitsResponse, observed_at: i64) -> UsageSnapshot {
    // The plan and the credit balance describe the account, so they come from
    // the default bucket rather than from whichever limit sorted first.
    let plan_label = raw
        .rate_limits
        .as_ref()
        .and_then(|bucket| bucket.plan_type.clone());
    let credits = raw
        .rate_limits
        .as_ref()
        .and_then(|bucket| bucket.credits.as_ref())
        .and_then(|credits| {
            credits.balance.as_ref().map(|balance| UsageCredits {
                balance: balance.clone(),
                unlimited: credits.unlimited,
            })
        });

    // Prefer the per-limit map: it is the only place a second limit id can
    // appear, and it repeats the default bucket rather than omitting it.
    let buckets: Vec<(String, &CodexLimitBucket)> = if raw.by_limit_id.is_empty() {
        raw.rate_limits
            .iter()
            .map(|bucket| {
                let id = bucket
                    .limit_id
                    .clone()
                    .unwrap_or_else(|| "codex".to_string());
                (id, bucket)
            })
            .collect()
    } else {
        raw.by_limit_id
            .iter()
            .map(|(key, bucket)| {
                let id = bucket.limit_id.clone().unwrap_or_else(|| key.clone());
                (id, bucket)
            })
            .collect()
    };

    let mut windows = Vec::new();
    for (limit_id, bucket) in buckets {
        for window in [bucket.primary.as_ref(), bucket.secondary.as_ref()]
            .into_iter()
            .flatten()
        {
            windows.push(UsageWindow {
                limit_id: limit_id.clone(),
                limit_label: bucket.limit_name.clone(),
                kind: classify_window(window.window_duration_mins),
                label: window_label(window.window_duration_mins),
                used_percent: window.used_percent,
                resets_at: window.resets_at,
                window_minutes: window.window_duration_mins,
            });
        }
    }
    sort_windows(&mut windows);

    UsageSnapshot {
        provider: "codex".to_string(),
        plan_label,
        windows,
        credits,
        observed_at,
        source: "app-server".to_string(),
    }
}

/// Normalizes one Claude Code statusLine payload.
pub fn normalize_claude(
    raw: ClaudeStatusLinePayload,
    observed_at: i64,
) -> Result<UsageSnapshot, UsageError> {
    let not_subscribed = || UsageError::NotSubscribed {
        source: "claude".to_string(),
    };
    let limits = raw.rate_limits.ok_or_else(not_subscribed)?;

    // Claude names its windows instead of giving durations. Converting them to
    // minutes here keeps one classifier for both providers rather than two.
    let mut windows = Vec::new();
    for (window, minutes) in [
        (limits.five_hour.as_ref(), 300_i64),
        (limits.seven_day.as_ref(), 10080_i64),
    ] {
        let Some(window) = window else { continue };
        windows.push(UsageWindow {
            limit_id: "claude".to_string(),
            limit_label: None,
            kind: classify_window(minutes),
            label: window_label(minutes),
            used_percent: window.used_percentage,
            resets_at: window.resets_at,
            window_minutes: minutes,
        });
    }

    // A `rate_limits` object with no window inside says as little as no object
    // at all, and an empty snapshot would read as "measured, nothing to worry
    // about" rather than "not measured".
    if windows.is_empty() {
        return Err(not_subscribed());
    }
    sort_windows(&mut windows);

    Ok(UsageSnapshot {
        provider: "claude".to_string(),
        plan_label: None,
        windows,
        credits: None,
        observed_at,
        source: "statusline".to_string(),
    })
}

/// Shortest window first, then by limit id, so two reads of the same account
/// never render in a different order.
fn sort_windows(windows: &mut [UsageWindow]) {
    windows.sort_by(|a, b| {
        a.window_minutes
            .cmp(&b.window_minutes)
            .then_with(|| a.limit_id.cmp(&b.limit_id))
    });
}

#[cfg(test)]
#[path = "contract_tests.rs"]
mod tests;
