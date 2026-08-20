//! A trail of quota readings, kept so a later one can be a rate.
//!
//! `usage-limits.json` holds only the last snapshot per provider — that is
//! what the chip reads. This file sits beside it and appends, downsampled to
//! one sample per quarter-hour, so a week's window has a slope instead of a
//! single percentage. Nothing here is asked of the CLIs: they do not offer
//! history, and we already pay for each Codex reading we take.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::contract::{UsageSnapshot, UsageWindow, WindowKind};

/// Bump only for a breaking change; additive fields ride on `#[serde(default)]`.
const STORE_VERSION: u32 = 1;

/// One sample per this many seconds, per provider. Matches the Codex poller
/// so a reading we already paid for is not thrown away, and Claude's denser
/// status-line writes collapse into the same grid.
const BUCKET_SECS: i64 = 15 * 60;

/// Keep two weekly windows of trail, so a reset still has a day of context
/// on either side while the file stays bounded.
const RETENTION_SECS: i64 = 14 * 24 * 60 * 60;

/// Where the trail lives, given the app data directory.
pub fn history_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("usage-limits-history.json")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSampleWindow {
    pub limit_id: String,
    pub kind: WindowKind,
    pub used_percent: f64,
    pub resets_at: i64,
    pub window_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSample {
    pub provider: String,
    pub observed_at: i64,
    pub windows: Vec<UsageSampleWindow>,
}

#[derive(Debug, Deserialize, Serialize)]
struct HistoryFile {
    version: u32,
    #[serde(default)]
    samples: Vec<UsageSample>,
}

pub struct UsageHistoryState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl UsageHistoryState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// Every stored sample, oldest first. A missing or unreadable file is an
    /// empty trail — a forecast is never worth refusing to start over.
    pub fn read(&self) -> Vec<UsageSample> {
        let _guard = self.lock.lock();
        read_samples(&self.path)
    }

    /// Appends `snapshot` as a sample, collapsing it into the provider's
    /// current quarter-hour bucket when one already exists, and dropping
    /// anything older than the retention window.
    pub fn record(&self, snapshot: &UsageSnapshot) -> Result<(), String> {
        if snapshot.windows.is_empty() {
            return Ok(());
        }
        let _guard = self.lock.lock();
        let mut samples = read_samples(&self.path);
        let cutoff = snapshot.observed_at.saturating_sub(RETENTION_SECS);
        samples.retain(|sample| sample.observed_at >= cutoff);

        let incoming = sample_from(snapshot);

        if let Some(last) = samples
            .iter_mut()
            .rev()
            .find(|sample| sample.provider == snapshot.provider)
        {
            if snapshot.observed_at < last.observed_at {
                // A clock that moved backwards is not a new point on the
                // trail; leaving the later reading in place is the cheaper
                // of the two wrong answers.
                return Ok(());
            }
            if snapshot.observed_at - last.observed_at < BUCKET_SECS {
                *last = incoming;
                return write_samples_atomic(&self.path, &samples);
            }
        }

        samples.push(incoming);
        write_samples_atomic(&self.path, &samples)
    }
}

fn sample_from(snapshot: &UsageSnapshot) -> UsageSample {
    UsageSample {
        provider: snapshot.provider.clone(),
        observed_at: snapshot.observed_at,
        windows: snapshot.windows.iter().map(sample_window_from).collect(),
    }
}

fn sample_window_from(window: &UsageWindow) -> UsageSampleWindow {
    UsageSampleWindow {
        limit_id: window.limit_id.clone(),
        kind: window.kind,
        used_percent: window.used_percent,
        resets_at: window.resets_at,
        window_minutes: window.window_minutes,
    }
}

fn read_samples(path: &Path) -> Vec<UsageSample> {
    if !path.exists() {
        return Vec::new();
    }
    let parsed = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<HistoryFile>(&contents).ok());
    match parsed {
        Some(file) => file.samples,
        None => {
            preserve_corrupt_history(path);
            Vec::new()
        }
    }
}

fn preserve_corrupt_history(path: &Path) {
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup = path.with_file_name(format!("usage-limits-history.corrupt-{timestamp}.json.bak"));
    let _ = fs::copy(path, backup);
}

fn write_samples_atomic(path: &Path, samples: &[UsageSample]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Usage limits history has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&HistoryFile {
        version: STORE_VERSION,
        samples: samples.to_vec(),
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

    fn snapshot(provider: &str, used: f64, observed_at: i64) -> UsageSnapshot {
        UsageSnapshot {
            provider: provider.to_string(),
            plan_label: None,
            windows: vec![UsageWindow {
                limit_id: provider.to_string(),
                limit_label: None,
                kind: WindowKind::SevenDay,
                label: "7 d".to_string(),
                used_percent: used,
                resets_at: observed_at + 4 * 24 * 60 * 60,
                window_minutes: 10080,
            }],
            credits: None,
            observed_at,
            source: "app-server".to_string(),
        }
    }

    fn state_in(dir: &Path) -> UsageHistoryState {
        UsageHistoryState::new(history_path_in(dir))
    }

    #[test]
    fn a_missing_history_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(state_in(dir.path()).read().is_empty());
    }

    #[test]
    fn a_reading_with_no_windows_is_not_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        let mut empty = snapshot("codex", 40.0, 1_000);
        empty.windows.clear();
        state.record(&empty).unwrap();
        assert!(state.read().is_empty());
    }

    #[test]
    fn two_readings_a_bucket_apart_both_stay() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.record(&snapshot("codex", 20.0, 1_000)).unwrap();
        state
            .record(&snapshot("codex", 40.0, 1_000 + BUCKET_SECS))
            .unwrap();

        let stored = state.read();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].windows[0].used_percent, 20.0);
        assert_eq!(stored[1].windows[0].used_percent, 40.0);
    }

    #[test]
    fn two_readings_in_the_same_bucket_collapse_to_the_later_one() {
        // Claude's status line can write every 45 s. Keeping each one would
        // turn a five-hour session into a few hundred points that say the
        // same quarter-hour twice.
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.record(&snapshot("codex", 20.0, 1_000)).unwrap();
        state
            .record(&snapshot("codex", 22.0, 1_000 + BUCKET_SECS - 1))
            .unwrap();

        let stored = state.read();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].windows[0].used_percent, 22.0);
        assert_eq!(stored[0].observed_at, 1_000 + BUCKET_SECS - 1);
    }

    #[test]
    fn providers_bucket_independently() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.record(&snapshot("codex", 20.0, 1_000)).unwrap();
        state.record(&snapshot("claude", 12.0, 1_100)).unwrap();
        state.record(&snapshot("codex", 21.0, 1_200)).unwrap();

        let stored = state.read();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].provider, "codex");
        assert_eq!(stored[0].windows[0].used_percent, 21.0);
        assert_eq!(stored[1].provider, "claude");
        assert_eq!(stored[1].windows[0].used_percent, 12.0);
    }

    #[test]
    fn readings_older_than_retention_are_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.record(&snapshot("codex", 10.0, 1_000)).unwrap();
        state
            .record(&snapshot("codex", 40.0, 1_000 + RETENTION_SECS + 1))
            .unwrap();

        let stored = state.read();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].windows[0].used_percent, 40.0);
    }

    #[test]
    fn a_corrupt_history_is_kept_aside_and_treated_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = history_path_in(dir.path());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(&path, "{ not json at all").unwrap();

        assert!(read_samples(&path).is_empty());
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
            .collect();
        assert_eq!(backups.len(), 1, "the unreadable file must be preserved");
    }

    #[test]
    fn an_older_reading_does_not_rewrite_a_newer_one() {
        let dir = tempfile::tempdir().unwrap();
        let state = state_in(dir.path());
        state.record(&snapshot("codex", 40.0, 2_000)).unwrap();
        state.record(&snapshot("codex", 10.0, 1_000)).unwrap();

        let stored = state.read();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].windows[0].used_percent, 40.0);
        assert_eq!(stored[0].observed_at, 2_000);
    }

    #[test]
    fn the_write_never_leaves_a_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        state_in(dir.path())
            .record(&snapshot("codex", 40.0, 1_000))
            .unwrap();
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
