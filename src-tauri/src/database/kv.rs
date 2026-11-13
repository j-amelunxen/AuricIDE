use super::types::{DatabaseState, KvEntry};
use rusqlite::{params, Connection};
use std::collections::BTreeMap;

impl DatabaseState {
    /// Runs `f` on the open database of a project; an error when the project
    /// has none open (`init_project_db` was not called, or it was closed).
    pub fn with_project<T>(
        &self,
        project_path: &str,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let connections = self.connections.lock().unwrap();
        let conn = connections
            .get(project_path)
            .ok_or("Database not initialized for this project")?;
        f(conn)
    }

    /// What a project's database holds for `keys` of a namespace: the
    /// project's overrides of an application setting. A project whose
    /// database is not open holds none, so it overrides nothing.
    pub fn kv_values(
        &self,
        project_path: &str,
        namespace: &str,
        keys: &[&str],
    ) -> Result<BTreeMap<String, String>, String> {
        let connections = self.connections.lock().unwrap();
        let Some(conn) = connections.get(project_path) else {
            return Ok(BTreeMap::new());
        };
        let mut found = BTreeMap::new();
        for key in keys {
            if let Some(value) = kv_get(conn, namespace, key)? {
                found.insert((*key).to_string(), value);
            }
        }
        Ok(found)
    }
}

pub fn kv_get(conn: &Connection, namespace: &str, key: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
        params![namespace, key],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get key: {}", e)),
    }
}

pub fn kv_set(conn: &Connection, namespace: &str, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv_store (namespace, key, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(namespace, key) DO UPDATE SET value = ?3, updated_at = datetime('now')",
        params![namespace, key, value],
    )
    .map_err(|e| format!("Failed to set key: {}", e))?;

    Ok(())
}

pub fn kv_delete(conn: &Connection, namespace: &str, key: &str) -> Result<bool, String> {
    let changed = conn
        .execute(
            "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
            params![namespace, key],
        )
        .map_err(|e| format!("Failed to delete key: {}", e))?;

    Ok(changed > 0)
}

pub fn kv_list(conn: &Connection, namespace: &str) -> Result<Vec<KvEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT namespace, key, value, updated_at FROM kv_store
             WHERE namespace = ?1 ORDER BY key",
        )
        .map_err(|e| format!("Failed to prepare list query: {}", e))?;

    let entries = stmt
        .query_map(params![namespace], |row| {
            Ok(KvEntry {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to list keys: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read keys: {}", e))?;

    Ok(entries)
}
