use super::types::KvEntry;
use rusqlite::{params, Connection};

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
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}
