use super::engine::{due_occurrences, overdue_body, schedule_dedupe_key};
use super::types::{format_ts, timezone_of, Schedule};
use crate::database::apply_migration;
use crate::notifications::{dispatch_impl, NotificationInput};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};

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
    )?;
    apply_migration(
        conn,
        4,
        "link_schedules_to_missions",
        "ALTER TABLE schedules ADD COLUMN mission_slug TEXT;\n\
         CREATE INDEX schedules_mission ON schedules(project_path, mission_slug);",
    )
}

pub const SELECT_COLUMNS: &str =
    "id, name, enabled, project_path, project_name, mission_slug, spec_kind, cron_expr, \
     every_n, every_unit, anchor_at, time_of_day, timezone, catch_up, payload, \
     last_fired_at, last_checked_at, next_due_at, created_at, updated_at";

pub fn row_to_schedule(row: &rusqlite::Row) -> rusqlite::Result<Schedule> {
    Ok(Schedule {
        id: row.get(0)?,
        name: row.get(1)?,
        enabled: row.get::<_, i64>(2)? != 0,
        project_path: row.get(3)?,
        project_name: row.get(4)?,
        mission_slug: row.get(5)?,
        spec_kind: row.get(6)?,
        cron_expr: row.get(7)?,
        every_n: row.get(8)?,
        every_unit: row.get(9)?,
        anchor_at: row.get(10)?,
        time_of_day: row.get(11)?,
        timezone: row.get(12)?,
        catch_up: row.get(13)?,
        payload: row.get(14)?,
        last_fired_at: row.get(15)?,
        last_checked_at: row.get(16)?,
        next_due_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
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

fn valid_mission_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 64
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_unsafe_directory(path: &std::path::Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => !metadata.is_dir() || metadata.file_type().is_symlink(),
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

fn is_real_file(path: &std::path::Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

pub fn upsert_impl(conn: &Connection, schedule: &Schedule) -> Result<Schedule, String> {
    if let Some(slug) = schedule.mission_slug.as_deref() {
        if !valid_mission_slug(slug) {
            return Err("Mission slug must be one canonical path component".to_string());
        }
    }
    conn.execute(
        "INSERT INTO schedules
            (id, name, enabled, project_path, project_name, mission_slug, spec_kind, cron_expr, every_n,
             every_unit, anchor_at, time_of_day, timezone, catch_up, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            enabled = excluded.enabled,
            project_path = excluded.project_path,
            project_name = excluded.project_name,
            mission_slug = excluded.mission_slug,
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
            schedule.mission_slug,
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

/// Generic schedule editing may preserve an app-created mission link, but may
/// not mint, replace, or remove that auto-launch authority.
pub fn validate_mission_link_edit(
    existing: Option<&Schedule>,
    proposed: &Schedule,
) -> Result<(), String> {
    let existing_slug = existing.and_then(|schedule| schedule.mission_slug.as_deref());
    if existing_slug == proposed.mission_slug.as_deref() {
        return Ok(());
    }
    Err("Mission links can only be created by the Mission workflow".to_string())
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
        let mission_error = schedule
            .mission_slug
            .as_ref()
            .and_then(|slug| {
                if !valid_mission_slug(slug) {
                    return Some(format!("Mission `{slug}` has an invalid path identifier."));
                }
                let root = schedule.project_path.as_ref()?;
                let auric = std::path::Path::new(root).join(".auric");
                let missions = auric.join("missions");
                let directory = missions.join(slug);
                if is_unsafe_directory(&auric)
                    || is_unsafe_directory(&missions)
                    || is_unsafe_directory(&directory)
                {
                    return Some(format!(
                        "Mission `{slug}` cannot run because its path is missing or unsafe."
                    ));
                }
                let missing: Vec<&str> = ["MISSION.md", "STATE.md"]
                    .into_iter()
                    .filter(|name| !is_real_file(&directory.join(name)))
                    .collect();
                (!missing.is_empty()).then(|| {
                    format!(
                        "Mission `{slug}` cannot run because {} is missing.",
                        missing.join(" and ")
                    )
                })
            })
            .or_else(|| {
                schedule
                    .mission_slug
                    .as_ref()
                    .filter(|_| schedule.project_path.is_none())
                    .map(|slug| {
                        format!("Mission `{slug}` cannot run because its project path is missing.")
                    })
            });

        for occurrence in &result.occurrences {
            let title = mission_error.as_ref().map_or_else(
                || {
                    template
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or(schedule.name.as_str())
                        .to_string()
                },
                |_| format!("Mission unavailable: {}", schedule.name),
            );
            let body = mission_error.clone().unwrap_or_else(|| {
                overdue_body(
                    template.get("body").and_then(|v| v.as_str()),
                    *occurrence,
                    result.total,
                    tz,
                )
            });

            let mission_action = schedule.mission_slug.as_ref().and_then(|slug| {
                schedule.project_path.as_ref().map(|repo_path| serde_json::json!([{
                    "id": "run-mission",
                    "label": "Run mission",
                    "kind": "spawn-agent",
                    "task": format!(
                        "Run mission `{slug}`. Read `.auric/missions/{slug}/MISSION.md` and `.auric/missions/{slug}/STATE.md`, execute the next useful step, and update STATE.md with durable progress before finishing."
                    ),
                    "repoPath": repo_path,
                    "permissionMode": "acceptEdits",
                    "launch": "auto",
                    "headless": true
                }]))
            });

            let input = NotificationInput {
                uid: None,
                project_path: schedule.project_path.clone(),
                project_name: schedule.project_name.clone(),
                source: "system".to_string(),
                origin: Some(schedule.name.clone()),
                kind: Some("info".to_string()),
                severity: Some(if mission_error.is_some() {
                    "error".to_string()
                } else {
                    template
                        .get("severity")
                        .and_then(|v| v.as_str())
                        .unwrap_or("info")
                        .to_string()
                }),
                title,
                body: if body.is_empty() { None } else { Some(body) },
                actions: if mission_error.is_some() {
                    Some(serde_json::json!([]))
                } else {
                    mission_action.or_else(|| template.get("actions").cloned())
                },
                dedupe_key: Some(schedule_dedupe_key(&schedule.id, *occurrence)),
                ref_kind: schedule
                    .mission_slug
                    .as_ref()
                    .map(|_| "mission".to_string()),
                ref_id: schedule.mission_slug.clone(),
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
