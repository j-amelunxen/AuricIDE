use super::database::*;
use super::engine::*;
use super::types::*;
use chrono::{DateTime, Datelike, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use std::str::FromStr;

const DEDUPE_KEY_FIXTURE: &str =
    include_str!("../../../src/lib/conductor/scheduleDedupeKey.fixtures.json");

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
/// `upsert_impl` leaves `created_at` to the column default, which is the
/// real clock. A test that runs the scheduler at a fixed moment has to put
/// the row's own timestamps where the fixture says they are — otherwise the
/// due window starts today and nothing in the test's past can ever come
/// due, so the test passes only until the machine's date overtakes it.
fn seed(conn: &Connection, schedule: &Schedule) {
    upsert_impl(conn, schedule).expect("upsert");
    conn.execute(
        "UPDATE schedules SET created_at = ?2, last_checked_at = ?3 WHERE id = ?1",
        params![schedule.id, schedule.created_at, schedule.last_checked_at],
    )
    .expect("back-date the fixture");
}

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

// The helper is what takes the wall clock out of the runner's tests. If it
// ever stopped back-dating, they would all still pass today and start
// failing on some future date instead — the failure this whole seam exists
// to prevent.
#[test]
fn seeding_puts_the_fixtures_own_timestamps_in_the_row() {
    let conn = test_db();
    seed(&conn, &every_14_days());

    let stored = &list_impl(&conn).unwrap()[0];
    assert_eq!(stored.created_at, "2026-08-12 07:00:00");
    assert_eq!(
        stored.last_checked_at.as_deref(),
        Some("2026-08-12 07:00:00")
    );
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
    let preview = preview_impl(&every_14_days(), at("2026-08-12 07:00:00"), 3).expect("preview");

    assert_eq!(preview.len(), 3);
    assert!(preview[0].contains("26.08.2026"), "got {:?}", preview);
}

#[test]
fn running_due_schedules_raises_a_notification() {
    let mut conn = test_db();
    let mut schedule = every_14_days();
    schedule.payload = r#"{"title":"Security-Scan","severity":"warn","actions":[]}"#.to_string();
    seed(&conn, &schedule);

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
    seed(&conn, &every_14_days());

    run_due_impl(&mut conn, at("2026-08-27 07:00:00")).expect("run");

    let inbox = crate::notifications::list_impl(&conn, None, None, None).unwrap();
    assert_eq!(inbox[0].title, "Blogpost");
}

// The bookkeeping write is what stops a restart re-firing the same reminder.
#[test]
fn a_second_run_fires_nothing_new() {
    let mut conn = test_db();
    seed(&conn, &every_14_days());

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
    seed(&conn, &every_14_days());

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
    seed(&conn, &schedule);

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
    seed(&conn, &broken);
    seed(&conn, &every_14_days());

    assert_eq!(
        run_due_impl(&mut conn, at("2026-09-24 07:00:00")).unwrap(),
        1
    );
}

#[test]
fn running_records_the_next_due_time() {
    let mut conn = test_db();
    seed(&conn, &every_14_days());

    run_due_impl(&mut conn, at("2026-08-27 07:00:00")).expect("run");

    let stored = &list_impl(&conn).unwrap()[0];
    assert_eq!(stored.next_due_at.as_deref(), Some("2026-09-09 07:00:00"));
    assert_eq!(stored.last_fired_at.as_deref(), Some("2026-08-26 07:00:00"));
}
