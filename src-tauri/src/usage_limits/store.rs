//! Where the last reading of each provider is kept.
//!
//! Two files, on purpose:
//!
//! * `usage-limits.json` — normalized snapshots, written only by Rust. This is
//!   what the status bar reads, and it survives a restart so the chip has
//!   something to show before the first refresh comes back.
//! * `claude-statusline.json` — the raw stdin payload, written by the generated
//!   statusLine script. That script does exactly one thing: drop what it was
//!   handed. Every bit of parsing and validation stays on this side, where it
//!   can fail loudly, instead of being half-attempted in shell.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::contract::UsageSnapshot;

/// Bump only for a breaking change; additive fields ride on `#[serde(default)]`.
const STORE_VERSION: u32 = 1;

/// Where the normalized snapshots live, given the app data directory.
pub fn store_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("usage-limits.json")
}

/// Where the statusLine script drops its raw payload.
pub fn claude_drop_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("usage-limits")
        .join("claude-statusline.json")
}

#[derive(Debug, Deserialize, Serialize)]
struct UsageLimitsFile {
    version: u32,
    #[serde(default)]
    snapshots: BTreeMap<String, UsageSnapshot>,
}

/// The path plus a lock that keeps two commands in *this* process from
/// interleaving their read-modify-write.
pub struct UsageLimitsState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl UsageLimitsState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// All stored snapshots, newest write wins. A missing or unreadable file is
    /// an empty one — a status-bar chip is never worth refusing to start over.
    pub fn read(&self) -> BTreeMap<String, UsageSnapshot> {
        let _guard = self.lock.lock();
        read_snapshots(&self.path)
    }

    /// Replaces one provider's entry, leaving the others alone.
    pub fn put(&self, snapshot: UsageSnapshot) -> Result<(), String> {
        let _guard = self.lock.lock();
        let mut snapshots = read_snapshots(&self.path);
        snapshots.insert(snapshot.provider.clone(), snapshot);
        write_snapshots_atomic(&self.path, &snapshots)
    }

    /// Drops one provider's entry, for when a source stops being available.
    pub fn remove(&self, provider: &str) -> Result<(), String> {
        let _guard = self.lock.lock();
        let mut snapshots = read_snapshots(&self.path);
        if snapshots.remove(provider).is_none() {
            return Ok(());
        }
        write_snapshots_atomic(&self.path, &snapshots)
    }
}

pub fn read_snapshots(path: &Path) -> BTreeMap<String, UsageSnapshot> {
    if !path.exists() {
        return BTreeMap::new();
    }
    let parsed = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<UsageLimitsFile>(&contents).ok());
    match parsed {
        Some(file) => file.snapshots,
        None => {
            preserve_corrupt_store(path);
            BTreeMap::new()
        }
    }
}

fn preserve_corrupt_store(path: &Path) {
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup = path.with_file_name(format!("usage-limits.corrupt-{timestamp}.json.bak"));
    let _ = fs::copy(path, backup);
}

/// Writes through a temp file and a rename, so a read that lands mid-write
/// sees either the old file or the new one.
pub fn write_snapshots_atomic(
    path: &Path,
    snapshots: &BTreeMap<String, UsageSnapshot>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Usage limits store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&UsageLimitsFile {
        version: STORE_VERSION,
        snapshots: snapshots.clone(),
    })
    .map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage_limits::contract::{UsageWindow, WindowKind};

    fn snapshot(provider: &str, used: f64) -> UsageSnapshot {
        UsageSnapshot {
            provider: provider.to_string(),
            plan_label: None,
            windows: vec![UsageWindow {
                limit_id: provider.to_string(),
                limit_label: None,
                kind: WindowKind::SevenDay,
                label: "7 d".to_string(),
                used_percent: used,
                resets_at: 1_787_301_067,
                window_minutes: 10080,
            }],
            credits: None,
            observed_at: 1_787_300_000,
            source: "app-server".to_string(),
        }
    }

    fn state_in(dir: &Path) -> UsageLimitsState {
        UsageLimitsState::new(store_path_in(dir))
    }

    #[test]
    fn a_missing_store_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(state_in(dir.path()).read().is_empty());
    }

    #[test]
    fn a_snapshot_survives_a_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.put(snapshot("codex", 40.0)).unwrap();

        let stored = state_in(dir.path()).read();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored["codex"].windows[0].used_percent, 40.0);
    }

    #[test]
    fn writing_one_provider_leaves_the_other_alone() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.put(snapshot("codex", 40.0)).unwrap();
        state.put(snapshot("claude", 12.0)).unwrap();
        state.put(snapshot("codex", 55.0)).unwrap();

        let stored = state.read();
        assert_eq!(stored["codex"].windows[0].used_percent, 55.0);
        assert_eq!(stored["claude"].windows[0].used_percent, 12.0);
    }

    #[test]
    fn removing_an_absent_provider_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.put(snapshot("codex", 40.0)).unwrap();
        state.remove("claude").unwrap();
        assert_eq!(state.read().len(), 1);
    }

    #[test]
    fn a_corrupt_store_is_kept_aside_and_treated_as_empty() {
        // Refusing to start over an unreadable status-bar cache would be the
        // wrong trade; keeping the file means the cause is still inspectable.
        let dir = tempfile::tempdir().unwrap();
        let path = store_path_in(dir.path());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(&path, "{ not json at all").unwrap();

        assert!(read_snapshots(&path).is_empty());
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
            .collect();
        assert_eq!(backups.len(), 1, "the unreadable file must be preserved");
    }

    #[test]
    fn the_write_never_leaves_a_temp_file_behind() {
        // The project file watcher filters `*.tmp`, and a leftover would keep
        // matching forever.
        let dir = tempfile::tempdir().unwrap();
        state_in(dir.path()).put(snapshot("codex", 40.0)).unwrap();
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
