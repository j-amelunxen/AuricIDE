//! Runs the shared goals-sync cases against the real `goals_sync_impl`. The
//! same file drives the TypeScript test port (`goalsSyncPort.test.ts`) that the
//! store's conflict tests stand on, so the two cannot drift apart unnoticed.

use super::*;
use crate::database::*;
use rusqlite::types::Value as SqlValue;
use serde_json::{Map, Value};

const FIXTURES: &str = include_str!("../../../../src/lib/store/goalsSync.fixtures.json");

fn merged(defaults: &Value, rows: Option<&Value>) -> Value {
    let rows = rows.and_then(Value::as_array).cloned().unwrap_or_default();
    Value::Array(
        rows.into_iter()
            .map(|row| {
                let mut out: Map<String, Value> = defaults.as_object().cloned().unwrap_or_default();
                out.extend(row.as_object().cloned().unwrap_or_default());
                Value::Object(out)
            })
            .collect(),
    )
}

fn payload_from(defaults: &Value, raw: &Value) -> GoalsSyncPayload {
    let mut out = raw.as_object().cloned().unwrap_or_default();
    out.insert("goals".into(), merged(&defaults["goal"], raw.get("goals")));
    out.insert(
        "goalRuns".into(),
        merged(&defaults["run"], raw.get("goalRuns")),
    );
    out.insert(
        "stations".into(),
        merged(&defaults["station"], raw.get("stations")),
    );
    out.insert(
        "baseGoals".into(),
        merged(&defaults["goal"], raw.get("baseGoals")),
    );
    out.insert(
        "baseGoalRuns".into(),
        merged(&defaults["run"], raw.get("baseGoalRuns")),
    );
    out.insert(
        "baseStations".into(),
        merged(&defaults["station"], raw.get("baseStations")),
    );
    out.entry("requirementLinks")
        .or_insert(Value::Array(vec![]));
    serde_json::from_value(Value::Object(out)).expect("fixture payload deserializes")
}

fn sql_value(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Number(n) => SqlValue::Integer(n.as_i64().expect("integer column")),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => panic!("unsupported fixture value {other}"),
    }
}

fn apply_concurrent(conn: &rusqlite::Connection, op: &Value) {
    let table = op["table"].as_str().unwrap();
    let id = op["id"].as_str().unwrap();
    if op.get("delete").and_then(Value::as_bool) == Some(true) {
        conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])
            .unwrap();
        return;
    }
    let set = op["set"].as_object().unwrap();
    let cols: Vec<&String> = set.keys().collect();
    let assignments: Vec<String> = cols.iter().map(|c| format!("{c} = ?")).collect();
    let mut values: Vec<SqlValue> = cols.iter().map(|c| sql_value(&set[*c])).collect();
    values.push(SqlValue::Text(id.to_string()));
    conn.execute(
        &format!("UPDATE {table} SET {} WHERE id = ?", assignments.join(", ")),
        rusqlite::params_from_iter(values),
    )
    .unwrap();
}

fn column(conn: &rusqlite::Connection, table: &str, id: &str, col: &str) -> Option<SqlValue> {
    conn.query_row(
        &format!("SELECT {col} FROM {table} WHERE id = ?1"),
        [id],
        |r| r.get(0),
    )
    .ok()
}

#[test]
fn goals_sync_matches_the_shared_cases() {
    let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
    let defaults = &fixtures["defaults"];
    for case in fixtures["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let conn = setup_in_memory_db();
        goals_sync_impl(&conn, &payload_from(defaults, &case["seed"])).unwrap();
        for op in case
            .get("concurrent")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            apply_concurrent(&conn, op);
        }
        let result = goals_sync_impl(&conn, &payload_from(defaults, &case["payload"])).unwrap();
        let conflicts = serde_json::to_value(&result.conflicts).unwrap();
        let want_conflicts = case
            .get("conflicts")
            .cloned()
            .unwrap_or(Value::Array(vec![]));
        assert_eq!(conflicts, want_conflicts, "{name}: conflicts");

        for (table, by_id) in case
            .get("expect")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            for (id, columns) in by_id.as_object().unwrap() {
                for (col, want) in columns.as_object().unwrap() {
                    let got = column(&conn, table, id, col);
                    assert_eq!(got, Some(sql_value(want)), "{name}: {table}/{id}.{col}");
                }
            }
        }
        for (table, ids) in case
            .get("absent")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            for id in ids.as_array().unwrap() {
                let id = id.as_str().unwrap();
                assert_eq!(
                    column(&conn, table, id, "id"),
                    None,
                    "{name}: {table}/{id} is gone"
                );
            }
        }
    }
}
