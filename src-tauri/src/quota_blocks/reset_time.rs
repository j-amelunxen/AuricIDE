//! Reset timestamp and relative duration parsing for quota blocks.

use chrono::{DateTime, Duration, NaiveTime, TimeZone, Utc};
use regex::Regex;
use std::sync::OnceLock;

/// Parses an explicit reset timestamp or relative duration from a CLI error
/// message, returning `None` when the message names no reset time.
pub fn parse_reset_time(text: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    // 1. Explicit ISO-8601 / RFC3339 timestamp
    static ISO_RE: OnceLock<Regex> = OnceLock::new();
    let iso_re = ISO_RE.get_or_init(|| {
        Regex::new(r"\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\b")
            .expect("valid iso regex")
    });
    if let Some(caps) = iso_re.captures(text) {
        if let Ok(dt) = DateTime::parse_from_rfc3339(&caps[1]) {
            let utc = dt.with_timezone(&Utc);
            if utc > now {
                return Some(utc);
            }
        }
    }

    // 2. Relative hours + minutes, e.g. "resets in 2h 15m", "in 45m", "in 30 minutes", "in 2 hours"
    static REL_HM_RE: OnceLock<Regex> = OnceLock::new();
    let rel_hm = REL_HM_RE.get_or_init(|| {
        Regex::new(
            r"(?i)\b(?:resets?\s+in|try\s+again\s+in|until)\s+(?:(\d+)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?",
        )
        .expect("valid relative regex")
    });
    if let Some(caps) = rel_hm.captures(text) {
        let hours = caps
            .get(1)
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .unwrap_or(0);
        let mins = caps
            .get(2)
            .and_then(|m| m.as_str().parse::<i64>().ok())
            .unwrap_or(0);
        if hours > 0 || mins > 0 {
            return Some(now + Duration::hours(hours) + Duration::minutes(mins));
        }
    }

    // 3. Clock time after "until" or "resets at", e.g. "until 20:00", "resets at 18:30"
    static CLOCK_RE: OnceLock<Regex> = OnceLock::new();
    let clock_re = CLOCK_RE.get_or_init(|| {
        Regex::new(r"(?i)\b(?:until|resets?\s+at)\s+(\d{1,2}:\d{2})\b").expect("valid clock regex")
    });
    if let Some(caps) = clock_re.captures(text) {
        if let Some(dt) = parse_hhmm_after(&caps[1], now) {
            return Some(dt);
        }
    }

    None
}

pub fn parse_hhmm_after(hhmm: &str, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let time = NaiveTime::parse_from_str(hhmm.trim(), "%H:%M").ok()?;
    let today = now.date_naive().and_time(time);
    let candidate = Utc.from_utc_datetime(&today);
    if candidate > now {
        Some(candidate)
    } else {
        Some(candidate + Duration::days(1))
    }
}

/// Resolves a manual block's expiry from an explicit `until` string (RFC3339 or
/// `HH:MM`), a `duration_minutes`, or the store's `default_ttl_minutes`.
pub fn resolve_manual_until(
    until: Option<&str>,
    duration_minutes: Option<u32>,
    default_ttl_minutes: u32,
    now: DateTime<Utc>,
) -> Result<DateTime<Utc>, String> {
    if let Some(raw) = until.map(str::trim).filter(|s| !s.is_empty()) {
        if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
            let utc = dt.with_timezone(&Utc);
            if utc <= now {
                return Err("The expiry timestamp must be in the future.".to_string());
            }
            return Ok(utc);
        }
        if let Some(dt) = parse_hhmm_after(raw, now) {
            return Ok(dt);
        }
        return Err(format!(
            "Invalid 'until' value '{raw}': pass an ISO-8601 timestamp (e.g. 2026-10-23T20:00:00Z) or HH:MM (e.g. 20:00)."
        ));
    }
    let minutes = duration_minutes.unwrap_or(default_ttl_minutes.max(1));
    if minutes == 0 || minutes > 7 * 24 * 60 {
        return Err("Duration must be between 1 and 10080 minutes (7 days).".to_string());
    }
    Ok(now + Duration::minutes(i64::from(minutes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_manual_until_from_iso_or_hhmm_or_duration() {
        let now = Utc.with_ymd_and_hms(2026, 10, 23, 16, 0, 0).unwrap();
        let by_iso = resolve_manual_until(Some("2026-10-23T20:00:00Z"), None, 60, now).unwrap();
        assert_eq!(
            by_iso,
            Utc.with_ymd_and_hms(2026, 10, 23, 20, 0, 0).unwrap()
        );

        let by_duration = resolve_manual_until(None, Some(90), 60, now).unwrap();
        assert_eq!(
            by_duration,
            Utc.with_ymd_and_hms(2026, 10, 23, 17, 30, 0).unwrap()
        );

        let by_default = resolve_manual_until(None, None, 60, now).unwrap();
        assert_eq!(
            by_default,
            Utc.with_ymd_and_hms(2026, 10, 23, 17, 0, 0).unwrap()
        );

        let by_hhmm = resolve_manual_until(Some("20:00"), None, 60, now).unwrap();
        assert!(by_hhmm > now);
    }
}
