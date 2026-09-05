use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// How many missed occurrences `all` will replay. Beyond this the body says it
/// was capped rather than pretending the list is complete.
pub const MAX_CATCHUP: usize = 10;

/// Guards against a pathological walk — a five-minute schedule anchored years
/// back would otherwise iterate forever before the cap could apply.
pub const MAX_ITERATIONS: usize = 20_000;

/// SQLite's `datetime('now')` shape, which every timestamp here uses (UTC).
pub const TS_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    /// `cron` or `every`.
    pub spec_kind: String,
    pub cron_expr: Option<String>,
    pub every_n: Option<i64>,
    /// `hour`, `day` or `week`.
    pub every_unit: Option<String>,
    /// First occurrence, UTC. Also the floor: nothing before it ever fires.
    pub anchor_at: Option<String>,
    /// `HH:MM` in the schedule's own zone, for day and week intervals.
    pub time_of_day: Option<String>,
    /// IANA name. Stored per schedule rather than read from the system clock:
    /// "every Wednesday at 17:00" must stay 17:00 across a DST change and
    /// across a trip to another timezone.
    pub timezone: String,
    /// `coalesce`, `skip` or `all`.
    pub catch_up: String,
    /// JSON notification template — title, body, severity, actions.
    pub payload: String,
    pub last_fired_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub next_due_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// What a schedule owes right now.
#[derive(Debug, Clone, PartialEq)]
pub struct DueResult {
    /// Missed occurrences, oldest first, capped at `MAX_CATCHUP`.
    pub occurrences: Vec<DateTime<Utc>>,
    /// How many were actually missed — may exceed `occurrences.len()`.
    pub total: usize,
    pub next_due: Option<DateTime<Utc>>,
}

/// What one walk over a schedule's series found: everything that came due in
/// the window, and the first thing still ahead.
pub type Walk = (Vec<DateTime<Utc>>, Option<DateTime<Utc>>);

pub fn parse_ts(raw: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(raw, TS_FORMAT)
        .ok()
        .map(|naive| Utc.from_utc_datetime(&naive))
        .or_else(|| {
            DateTime::parse_from_rfc3339(raw)
                .ok()
                .map(|dt| dt.with_timezone(&Utc))
        })
}

pub fn format_ts(at: DateTime<Utc>) -> String {
    at.format(TS_FORMAT).to_string()
}

/// Accepts the five-field cron everyone writes and hands the crate the six
/// fields it actually wants.
///
/// The `cron` crate's first field is *seconds*, so a plain `0 17 * * 3` parses
/// as something else entirely or not at all. Rather than make every caller
/// remember that, five fields get a leading `0` here.
pub fn normalize_cron(expr: &str) -> String {
    let fields = expr.split_whitespace().count();
    if fields == 5 {
        format!("0 {}", expr.trim())
    } else {
        expr.trim().to_string()
    }
}

/// Turns a local wall-clock time into an instant.
///
/// Two days a year the naive time is not a single instant. On the spring-forward
/// gap the requested time never happens — the reminder moves forward to when it
/// does, rather than being skipped for the year. On the autumn overlap it
/// happens twice, and the first one wins, so a daily reminder does not silently
/// slide an hour later.
pub fn resolve_local(tz: Tz, naive: NaiveDateTime) -> DateTime<Utc> {
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt.with_timezone(&Utc),
        chrono::LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        chrono::LocalResult::None => {
            // Inside the gap: walk forward until the clock admits the time.
            let mut probe = naive;
            for _ in 0..4 {
                probe += chrono::Duration::minutes(30);
                if let Some(dt) = tz.from_local_datetime(&probe).earliest() {
                    return dt.with_timezone(&Utc);
                }
            }
            Utc.from_utc_datetime(&naive)
        }
    }
}

pub fn timezone_of(schedule: &Schedule) -> Tz {
    Tz::from_str(&schedule.timezone).unwrap_or(chrono_tz::UTC)
}

/// The earliest instant this schedule may fire for.
///
/// `created_at` is a hard floor: a schedule set up today with an anchor six
/// months back must not fire for every occurrence in between. What matters is
/// when you asked for the reminder, not when the series notionally began.
pub fn window_start(schedule: &Schedule) -> Option<DateTime<Utc>> {
    let created = schedule.created_at.as_str();
    [
        schedule.last_fired_at.as_deref(),
        schedule.last_checked_at.as_deref(),
        Some(created),
    ]
    .into_iter()
    .flatten()
    .filter_map(parse_ts)
    .max()
}
