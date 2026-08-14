//! Which agentic providers a project permits.
//!
//! The twin of `src/lib/config/providerPolicy.ts`. The TypeScript side decides
//! what the dialogs offer; this side decides what actually spawns. Both are
//! tested against `src/lib/config/providerPolicy.fixtures.json`, because a
//! disagreement between them is the one failure mode that matters: a provider
//! hidden from every dropdown would still run, or a permitted one would be
//! refused with no way to see why.
//!
//! Any change to the rules starts by adding a case to that fixture file.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

/// The namespace and key the policy lives under in the project database.
pub const POLICY_NAMESPACE: &str = "provider_policy";
pub const POLICY_KEY: &str = "policy";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderPolicy {
    /// `None` means no allow list is in effect — the usual case.
    pub allow: Option<Vec<String>>,
    pub deny: Vec<String>,
}

impl Default for ProviderPolicy {
    /// Open. Anything we cannot read must land here: a project that spawns
    /// nothing because its settings blob got corrupted is a far worse failure
    /// than one that briefly permits too much.
    fn default() -> Self {
        Self {
            allow: None,
            deny: Vec::new(),
        }
    }
}

/// Provider ids are lowercase in the registry; a hand-typed entry must still match.
fn normalize_id(value: &str) -> String {
    value.trim().to_lowercase()
}

fn normalize_list(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(serde_json::Value::Array(entries)) = value else {
        return Vec::new();
    };
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for entry in entries {
        let Some(text) = entry.as_str() else { continue };
        let id = normalize_id(text);
        if !id.is_empty() && seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

pub fn parse_provider_policy(raw: Option<&str>) -> ProviderPolicy {
    let Some(raw) = raw.filter(|r| !r.is_empty()) else {
        return ProviderPolicy::default();
    };
    let Ok(serde_json::Value::Object(source)) = serde_json::from_str::<serde_json::Value>(raw)
    else {
        return ProviderPolicy::default();
    };

    let allow = normalize_list(source.get("allow"));

    ProviderPolicy {
        // An allow list that normalises to nothing is an absent one. Reaching
        // that state means the last entry was removed, which reads as "never
        // mind the whitelist" — not as "lock this project out of every
        // provider". Denying everything stays possible, but only by saying so
        // on the deny list.
        allow: if allow.is_empty() { None } else { Some(allow) },
        deny: normalize_list(source.get("deny")),
    }
}

pub fn is_provider_allowed(provider_id: &str, policy: &ProviderPolicy) -> bool {
    let id = normalize_id(provider_id);
    if id.is_empty() {
        return false;
    }
    if policy.deny.iter().any(|denied| denied == &id) {
        return false;
    }
    // Empty is absent here too, not only after parsing — a policy built in
    // memory has to decide the same way as one read from disk.
    match policy.allow.as_ref().filter(|list| !list.is_empty()) {
        Some(list) => list.iter().any(|allowed| allowed == &id),
        None => true,
    }
}

/// Reads the policy for the project rooted at `cwd`.
///
/// Opened read-only and without creating anything: this runs on the spawn path,
/// where a project that has never been opened in the IDE (no `.auric`, no
/// tables) must simply come back open rather than gain a database as a side
/// effect of launching an agent.
pub fn policy_for_project(cwd: &Path) -> ProviderPolicy {
    let db_path = cwd.join(".auric").join("project.db");
    if !db_path.is_file() {
        return ProviderPolicy::default();
    }

    let Ok(conn) = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return ProviderPolicy::default();
    };

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
            rusqlite::params![POLICY_NAMESPACE, POLICY_KEY],
            |row| row.get(0),
        )
        .ok();

    parse_provider_policy(raw.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory, cleared first rather than only afterwards: a run that
    /// was interrupted leaves its database behind, and the next run would then
    /// panic creating a table that already exists — which is how this suite
    /// failed in a pre-commit hook rather than in a test run.
    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("auric-policy-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const FIXTURES: &str = include_str!("../../src/lib/config/providerPolicy.fixtures.json");

    #[derive(Deserialize)]
    struct ParseCase {
        name: String,
        raw: Option<String>,
        expected: ProviderPolicy,
    }

    #[derive(Deserialize)]
    struct DecideCase {
        name: String,
        policy: ProviderPolicy,
        #[serde(rename = "providerId")]
        provider_id: String,
        allowed: bool,
    }

    #[derive(Deserialize)]
    struct Fixtures {
        parse: Vec<ParseCase>,
        decide: Vec<DecideCase>,
    }

    fn fixtures() -> Fixtures {
        serde_json::from_str(FIXTURES).expect("fixtures must parse")
    }

    #[test]
    fn matches_the_shared_parse_cases() {
        for case in fixtures().parse {
            assert_eq!(
                parse_provider_policy(case.raw.as_deref()),
                case.expected,
                "parse case: {}",
                case.name
            );
        }
    }

    #[test]
    fn matches_the_shared_decide_cases() {
        for case in fixtures().decide {
            assert_eq!(
                is_provider_allowed(&case.provider_id, &case.policy),
                case.allowed,
                "decide case: {}",
                case.name
            );
        }
    }

    #[test]
    fn covers_every_shared_case() {
        // Guards against a fixture file that silently stops being read — an
        // empty list would make both loops above pass without testing anything.
        let fixtures = fixtures();
        assert!(fixtures.parse.len() >= 10);
        assert!(fixtures.decide.len() >= 10);
    }

    #[test]
    fn an_unopened_project_is_open() {
        let dir = temp_dir("unopened");
        assert_eq!(policy_for_project(&dir), ProviderPolicy::default());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_policy_out_of_a_project_database() {
        let dir = temp_dir("db");
        let auric = dir.join(".auric");
        std::fs::create_dir_all(&auric).unwrap();
        let conn = Connection::open(auric.join("project.db")).unwrap();
        conn.execute(
            "CREATE TABLE kv_store (namespace TEXT, key TEXT, value TEXT,
             updated_at TEXT, PRIMARY KEY (namespace, key))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO kv_store (namespace, key, value, updated_at)
             VALUES (?1, ?2, ?3, datetime('now'))",
            rusqlite::params![
                POLICY_NAMESPACE,
                POLICY_KEY,
                r#"{"allow":["claude"],"deny":["grok"]}"#
            ],
        )
        .unwrap();
        drop(conn);

        let policy = policy_for_project(&dir);
        assert_eq!(policy.allow, Some(vec!["claude".to_string()]));
        assert!(is_provider_allowed("claude", &policy));
        assert!(!is_provider_allowed("grok", &policy));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_database_without_the_table_is_open() {
        // Older projects predate the kv_store migration; the query fails and
        // must read as "no policy", not as a lockout.
        let dir = temp_dir("empty");
        let auric = dir.join(".auric");
        std::fs::create_dir_all(&auric).unwrap();
        Connection::open(auric.join("project.db")).unwrap();

        assert_eq!(policy_for_project(&dir), ProviderPolicy::default());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
