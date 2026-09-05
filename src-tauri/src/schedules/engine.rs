use super::types::*;
use chrono::{DateTime, Days, NaiveTime, Utc};
use chrono_tz::Tz;
use std::str::FromStr;

/// Walks a fixed interval, keeping the wall clock where the user put it.
///
/// Days and weeks step through the local calendar, not through 86 400 seconds:
/// "every 21 days at 09:00" stays 09:00 across a DST change. Hours step in real
/// time, because an hourly job means every hour that actually passes.
pub fn every_occurrences(
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

pub fn cron_occurrences(
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
