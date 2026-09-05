use super::*;
use crate::database::*;

#[test]
fn test_kv_set_and_get() {
    let conn = setup_in_memory_db();

    kv_set(&conn, "settings", "theme", "dark").unwrap();

    let value = kv_get(&conn, "settings", "theme").unwrap();
    assert_eq!(value, Some("dark".to_string()));
}

#[test]
fn test_kv_get_missing_key_returns_none() {
    let conn = setup_in_memory_db();

    let value = kv_get(&conn, "settings", "nonexistent").unwrap();
    assert_eq!(value, None);
}

#[test]
fn test_kv_set_upserts() {
    let conn = setup_in_memory_db();

    kv_set(&conn, "settings", "theme", "dark").unwrap();
    kv_set(&conn, "settings", "theme", "light").unwrap();

    let value = kv_get(&conn, "settings", "theme").unwrap();
    assert_eq!(value, Some("light".to_string()));
}

#[test]
fn test_kv_delete_existing_key() {
    let conn = setup_in_memory_db();

    kv_set(&conn, "settings", "theme", "dark").unwrap();
    let deleted = kv_delete(&conn, "settings", "theme").unwrap();
    assert!(deleted);

    let value = kv_get(&conn, "settings", "theme").unwrap();
    assert_eq!(value, None);
}

#[test]
fn test_kv_delete_missing_key_returns_false() {
    let conn = setup_in_memory_db();

    let deleted = kv_delete(&conn, "settings", "nonexistent").unwrap();
    assert!(!deleted);
}

#[test]
fn test_kv_list_returns_entries_for_namespace() {
    let conn = setup_in_memory_db();

    kv_set(&conn, "settings", "theme", "dark").unwrap();
    kv_set(&conn, "settings", "font", "mono").unwrap();
    kv_set(&conn, "other", "key", "val").unwrap();

    let entries = kv_list(&conn, "settings").unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].key, "font"); // alphabetical
    assert_eq!(entries[1].key, "theme");
}

#[test]
fn test_kv_list_empty_namespace() {
    let conn = setup_in_memory_db();

    let entries = kv_list(&conn, "empty").unwrap();
    assert!(entries.is_empty());
}

#[test]
fn test_kv_namespaces_are_isolated() {
    let conn = setup_in_memory_db();

    kv_set(&conn, "ns1", "key", "value1").unwrap();
    kv_set(&conn, "ns2", "key", "value2").unwrap();

    assert_eq!(
        kv_get(&conn, "ns1", "key").unwrap(),
        Some("value1".to_string())
    );
    assert_eq!(
        kv_get(&conn, "ns2", "key").unwrap(),
        Some("value2".to_string())
    );
}
