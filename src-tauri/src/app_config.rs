//! Application-wide credentials — the settings that belong to the machine
//! rather than to any one project.
//!
//! API keys used to live in each project's `kv_store`, which meant re-typing
//! every key for every project. They live here instead, and a project may still
//! override one when it genuinely needs its own (see `resolve_credential`).
//!
//! Deliberately not routed through `webview_prefs`: that store mirrors whatever
//! the webview writes to `localStorage`, and a secret does not belong in a
//! second copy inside a WebKit database. This file is written by Rust only, at
//! mode 0600.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Bump only for a breaking change; additive fields ride on `#[serde(default)]`.
const STORE_VERSION: u32 = 1;

/// Caps so one runaway writer cannot turn the store into something the next
/// launch has to chew through before it can answer a settings screen.
const MAX_ENTRIES: usize = 200;
const MAX_VALUE_BYTES: usize = 64 * 1024;

pub fn credentials_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("app-credentials.json")
}

/// `namespace -> key -> value`, matching the shape the project `kv_store` uses,
/// so a project override and its global counterpart are addressed identically.
pub type CredentialMap = BTreeMap<String, BTreeMap<String, String>>;

#[derive(Debug, Default, Deserialize, Serialize)]
struct CredentialsFile {
    version: u32,
    #[serde(default)]
    entries: CredentialMap,
}

pub struct AppCredentialsState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl AppCredentialsState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Reads the store. Missing is empty. Unreadable is empty too — a corrupt
/// credentials file must not stop the app from starting, and the user can
/// always re-enter a key.
pub fn read_credentials(path: &Path) -> CredentialMap {
    if !path.exists() {
        return CredentialMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<CredentialsFile>(&contents).ok())
        .map(|file| file.entries)
        .unwrap_or_default()
}

/// Writes through a temp file and a rename, so a read that lands mid-write sees
/// either the old file or the new one.
///
/// The temp file is created at 0600 before anything is written to it. Creating
/// it with the default mask and tightening afterwards would leave the secret
/// world-readable for the length of the write.
pub fn write_credentials_atomic(path: &Path, entries: &CredentialMap) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Credentials store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&CredentialsFile {
        version: STORE_VERSION,
        entries: entries.clone(),
    })
    .map_err(|error| error.to_string())?;

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);

    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

/// A stored value counts only when it carries something. An empty string is
/// how a cleared field arrives from the UI, and treating it as a value would
/// let a blank global setting shadow nothing while looking configured.
fn meaningful(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// The one override rule, so the settings screen and the code that spends the
/// key cannot disagree: a project value wins when it carries something, the
/// global value otherwise.
pub fn resolve_credential(global: Option<String>, project: Option<String>) -> Option<String> {
    project
        .and_then(|value| meaningful(&value))
        .or_else(|| global.and_then(|value| meaningful(&value)))
}

/// One namespace of the application store, blank fields dropped — a cleared
/// value must not read as configured further down.
pub fn global_namespace(path: &Path, namespace: &str) -> BTreeMap<String, String> {
    read_credentials(path)
        .remove(namespace)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(key, value)| meaningful(&value).map(|value| (key, value)))
        .collect()
}

/// Folds a project's overrides onto the application-wide values, key by key.
///
/// Key by key rather than all-or-nothing: a project that overrides one field
/// must not lose the rest, and a field cleared in the project has to fall back
/// to the global value instead of resolving to nothing.
pub fn merge_namespace(
    global: BTreeMap<String, String>,
    project: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut merged = BTreeMap::new();
    for key in global.keys().chain(project.keys()) {
        if merged.contains_key(key) {
            continue;
        }
        if let Some(value) = resolve_credential(global.get(key).cloned(), project.get(key).cloned())
        {
            merged.insert(key.clone(), value);
        }
    }
    merged
}

/// Stores a value, or removes it when the value is blank — clearing a field in
/// the UI has to actually clear it, not park an empty string that later reads
/// as "configured".
pub fn set_credential(
    entries: &mut CredentialMap,
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(format!("Value for '{}/{}' is too large", namespace, key));
    }

    match meaningful(value) {
        None => {
            if let Some(ns) = entries.get_mut(namespace) {
                ns.remove(key);
                if ns.is_empty() {
                    entries.remove(namespace);
                }
            }
        }
        Some(value) => {
            let ns = entries.entry(namespace.to_string()).or_default();
            if !ns.contains_key(key) && total_entries(entries) >= MAX_ENTRIES {
                return Err("Credentials store is full".to_string());
            }
            entries
                .entry(namespace.to_string())
                .or_default()
                .insert(key.to_string(), value);
        }
    }
    Ok(())
}

fn total_entries(entries: &CredentialMap) -> usize {
    entries.values().map(|ns| ns.len()).sum()
}

// ── Tauri commands ──────────────────────────────────────────────────

/// Every key of one namespace at once — the settings screens read four or five
/// fields together, so there is no single-field read to go with it.
#[tauri::command]
pub fn app_credential_list(
    namespace: String,
    state: tauri::State<'_, AppCredentialsState>,
) -> BTreeMap<String, String> {
    let _guard = state.lock.lock().unwrap();
    read_credentials(&state.path)
        .remove(&namespace)
        .unwrap_or_default()
}

#[tauri::command]
pub fn app_credential_set(
    namespace: String,
    key: String,
    value: String,
    state: tauri::State<'_, AppCredentialsState>,
) -> Result<(), String> {
    let _guard = state.lock.lock().unwrap();
    let mut entries = read_credentials(&state.path);
    set_credential(&mut entries, &namespace, &key, &value)?;
    write_credentials_atomic(&state.path, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("auric-credentials-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        credentials_path_in(&dir)
    }

    #[test]
    fn a_missing_store_reads_as_empty() {
        let path = temp_path("missing");
        assert!(read_credentials(&path).is_empty());
    }

    #[test]
    fn a_corrupt_store_reads_as_empty_rather_than_failing_the_launch() {
        let path = temp_path("corrupt");
        fs::write(&path, "{ not json at all").unwrap();
        assert!(read_credentials(&path).is_empty());
    }

    #[test]
    fn round_trips_a_value() {
        let path = temp_path("roundtrip");
        let mut entries = CredentialMap::new();
        set_credential(&mut entries, "llm", "api_key", "sk-test").unwrap();
        write_credentials_atomic(&path, &entries).unwrap();

        let read_back = global_namespace(&path, "llm");
        assert_eq!(
            read_back.get("api_key").map(String::as_str),
            Some("sk-test")
        );
        assert_eq!(read_back.get("model"), None);
        assert!(global_namespace(&path, "judge_llm").is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn the_store_is_readable_only_by_its_owner() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_path("mode");
        let mut entries = CredentialMap::new();
        set_credential(&mut entries, "llm", "api_key", "sk-test").unwrap();
        write_credentials_atomic(&path, &entries).unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "credentials must not be world-readable");
    }

    #[cfg(unix)]
    #[test]
    fn rewriting_keeps_the_restricted_mode() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp_path("mode-rewrite");
        let mut entries = CredentialMap::new();
        set_credential(&mut entries, "llm", "api_key", "one").unwrap();
        write_credentials_atomic(&path, &entries).unwrap();
        set_credential(&mut entries, "llm", "api_key", "two").unwrap();
        write_credentials_atomic(&path, &entries).unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn clearing_a_field_removes_it() {
        let mut entries = CredentialMap::new();
        set_credential(&mut entries, "llm", "api_key", "sk-test").unwrap();
        set_credential(&mut entries, "llm", "api_key", "").unwrap();

        assert!(entries.is_empty(), "an emptied namespace should not linger");
    }

    #[test]
    fn whitespace_is_not_a_value() {
        let mut entries = CredentialMap::new();
        set_credential(&mut entries, "llm", "api_key", "   ").unwrap();
        assert!(entries.is_empty(), "whitespace must not create an entry");
    }

    #[test]
    fn a_project_value_wins_over_the_global_one() {
        assert_eq!(
            resolve_credential(Some("global".into()), Some("project".into())),
            Some("project".to_string())
        );
    }

    #[test]
    fn the_global_value_carries_a_project_that_set_nothing() {
        assert_eq!(
            resolve_credential(Some("global".into()), None),
            Some("global".to_string())
        );
        // A blank override is not an override — otherwise clearing a project
        // field would read as "this project deliberately has no key" and hide
        // the global one.
        assert_eq!(
            resolve_credential(Some("global".into()), Some("  ".into())),
            Some("global".to_string())
        );
    }

    #[test]
    fn nothing_configured_anywhere_resolves_to_nothing() {
        assert_eq!(resolve_credential(None, None), None);
        assert_eq!(resolve_credential(Some("".into()), Some("".into())), None);
    }

    #[test]
    fn merging_takes_each_field_from_wherever_it_is_set() {
        let global = BTreeMap::from([
            ("api_key".to_string(), "sk-global".to_string()),
            ("model".to_string(), "global-model".to_string()),
        ]);
        let project = BTreeMap::from([
            ("model".to_string(), "project-model".to_string()),
            ("endpoint".to_string(), "project-only".to_string()),
        ]);

        let merged = merge_namespace(global, project);

        assert_eq!(merged.get("api_key").map(String::as_str), Some("sk-global"));
        assert_eq!(
            merged.get("model").map(String::as_str),
            Some("project-model")
        );
        assert_eq!(
            merged.get("endpoint").map(String::as_str),
            Some("project-only")
        );
    }

    #[test]
    fn a_cleared_project_field_does_not_erase_the_global_one() {
        let global = BTreeMap::from([("api_key".to_string(), "sk-global".to_string())]);
        let project = BTreeMap::from([("api_key".to_string(), "".to_string())]);

        let merged = merge_namespace(global, project);

        assert_eq!(merged.get("api_key").map(String::as_str), Some("sk-global"));
    }

    #[test]
    fn merging_nothing_with_nothing_yields_nothing() {
        assert!(merge_namespace(BTreeMap::new(), BTreeMap::new()).is_empty());
    }

    #[test]
    fn refuses_an_oversized_value() {
        let mut entries = CredentialMap::new();
        let huge = "x".repeat(MAX_VALUE_BYTES + 1);
        assert!(set_credential(&mut entries, "llm", "api_key", &huge).is_err());
    }
}
