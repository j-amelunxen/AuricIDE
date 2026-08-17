//! Recurring reminders that survive the app being closed.
//!
//! This is not cron. Cron runs because the machine runs; AuricIDE does not.
//! A reminder due Wednesday 17:00 while the app was shut simply did not fire,
//! and the only useful thing left to do is notice on the next start and say so
//! — as *overdue*, not as fresh. That catch-up is the whole point of this
//! module; the expression parsing is the easy half.
//!
//! Schedules only ever raise a notification. Nothing here starts an agent on
//! its own: the entry lands in the inbox with a button, and a human presses it.
//!
//! Lives in the same app-global database as the inbox
//! (`src-tauri/src/notifications.rs`, migration 2).

use crate::database::apply_migration;
use crate::notifications::{dispatch_impl, NotificationInput};
use chrono::{DateTime, Days, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// How many missed occurrences `all` will replay. Beyond this the body says it
/// was capped rather than pretending the list is complete.
pub const MAX_CATCHUP: usize = 10;

/// Guards against a pathological walk — a five-minute schedule anchored years
/// back would otherwise iterate forever before the cap could apply.
const MAX_ITERATIONS: usize = 20_000;

/// SQLite's `datetime('now')` shape, which every timestamp here uses (UTC).
const TS_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

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
type Walk = (Vec<DateTime<Utc>>, Option<DateTime<Utc>>);

fn parse_ts(raw: &str) -> Option<DateTime<Utc>> {
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
fn resolve_local(tz: Tz, naive: NaiveDateTime) -> DateTime<Utc> {
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

fn timezone_of(schedule: &Schedule) -> Tz {
    Tz::from_str(&schedule.timezone).unwrap_or(chrono_tz::UTC)
}

/// The earliest instant this schedule may fire for.
///
/// `created_at` is a hard floor: a schedule set up today with an anchor six
/// months back must not fire for every occurrence in between. What matters is
/// when you asked for the reminder, not when the series notionally began.
fn window_start(schedule: &Schedule) -> Option<DateTime<Utc>> {
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

/// Walks a fixed interval, keeping the wall clock where the user put it.
///
/// Days and weeks step through the local calendar, not through 86 400 seconds:
/// "every 21 days at 09:00" stays 09:00 across a DST change. Hours step in real
/// time, because an hourly job means every hour that actually passes.
fn every_occurrences(
    schedule: &Schedule,
    tz: Tz,
    from: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Walk, String> {
    let n = schedule
        .every_n
        .filter(|n| *n > 0)
        .ok_or("every_n must be positive")?;
    let unit = schedule.every_unit.as_deref().unwrap_or("day");
    let anchor = schedule
        .anchor_at
        .as_deref()
        .and_then(parse_ts)
        .ok_or("anchor_at is required for an interval schedule")?;

    let mut due = Vec::new();
    let mut next_due = None;

    if unit == "hour" {
        let step = chrono::Duration::hours(n);
        let mut at = anchor;
        for _ in 0..MAX_ITERATIONS {
            if at > now {
                next_due = Some(at);
                break;
            }
            if at > from {
                due.push(at);
            }
            at += step;
        }
        return Ok((due, next_due));
    }

    let step_days = if unit == "week" { n * 7 } else { n } as u64;
    let anchor_local = anchor.with_timezone(&tz);
    let time = schedule
        .time_of_day
        .as_deref()
        .and_then(|raw| NaiveTime::parse_from_str(raw, "%H:%M").ok())
        .unwrap_or_else(|| anchor_local.time());
    let mut date = anchor_local.date_naive();

    for _ in 0..MAX_ITERATIONS {
        let at = resolve_local(tz, date.and_time(time));
        if at > now {
            next_due = Some(at);
            break;
        }
        if at > from {
            due.push(at);
        }
        date = match date.checked_add_days(Days::new(step_days)) {
            Some(next) => next,
            None => break,
        };
    }

    Ok((due, next_due))
}

fn cron_occurrences(
    schedule: &Schedule,
    tz: Tz,
    from: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Walk, String> {
    let expr = schedule
        .cron_expr
        .as_deref()
        .ok_or("cron_expr is required for a cron schedule")?;
    let parsed = cron::Schedule::from_str(&normalize_cron(expr))
        .map_err(|e| format!("Invalid cron expression \"{}\": {}", expr, e))?;

    let mut due = Vec::new();
    let mut next_due = None;

    for at in parsed.after(&from.with_timezone(&tz)).take(MAX_ITERATIONS) {
        let at_utc = at.with_timezone(&Utc);
        if at_utc > now {
            next_due = Some(at_utc);
            break;
        }
        due.push(at_utc);
    }

    Ok((due, next_due))
}

/// Everything this schedule owed between its last check and now.
///
/// Pure, with `now` passed in — a catch-up algorithm that reads the clock
/// itself can only be tested by waiting.
pub fn due_occurrences(schedule: &Schedule, now: DateTime<Utc>) -> Result<DueResult, String> {
    if !schedule.enabled {
        return Ok(DueResult {
            occurrences: Vec::new(),
            total: 0,
            next_due: None,
        });
    }

    let tz = timezone_of(schedule);
    let from = window_start(schedule).unwrap_or(now);

    let (all, next_due) = match schedule.spec_kind.as_str() {
        "cron" => cron_occurrences(schedule, tz, from, now)?,
        "every" => every_occurrences(schedule, tz, from, now)?,
        other => return Err(format!("Unknown schedule kind: {}", other)),
    };

    let total = all.len();
    let occurrences = match schedule.catch_up.as_str() {
        // Three weeks away must not produce three identical reminders; one that
        // says how overdue it is carries strictly more information.
        "coalesce" => all.last().copied().into_iter().collect(),
        "skip" => Vec::new(),
        _ => all.into_iter().take(MAX_CATCHUP).collect(),
    };

    Ok(DueResult {
        occurrences,
        total,
        next_due,
    })
}

/// The body text for a fired reminder, saying plainly how late it is.
pub fn overdue_body(base: Option<&str>, occurrence: DateTime<Utc>, total: usize, tz: Tz) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(text) = base.filter(|t| !t.trim().is_empty()) {
        parts.push(text.to_string());
    }

    if total > 1 {
        let local = occurrence.with_timezone(&tz);
        parts.push(format!(
            "Fällig seit {} · {} Termine verpasst",
            local.format("%a %d.%m. %H:%M"),
            total - 1
        ));
    }
    if total > MAX_CATCHUP {
        parts.push(format!("Nur die letzten {} werden gezeigt.", MAX_CATCHUP));
    }

    parts.join(" · ")
}

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    apply_migration(
        conn,
        2,
        "create_schedules",
        "CREATE TABLE schedules (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1,
            project_path    TEXT,
            project_name    TEXT,
            spec_kind       TEXT NOT NULL,
            cron_expr       TEXT,
            every_n         INTEGER,
            every_unit      TEXT,
            anchor_at       TEXT,
            time_of_day     TEXT,
            timezone        TEXT NOT NULL DEFAULT 'UTC',
            catch_up        TEXT NOT NULL DEFAULT 'coalesce',
            payload         TEXT NOT NULL DEFAULT '{}',
            last_fired_at   TEXT,
            last_checked_at TEXT,
            next_due_at     TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX schedules_enabled ON schedules(enabled, next_due_at);",
    )
}

const SELECT_COLUMNS: &str =
    "id, name, enabled, project_path, project_name, spec_kind, cron_expr, \
     every_n, every_unit, anchor_at, time_of_day, timezone, catch_up, payload, \
     last_fired_at, last_checked_at, next_due_at, created_at, updated_at";

fn row_to_schedule(row: &rusqlite::Row) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: row.get(0)?,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        project_path: row.get(3)?,
        project_name: row.get(4)?,
        spec_kind: row.get(5)?,
        cron_expr: row.get(6)?,
        every_n: row.get(7)?,
        every_unit: row.get(8)?,
        anchor_at: row.get(9)?,
        time_of_day: row.get(10)?,
        timezone: row.get(11)?,
        catch_up: row.get(12)?,
        payload: row.get(13)?,
        last_fired_at: row.get(14)?,
        last_checked_at: row.get(15)?,
        next_due_at: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

pub fn list_impl(conn: &Connection) -> Result<Vec<Schedule>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM schedules ORDER BY name COLLATE NOCASE",
            SELECT_COLUMNS
        ))
        .map_err(|e| format!("Failed to prepare schedules query: {}", e))?;

    let schedules = stmt
        .query_map([], row_to_schedule)
        .map_err(|e| format!("Failed to query schedules: {}", e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read schedules: {}", e))?;

    Ok(schedules)
}

pub fn upsert_impl(conn: &Connection, schedule: &Schedule) -> Result<Schedule, String> {
    conn.execute(
        "INSERT INTO schedules
            (id, name, enabled, project_path, project_name, spec_kind, cron_expr, every_n,
             every_unit, anchor_at, time_of_day, timezone, catch_up, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            enabled = excluded.enabled,
            project_path = excluded.project_path,
            project_name = excluded.project_name,
            spec_kind = excluded.spec_kind,
            cron_expr = excluded.cron_expr,
            every_n = excluded.every_n,
            every_unit = excluded.every_unit,
            anchor_at = excluded.anchor_at,
            time_of_day = excluded.time_of_day,
            timezone = excluded.timezone,
            catch_up = excluded.catch_up,
            payload = excluded.payload,
            updated_at = datetime('now')",
        params![
            schedule.id,
            schedule.name,
            schedule.enabled as i64,
            schedule.project_path,
            schedule.project_name,
            schedule.spec_kind,
            schedule.cron_expr,
            schedule.every_n,
            schedule.every_unit,
            schedule.anchor_at,
            schedule.time_of_day,
            schedule.timezone,
            schedule.catch_up,
            schedule.payload,
        ],
    )
    .map_err(|e| format!("Failed to save schedule: {}", e))?;

    conn.query_row(
        &format!("SELECT {} FROM schedules WHERE id = ?1", SELECT_COLUMNS),
        params![schedule.id],
        row_to_schedule,
    )
    .map_err(|e| format!("Failed to read back schedule: {}", e))
}

pub fn delete_impl(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM schedules WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete schedule: {}", e))?;
    Ok(())
}

pub fn set_enabled_impl(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    // Re-arming also resets the check mark: switching a schedule back on is not
    // a request to be told about everything that happened while it was off.
    conn.execute(
        "UPDATE schedules
         SET enabled = ?2,
             last_checked_at = CASE WHEN ?2 = 1 THEN datetime('now') ELSE last_checked_at END,
             updated_at = datetime('now')
         WHERE id = ?1",
        params![id, enabled as i64],
    )
    .map_err(|e| format!("Failed to toggle schedule: {}", e))?;
    Ok(())
}

/// The next few occurrences, for the editor's preview. A schedule you only
/// discover is wrong three weeks later is a trap.
pub fn preview_impl(
    schedule: &Schedule,
    now: DateTime<Utc>,
    count: usize,
) -> Result<Vec<String>, String> {
    let tz = timezone_of(schedule);
    let mut probe = schedule.clone();
    // Preview looks forward from now, whatever the stored bookkeeping says.
    probe.last_fired_at = None;
    probe.last_checked_at = Some(format_ts(now));
    probe.created_at = format_ts(now);
    probe.enabled = true;

    let mut out = Vec::new();
    let mut at = now;
    for _ in 0..count {
        let result = due_occurrences(&probe, at)?;
        match result.next_due {
            Some(next) => {
                out.push(
                    next.with_timezone(&tz)
                        .format("%a %d.%m.%Y %H:%M")
                        .to_string(),
                );
                at = next;
                probe.last_checked_at = Some(format_ts(next));
            }
            None => break,
        }
    }

    Ok(out)
}

/// Fires everything that is due and records that it happened.
///
/// Returns how many notifications were raised. The dedupe key carries the
/// occurrence, so a crash between the dispatch and the bookkeeping write
/// replaces the same row on the next run instead of creating a second.
/// The dedupe key a fired schedule stamps on its notification.
///
/// The frontend reads the occurrence back out of this key (`scheduleOccurrenceMs`
/// in `src/lib/conductor/scheduledRun.ts`) to decide whether an automatic
/// conductor start is still fresh, so the format is a contract: both sides are
/// tested against `src/lib/conductor/scheduleDedupeKey.fixtures.json`. The
/// occurrence is written in UTC — a local-time stamp here would read as hours
/// stale over there and turn every automatic start into a button.
pub fn schedule_dedupe_key(schedule_id: &str, occurrence: DateTime<Utc>) -> String {
    format!("schedule:{}:{}", schedule_id, format_ts(occurrence))
}

pub fn run_due_impl(conn: &mut Connection, now: DateTime<Utc>) -> Result<usize, String> {
    let schedules = list_impl(conn)?;
    let mut fired = 0;

    for schedule in schedules {
        if !schedule.enabled {
            continue;
        }
        let result = match due_occurrences(&schedule, now) {
            Ok(result) => result,
            // One broken expression must not stop every other schedule.
            Err(error) => {
                eprintln!("Schedule \"{}\" is not runnable: {}", schedule.name, error);
                continue;
            }
        };

        let tz = timezone_of(&schedule);
        let template: serde_json::Value =
            serde_json::from_str(&schedule.payload).unwrap_or_else(|_| serde_json::json!({}));

        for occurrence in &result.occurrences {
            let title = template
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(schedule.name.as_str())
                .to_string();
            let body = overdue_body(
                template.get("body").and_then(|v| v.as_str()),
                *occurrence,
                result.total,
                tz,
            );

            let input = NotificationInput {
                uid: None,
                project_path: schedule.project_path.clone(),
                project_name: schedule.project_name.clone(),
                source: "system".to_string(),
                origin: Some(schedule.name.clone()),
                kind: Some("info".to_string()),
                severity: Some(
                    template
                        .get("severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("info")
                        .to_string(),
                ),
                title,
                body: if body.is_empty() { None } else { Some(body) },
                actions: template.get("actions").cloned(),
                dedupe_key: Some(schedule_dedupe_key(&schedule.id, *occurrence)),
                ref_kind: None,
                ref_id: None,
                expires_at: None,
            };

            dispatch_impl(conn, &input)?;
            fired += 1;
        }

        let last_fired = result
            .occurrences
            .last()
            .copied()
            .map(format_ts)
            .or_else(|| schedule.last_fired_at.clone());

        conn.execute(
            "UPDATE schedules
             SET last_checked_at = ?2, last_fired_at = ?3, next_due_at = ?4
             WHERE id = ?1",
            params![
                schedule.id,
                format_ts(now),
                last_fired,
                result.next_due.map(format_ts),
            ],
        )
        .map_err(|e| format!("Failed to record schedule run: {}", e))?;
    }

    Ok(fired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    const DEDUPE_KEY_FIXTURE: &str =
        include_str!("../../src/lib/conductor/scheduleDedupeKey.fixtures.json");

    #[test]
    fn dedupe_key_matches_the_shared_fixture_the_frontend_parses() {
        let fixture: serde_json::Value = serde_json::from_str(DEDUPE_KEY_FIXTURE).unwrap();
        let schedule_id = fixture["scheduleId"].as_str().unwrap();
        let occurrence = parse_ts(fixture["occurrenceUtc"].as_str().unwrap()).unwrap();
        assert_eq!(
            occurrence.timestamp_millis(),
            fixture["occurrenceMs"].as_i64().unwrap()
        );
        assert_eq!(
            schedule_dedupe_key(schedule_id, occurrence),
            fixture["dedupeKey"].as_str().unwrap()
        );
    }

    fn at(raw: &str) -> DateTime<Utc> {
        parse_ts(raw).expect("timestamp")
    }

    /// "Every 14 days at 09:00 Berlin", created and anchored 2026-08-12.
    fn every_14_days() -> Schedule {
        Schedule {
            id: "s1".into(),
            name: "Blogpost".into(),
            enabled: true,
            project_path: None,
            project_name: None,
            spec_kind: "every".into(),
            cron_expr: None,
            every_n: Some(14),
            every_unit: Some("day".into()),
            anchor_at: Some("2026-08-12 07:00:00".into()), // 09:00 Berlin (CEST)
            time_of_day: Some("09:00".into()),
            timezone: "Europe/Berlin".into(),
            catch_up: "coalesce".into(),
            payload: "{}".into(),
            last_fired_at: None,
            last_checked_at: Some("2026-08-12 07:00:00".into()),
            next_due_at: None,
            created_at: "2026-08-12 07:00:00".into(),
            updated_at: "2026-08-12 07:00:00".into(),
        }
    }

    fn weekly_wednesday() -> Schedule {
        Schedule {
            spec_kind: "cron".into(),
            cron_expr: Some("0 0 17 * * WED".into()),
            every_n: None,
            every_unit: None,
            anchor_at: None,
            time_of_day: None,
            ..every_14_days()
        }
    }

    #[test]
    fn normalize_cron_adds_the_seconds_field_the_crate_wants() {
        assert_eq!(normalize_cron("0 17 * * 3"), "0 0 17 * * 3");
    }

    #[test]
    fn normalize_cron_leaves_a_six_field_expression_alone() {
        assert_eq!(normalize_cron("0 0 17 * * WED"), "0 0 17 * * WED");
    }

    #[test]
    fn a_five_field_expression_parses_after_normalising() {
        assert!(cron::Schedule::from_str(&normalize_cron("0 17 * * WED")).is_ok());
    }

    // Three weeks away on a 14-day schedule: one reminder, not two identical ones.
    #[test]
    fn coalesce_folds_missed_occurrences_into_one() {
        let schedule = every_14_days();
        let result = due_occurrences(&schedule, at("2026-09-24 07:00:00")).unwrap();

        assert_eq!(result.occurrences.len(), 1);
        assert_eq!(result.total, 3);
        assert_eq!(format_ts(result.occurrences[0]), "2026-09-23 07:00:00");
    }

    #[test]
    fn all_replays_every_missed_occurrence_oldest_first() {
        let mut schedule = every_14_days();
        schedule.catch_up = "all".into();

        let result = due_occurrences(&schedule, at("2026-09-24 07:00:00")).unwrap();

        assert_eq!(result.occurrences.len(), 3);
        assert!(result.occurrences[0] < result.occurrences[2]);
    }

    #[test]
    fn skip_fires_nothing_but_still_knows_what_is_next() {
        let mut schedule = every_14_days();
        schedule.catch_up = "skip".into();

        let result = due_occurrences(&schedule, at("2026-09-24 07:00:00")).unwrap();

        assert!(result.occurrences.is_empty());
        assert!(result.next_due.is_some());
    }

    // The floor that stops a new schedule replaying the last six months.
    #[test]
    fn a_new_schedule_never_fires_for_occurrences_before_it_existed() {
        let mut schedule = every_14_days();
        schedule.anchor_at = Some("2026-02-01 08:00:00".into());
        schedule.created_at = "2026-08-12 07:00:00".into();
        schedule.last_checked_at = Some("2026-08-12 07:00:00".into());

        let result = due_occurrences(&schedule, at("2026-08-13 07:00:00")).unwrap();

        assert_eq!(result.total, 0);
    }

    #[test]
    fn nothing_is_due_before_the_first_occurrence() {
        let schedule = every_14_days();
        let result = due_occurrences(&schedule, at("2026-08-20 07:00:00")).unwrap();

        assert_eq!(result.total, 0);
        assert_eq!(format_ts(result.next_due.unwrap()), "2026-08-26 07:00:00");
    }

    #[test]
    fn a_disabled_schedule_owes_nothing() {
        let mut schedule = every_14_days();
        schedule.enabled = false;

        let result = due_occurrences(&schedule, at("2026-12-01 07:00:00")).unwrap();

        assert!(result.occurrences.is_empty());
        assert_eq!(result.total, 0);
    }

    // The reason the timezone is stored per schedule: 09:00 must stay 09:00
    // when Berlin leaves summer time, not drift to 08:00 or 10:00.
    #[test]
    fn a_daily_time_survives_the_end_of_summer_time() {
        let mut schedule = every_14_days();
        schedule.every_n = Some(1);
        schedule.catch_up = "all".into();
        // Berlin returns to CET on 2026-10-25.
        schedule.anchor_at = Some("2026-10-23 07:00:00".into());
        schedule.created_at = "2026-10-23 06:00:00".into();
        schedule.last_checked_at = Some("2026-10-23 06:00:00".into());

        let result = due_occurrences(&schedule, at("2026-10-27 12:00:00")).unwrap();

        let tz = Tz::from_str("Europe/Berlin").unwrap();
        for occurrence in &result.occurrences {
            assert_eq!(
                occurrence.with_timezone(&tz).format("%H:%M").to_string(),
                "09:00",
                "occurrence {} drifted",
                occurrence
            );
        }
        // And the UTC offset really did change across the boundary.
        assert_eq!(format_ts(result.occurrences[0]), "2026-10-23 07:00:00");
        assert_eq!(
            format_ts(*result.occurrences.last().unwrap()),
            "2026-10-27 08:00:00"
        );
    }

    #[test]
    fn a_weekly_cron_lands_on_the_named_weekday() {
        let schedule = weekly_wednesday();
        let result = due_occurrences(&schedule, at("2026-08-20 12:00:00")).unwrap();

        let tz = Tz::from_str("Europe/Berlin").unwrap();
        let local = result.occurrences[0].with_timezone(&tz);
        assert_eq!(local.weekday(), chrono::Weekday::Wed);
        assert_eq!(local.format("%H:%M").to_string(), "17:00");
    }

    #[test]
    fn an_unparseable_cron_expression_is_reported_not_ignored() {
        let mut schedule = weekly_wednesday();
        schedule.cron_expr = Some("not a cron".into());

        assert!(due_occurrences(&schedule, at("2026-08-20 12:00:00")).is_err());
    }

    #[test]
    fn an_hourly_interval_steps_in_real_time() {
        let mut schedule = every_14_days();
        schedule.every_unit = Some("hour".into());
        schedule.every_n = Some(6);
        schedule.catch_up = "all".into();

        let result = due_occurrences(&schedule, at("2026-08-13 07:00:00")).unwrap();

        assert_eq!(result.total, 4);
    }

    #[test]
    fn all_caps_the_replay_but_still_reports_the_true_count() {
        let mut schedule = every_14_days();
        schedule.every_unit = Some("hour".into());
        schedule.every_n = Some(1);
        schedule.catch_up = "all".into();

        let result = due_occurrences(&schedule, at("2026-08-14 07:00:00")).unwrap();

        assert_eq!(result.occurrences.len(), MAX_CATCHUP);
        assert_eq!(result.total, 48);
    }

    #[test]
    fn overdue_body_stays_quiet_for_a_punctual_reminder() {
        let tz = Tz::from_str("Europe/Berlin").unwrap();
        assert_eq!(
            overdue_body(Some("Scan fällig"), at("2026-08-12 07:00:00"), 1, tz),
            "Scan fällig"
        );
    }

    #[test]
    fn overdue_body_says_how_late_and_how_many_were_missed() {
        let tz = Tz::from_str("Europe/Berlin").unwrap();
        let body = overdue_body(None, at("2026-09-23 07:00:00"), 3, tz);

        assert!(body.contains("Fällig seit"));
        assert!(body.contains("2 Termine verpasst"), "body was {body}");
    }

    #[test]
    fn overdue_body_admits_when_the_replay_was_capped() {
        let tz = Tz::from_str("Europe/Berlin").unwrap();
        let body = overdue_body(None, at("2026-09-23 07:00:00"), 48, tz);

        assert!(body.contains("Nur die letzten"));
    }

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("db");
        crate::notifications::run_migrations(&conn).expect("notifications");
        run_migrations(&conn).expect("schedules");
        conn
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = test_db();
        run_migrations(&conn).expect("second run");
        assert_eq!(list_impl(&conn).unwrap().len(), 0);
    }

    #[test]
    fn a_schedule_round_trips() {
        let conn = test_db();
        let stored = upsert_impl(&conn, &every_14_days()).expect("upsert");

        assert_eq!(stored.name, "Blogpost");
        assert!(stored.enabled);
        assert_eq!(list_impl(&conn).unwrap().len(), 1);
    }

    #[test]
    fn upsert_updates_rather_than_duplicating() {
        let conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("first");
        let mut changed = every_14_days();
        changed.name = "Newsletter".into();
        upsert_impl(&conn, &changed).expect("second");

        let all = list_impl(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Newsletter");
    }

    #[test]
    fn deleting_removes_the_schedule() {
        let conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");
        delete_impl(&conn, "s1").expect("delete");

        assert!(list_impl(&conn).unwrap().is_empty());
    }

    // Switching a schedule back on is not a request to hear about everything
    // that happened while it was off.
    #[test]
    fn re_enabling_moves_the_check_mark_to_now() {
        let conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");
        set_enabled_impl(&conn, "s1", false).expect("off");
        set_enabled_impl(&conn, "s1", true).expect("on");

        let stored = &list_impl(&conn).unwrap()[0];
        assert!(stored.enabled);
        assert_ne!(
            stored.last_checked_at.as_deref(),
            Some("2026-08-12 07:00:00")
        );
    }

    #[test]
    fn preview_lists_the_next_occurrences() {
        let preview =
            preview_impl(&every_14_days(), at("2026-08-12 07:00:00"), 3).expect("preview");

        assert_eq!(preview.len(), 3);
        assert!(preview[0].contains("26.08.2026"), "got {:?}", preview);
    }

    #[test]
    fn running_due_schedules_raises_a_notification() {
        let mut conn = test_db();
        let mut schedule = every_14_days();
        schedule.payload =
            r#"{"title":"Security-Scan","severity":"warn","actions":[]}"#.to_string();
        upsert_impl(&conn, &schedule).expect("upsert");

        let fired = run_due_impl(&mut conn, at("2026-09-24 07:00:00")).expect("run");

        assert_eq!(fired, 1);
        let inbox = crate::notifications::list_impl(&conn, None, None, None).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].title, "Security-Scan");
        assert_eq!(inbox[0].severity, "warn");
        assert!(inbox[0].body.as_deref().unwrap().contains("verpasst"));
    }

    #[test]
    fn a_schedule_without_a_payload_title_falls_back_to_its_name() {
        let mut conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");

        run_due_impl(&mut conn, at("2026-08-27 07:00:00")).expect("run");

        let inbox = crate::notifications::list_impl(&conn, None, None, None).unwrap();
        assert_eq!(inbox[0].title, "Blogpost");
    }

    // The bookkeeping write is what stops a restart re-firing the same reminder.
    #[test]
    fn a_second_run_fires_nothing_new() {
        let mut conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");

        assert_eq!(
            run_due_impl(&mut conn, at("2026-09-24 07:00:00")).unwrap(),
            1
        );
        assert_eq!(
            run_due_impl(&mut conn, at("2026-09-24 07:00:00")).unwrap(),
            0
        );
        assert_eq!(
            crate::notifications::list_impl(&conn, None, None, None)
                .unwrap()
                .len(),
            1
        );
    }

    // Belt and braces: even if the bookkeeping never landed, the occurrence in
    // the dedupe key means a re-run replaces the row instead of adding one.
    #[test]
    fn a_crash_before_the_bookkeeping_cannot_double_the_reminder() {
        let mut conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");

        run_due_impl(&mut conn, at("2026-09-24 07:00:00")).expect("first");
        conn.execute(
            "UPDATE schedules SET last_fired_at = NULL, last_checked_at = ?1",
            params!["2026-08-12 07:00:00"],
        )
        .unwrap();
        run_due_impl(&mut conn, at("2026-09-24 07:00:00")).expect("second");

        assert_eq!(
            crate::notifications::list_impl(&conn, None, None, None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn a_disabled_schedule_is_skipped_by_the_runner() {
        let mut conn = test_db();
        let mut schedule = every_14_days();
        schedule.enabled = false;
        upsert_impl(&conn, &schedule).expect("upsert");

        assert_eq!(
            run_due_impl(&mut conn, at("2026-09-24 07:00:00")).unwrap(),
            0
        );
    }

    // One broken schedule must not take the others down with it.
    #[test]
    fn a_broken_schedule_does_not_stop_the_others() {
        let mut conn = test_db();
        let mut broken = weekly_wednesday();
        broken.id = "broken".into();
        broken.cron_expr = Some("nonsense".into());
        upsert_impl(&conn, &broken).expect("broken");
        upsert_impl(&conn, &every_14_days()).expect("good");

        assert_eq!(
            run_due_impl(&mut conn, at("2026-09-24 07:00:00")).unwrap(),
            1
        );
    }

    #[test]
    fn running_records_the_next_due_time() {
        let mut conn = test_db();
        upsert_impl(&conn, &every_14_days()).expect("upsert");

        run_due_impl(&mut conn, at("2026-08-27 07:00:00")).expect("run");

        let stored = &list_impl(&conn).unwrap()[0];
        assert_eq!(stored.next_due_at.as_deref(), Some("2026-09-09 07:00:00"));
        assert_eq!(stored.last_fired_at.as_deref(), Some("2026-08-26 07:00:00"));
    }
}
