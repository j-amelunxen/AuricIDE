use super::{
    prepare_impl, publish_impl, CreateMissionInput, CreatedMissionWithSchedule, MissionRecurrence,
};
use crate::schedules::{self, Schedule};
use chrono::Utc;
use rusqlite::Connection;

fn valid_time(raw: &str) -> Result<(), String> {
    chrono::NaiveTime::parse_from_str(raw, "%H:%M")
        .map(|_| ())
        .map_err(|_| "Mission time must use HH:MM".to_string())
}

pub fn build_schedule(
    input: &CreateMissionInput,
    mission: &super::CreatedMission,
    now: chrono::DateTime<Utc>,
) -> Result<Schedule, String> {
    if input.timezone.parse::<chrono_tz::Tz>().is_err() {
        return Err("Mission timezone must be an IANA timezone".to_string());
    }
    let created_at = schedules::format_ts(now);
    let (spec_kind, cron_expr, every_n, every_unit, anchor_at, time_of_day) =
        match &input.recurrence {
            MissionRecurrence::Daily { time_of_day } => {
                valid_time(time_of_day)?;
                let mut parts = time_of_day.split(':');
                let hour = parts.next().unwrap();
                let minute = parts.next().unwrap();
                (
                    "cron".into(),
                    Some(format!("0 {minute} {hour} * * *")),
                    None,
                    None,
                    None,
                    Some(time_of_day.clone()),
                )
            }
            MissionRecurrence::Weekly {
                weekday,
                time_of_day,
            } => {
                valid_time(time_of_day)?;
                if *weekday > 6 {
                    return Err("Mission weekday must be between 0 and 6".to_string());
                }
                let mut parts = time_of_day.split(':');
                let hour = parts.next().unwrap();
                let minute = parts.next().unwrap();
                (
                    "cron".into(),
                    Some(format!("0 {minute} {hour} * * {weekday}")),
                    None,
                    None,
                    None,
                    Some(time_of_day.clone()),
                )
            }
            MissionRecurrence::Interval {
                every_n,
                every_unit,
                time_of_day,
            } => {
                if *every_n < 1 || !matches!(every_unit.as_str(), "hour" | "day" | "week") {
                    return Err("Mission interval is invalid".to_string());
                }
                if let Some(time) = time_of_day {
                    valid_time(time)?;
                }
                (
                    "every".into(),
                    None,
                    Some(*every_n),
                    Some(every_unit.clone()),
                    Some(created_at.clone()),
                    if every_unit == "hour" {
                        None
                    } else {
                        Some(time_of_day.clone().unwrap_or_else(|| "09:00".into()))
                    },
                )
            }
        };

    Ok(Schedule {
        id: mission.schedule_id.clone(),
        name: mission.name.clone(),
        enabled: true,
        project_path: std::path::Path::new(&mission.path)
            .ancestors()
            .nth(3)
            .map(|path| path.to_string_lossy().to_string())
            .or_else(|| Some(input.project_path.clone())),
        project_name: input.project_name.clone(),
        mission_slug: Some(mission.slug.clone()),
        spec_kind,
        cron_expr,
        every_n,
        every_unit,
        anchor_at,
        time_of_day,
        timezone: input.timezone.clone(),
        catch_up: "coalesce".into(),
        payload: serde_json::json!({ "title": mission.name }).to_string(),
        last_fired_at: None,
        last_checked_at: Some(created_at.clone()),
        next_due_at: None,
        created_at: created_at.clone(),
        updated_at: created_at,
    })
}

/// Creates a disabled schedule before publishing the scaffold, then arms it.
/// Cross-store crashes therefore degrade to a repairable disabled schedule or
/// a complete-but-disabled mission; compensation never recursively deletes a
/// published filesystem path that another process could have replaced.
pub fn create_with_schedule_impl(
    conn: &Connection,
    input: &CreateMissionInput,
    now: chrono::DateTime<Utc>,
) -> Result<CreatedMissionWithSchedule, String> {
    // Validate recurrence before touching disk.
    let prospective = super::CreatedMission {
        name: input.name.trim().to_string(),
        slug: super::derive_slug(&input.name),
        path: String::new(),
        schedule_id: super::deterministic_schedule_id(
            &input.project_path,
            &super::derive_slug(&input.name),
        ),
    };
    build_schedule(input, &prospective, now)?;

    let prepared = prepare_impl(input)?;
    let mission = prepared.mission.clone();
    let mut schedule = build_schedule(input, &mission, now)?;
    if schedules::list_impl(conn)?
        .iter()
        .any(|existing| existing.id == schedule.id)
    {
        return Err("A schedule already exists for this mission identity".to_string());
    }
    schedule.enabled = false;
    conn.unchecked_transaction()
        .map_err(|error| format!("Failed to begin mission schedule transaction: {error}"))
        .and_then(|tx| {
            schedules::upsert_impl(&tx, &schedule)?;
            tx.commit()
                .map_err(|error| format!("Failed to commit mission schedule: {error}"))?;
            Ok(())
        })?;

    if let Err(error) = publish_impl(prepared) {
        return match schedules::delete_impl(conn, &schedule.id) {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(format!(
                "{error}; additionally failed to remove the disabled schedule: {cleanup_error}"
            )),
        };
    }

    schedules::set_enabled_impl(conn, &schedule.id, true).map_err(|error| {
        format!("Mission scaffold was created, but its schedule remains disabled: {error}")
    })?;
    let stored = schedules::list_impl(conn)?
        .into_iter()
        .find(|candidate| candidate.id == schedule.id)
        .ok_or_else(|| "Mission schedule disappeared after creation".to_string())?;
    Ok(CreatedMissionWithSchedule {
        mission,
        schedule: stored,
    })
}
