//! Nested git work-trees a project hides from discovery, the dirty probe
//! and the parent repo's status.
//!
//! The twin of `src/lib/config/ignoredRepos.ts`. The TypeScript side writes
//! the list and filters the settings screen; this side is what actually
//! decides which repos get walked. Both are tested against
//! `src/lib/config/ignoredRepos.fixtures.json`.

use rusqlite::{Connection, OpenFlags};
use std::path::Path;

/// The namespace and key the list lives under in the project database.
pub const IGNORED_REPOS_NAMESPACE: &str = "ignored_repos";
pub const IGNORED_REPOS_KEY: &str = "paths";

/// A project-relative ignore entry, or `None` when the value is the project
/// root or climbs out of it. The root cannot be ignored: that would turn the
/// opened folder into "no git at all", which is a different setting.
pub fn normalize_ignored_repo_path(value: &str) -> Option<String> {
    let mut path = value.trim().replace('\\', "/");
    while path.starts_with("./") {
        path = path[2..].to_string();
    }
    while path.contains("//") {
        path = path.replace("//", "/");
    }
    let path = path.trim_matches('/').to_string();
    if path.is_empty() || path == "." {
        return None;
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.contains(&"..") {
        return None;
    }
    Some(segments.join("/"))
}

pub fn parse_ignored_repos(raw: Option<&str>) -> Vec<String> {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let serde_json::Value::Array(entries) = parsed else {
        return Vec::new();
    };

    let mut seen = std::collections::BTreeSet::new();
    for entry in entries {
        let Some(text) = entry.as_str() else { continue };
        if let Some(path) = normalize_ignored_repo_path(text) {
            seen.insert(path);
        }
    }
    seen.into_iter().collect()
}

pub fn is_ignored_repo_path(relative_path: &str, ignored: &[String]) -> bool {
    let Some(path) = normalize_ignored_repo_path(relative_path) else {
        return false;
    };
    ignored
        .iter()
        .any(|entry| path == *entry || path.starts_with(&format!("{entry}/")))
}

/// Reads the ignore list for the project rooted at `cwd`.
///
/// Opened read-only and without creating anything: this runs on discovery
/// and the dirty probe, including for starred projects that were never
/// opened in this session. A missing database is "ignore nothing".
pub fn ignored_repos_for_project(cwd: &Path) -> Vec<String> {
    let db_path = cwd.join(".auric").join("project.db");
    if !db_path.is_file() {
        return Vec::new();
    }

    let Ok(conn) = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Vec::new();
    };

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
            rusqlite::params![IGNORED_REPOS_NAMESPACE, IGNORED_REPOS_KEY],
            |row| row.get(0),
        )
        .ok();

    parse_ignored_repos(raw.as_deref())
}

#[cfg(test)]
pub fn write_ignored_repos_for_test(root: &Path, raw: &str) {
    let auric = root.join(".auric");
    std::fs::create_dir_all(&auric).unwrap();
    let conn = Connection::open(auric.join("project.db")).unwrap();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (namespace TEXT, key TEXT, value TEXT,
         updated_at TEXT, PRIMARY KEY (namespace, key))",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))",
        rusqlite::params![IGNORED_REPOS_NAMESPACE, IGNORED_REPOS_KEY, raw],
    )
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    const FIXTURES: &str = include_str!("../../src/lib/config/ignoredRepos.fixtures.json");

    #[derive(Deserialize)]
    struct ParseCase {
        name: String,
        raw: Option<String>,
        expected: Vec<String>,
    }

    #[derive(Deserialize)]
    struct MatchCase {
        name: String,
        ignored: Vec<String>,
        path: String,
        matches: bool,
    }

    #[derive(Deserialize)]
    struct Fixtures {
        parse: Vec<ParseCase>,
        #[serde(rename = "match")]
        match_cases: Vec<MatchCase>,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(FIXTURES).expect("ignoredRepos fixtures must parse")
    }

    #[test]
    fn parse_cases_match_the_typescript_contract() {
        let fixtures = fixtures();
        assert!(fixtures.parse.len() >= 10);
        for case in fixtures.parse {
            assert_eq!(
                parse_ignored_repos(case.raw.as_deref()),
                case.expected,
                "{}",
                case.name
            );
        }
    }

    #[test]
    fn match_cases_match_the_typescript_contract() {
        let fixtures = fixtures();
        assert!(fixtures.match_cases.len() >= 8);
        for case in fixtures.match_cases {
            assert_eq!(
                is_ignored_repo_path(&case.path, &case.ignored),
                case.matches,
                "{}",
                case.name
            );
        }
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "auric-ignored-repos-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_unopened_project_ignores_nothing() {
        let dir = temp_dir("unopened");
        assert!(ignored_repos_for_project(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_list_out_of_a_project_database() {
        let dir = temp_dir("db");
        write_ignored_repos_for_test(&dir, r#"["vendor","experiments/foo"]"#);

        assert_eq!(
            ignored_repos_for_project(&dir),
            vec!["experiments/foo".to_string(), "vendor".to_string()]
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_database_without_the_table_ignores_nothing() {
        let dir = temp_dir("empty");
        let auric = dir.join(".auric");
        std::fs::create_dir_all(&auric).unwrap();
        Connection::open(auric.join("project.db")).unwrap();

        assert!(ignored_repos_for_project(&dir).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
