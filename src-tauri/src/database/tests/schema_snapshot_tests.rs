//! Fresh databases against the schemas the IDE and the MCP server share
//! (`src/mcp/dbSchemas.fixtures.json`, also read by the MCP server's tests).

use rusqlite::Connection;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../../src/mcp/dbSchemas.fixtures.json")).unwrap()
}

fn objects_of(conn: &Connection) -> serde_json::Value {
    let mut statement = conn
        .prepare(
            "SELECT type, name, sql FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .unwrap();
    let objects: Vec<serde_json::Value> = statement
        .query_map([], |row| {
            let sql: Option<String> = row.get(2)?;
            Ok(serde_json::json!({
                "type": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "sql": sql.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" "),
            }))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    serde_json::Value::Array(objects)
}

#[test]
fn a_fresh_project_database_has_the_shared_schema() {
    let dir = tempfile::tempdir().unwrap();
    let conn = crate::database::init_db(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(objects_of(&conn), fixture()["project"]["objects"]);
}

#[test]
fn a_fresh_notifications_database_has_the_shared_schema() {
    let dir = tempfile::tempdir().unwrap();
    let conn = crate::notifications::init_db(&dir.path().join("notifications.db")).unwrap();
    assert_eq!(objects_of(&conn), fixture()["notifications"]["objects"]);
}
