//! Quota readings for the agent CLIs, surfaced in the status bar.
//!
//! Opt-in and off by default: switching it on changes how AuricIDE invokes
//! `claude`, and a Codex check costs credits, so neither should happen unasked.
//! Codex is queried only when the user presses refresh.
//!
//! The switch itself is an ordinary application setting. It lives in
//! `localStorage` and is mirrored into `<app_data_dir>/webview-prefs.json`, and
//! this module reads that mirror rather than keeping a copy — one setting, one
//! place, and an absent entry means off on both sides.

pub mod claude;
pub mod codex;
pub mod contract;
pub mod store;

use std::path::PathBuf;

use tauri::Manager;

use contract::{UsageError, UsageSnapshot};
use store::UsageLimitsState;

/// The `APP_CONFIG_KEYS.cliUsageLimits` entry from `src/lib/config/appConfig.ts`.
/// Changing it here without changing it there turns the feature off silently.
pub const ENABLED_PREF_KEY: &str = "auric.cli-usage-limits";

/// Everything the commands need, managed by Tauri.
pub struct UsageLimitsService {
    pub store: UsageLimitsState,
    app_data_dir: PathBuf,
    /// Single-flight. Without it, a double-click on refresh forks one `codex`
    /// per press.
    refresh_lock: tokio::sync::Mutex<()>,
    /// Kept here only to stay alive — a dropped watcher stops watching.
    watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
}

impl UsageLimitsService {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            store: UsageLimitsState::new(store::store_path_in(&app_data_dir)),
            app_data_dir,
            refresh_lock: tokio::sync::Mutex::new(()),
            watcher: std::sync::Mutex::new(None),
        }
    }

    pub fn is_enabled(&self) -> bool {
        enabled_in(&crate::webview_prefs::read_prefs(
            &crate::webview_prefs::prefs_path_in(&self.app_data_dir),
        ))
    }

    pub fn claude_drop_path(&self) -> PathBuf {
        store::claude_drop_path_in(&self.app_data_dir)
    }

    /// Makes sure the statusLine script and settings file exist and are current.
    pub fn ensure_claude_sidecar(&self) -> Result<PathBuf, String> {
        claude::ensure_sidecar_for_user(&self.app_data_dir)
    }
}

/// Reads the switch out of the mirrored preferences.
///
/// The frontend writes `String(value)`, so the only two meaningful values are
/// `"true"` and `"false"`; anything else — including a missing key on a fresh
/// install — is the default, which is off.
pub fn enabled_in(prefs: &std::collections::BTreeMap<String, String>) -> bool {
    prefs.get(ENABLED_PREF_KEY).map(String::as_str) == Some("true")
}

/// All stored readings, in a stable order.
pub fn snapshots_of(service: &UsageLimitsService) -> Vec<UsageSnapshot> {
    service.store.read().into_values().collect()
}

/// Asks Codex for a fresh reading. This costs credits, so only the refresh
/// button should call it.
pub async fn refresh_codex(
    service: &UsageLimitsService,
    now: i64,
) -> Result<UsageSnapshot, UsageError> {
    let _flight = service.refresh_lock.lock().await;

    let env = crate::agents::cached_login_shell_env().await;
    match codex::read_codex_limits(env, now).await {
        Ok(snapshot) => {
            // A store that will not take the value costs the persistence, not
            // the reading — the caller still gets it.
            if let Err(error) = service.store.put(snapshot.clone()) {
                eprintln!("Usage limits: could not persist the codex reading: {error}");
            }
            Ok(snapshot)
        }
        Err(error) => {
            // A source that has gone away must stop claiming a number. Leaving
            // the last one in place would show a percentage for a CLI that is
            // no longer installed or no longer signed in.
            let _ = service.store.remove("codex");
            Err(error)
        }
    }
}

/// Takes whatever the statusLine sidecar last dropped into the store.
///
/// Unlike the codex reading this costs no process, so it is not TTL-gated: the
/// file only changes when a running agent writes it, and when it does that is
/// exactly the fresher number we want.
pub fn refresh_claude(service: &UsageLimitsService, now: i64) -> Result<UsageSnapshot, UsageError> {
    match claude::ingest_drop(&service.claude_drop_path(), now) {
        Ok(snapshot) => {
            if let Err(error) = service.store.put(snapshot.clone()) {
                eprintln!("Usage limits: could not persist the claude reading: {error}");
            }
            Ok(snapshot)
        }
        Err(error) => {
            // An API-key account never reports quota. Keeping a stale reading
            // around would let the chip claim a number for an account that has
            // none to give. A missing drop file is different: the sidecar has
            // simply not run yet, and wiping the last good reading would hide
            // Claude from the chip until the next interactive agent.
            if matches!(error, UsageError::NotSubscribed { .. }) {
                let _ = service.store.remove("claude");
            }
            Err(error)
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn usage_limits_read(
    service: tauri::State<'_, UsageLimitsService>,
) -> Result<Vec<UsageSnapshot>, String> {
    if !service.is_enabled() {
        return Ok(Vec::new());
    }
    Ok(snapshots_of(&service))
}

#[tauri::command]
pub async fn usage_limits_refresh(
    service: tauri::State<'_, UsageLimitsService>,
) -> Result<Vec<UsageSnapshot>, String> {
    if !service.is_enabled() {
        return Ok(Vec::new());
    }
    let now = chrono::Utc::now().timestamp();
    // A provider that cannot answer must not hide one that can, so each error
    // is logged and the remaining readings are still returned.
    if let Err(error) = refresh_codex(&service, now).await {
        eprintln!("Usage limits: {error}");
    }
    if let Err(error) = refresh_claude(&service, now) {
        eprintln!("Usage limits: {error}");
    }
    Ok(snapshots_of(&service))
}

pub fn emit_changed(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("usage-limits-changed", ());
}

/// Debounce for the drop-file watcher. The sidecar writes at most every
/// `refreshInterval` seconds per agent, but several agents write independently.
const WATCH_DEBOUNCE_MS: u64 = 400;

/// Watches the file the statusLine sidecar writes.
///
/// The script writes it, so nothing on this side would otherwise notice.
/// Returns the watcher, which must be kept alive for it to keep watching.
pub fn watch_claude_drop(app: tauri::AppHandle) -> Result<notify::RecommendedWatcher, String> {
    use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::atomic::{AtomicU64, Ordering};

    let drop = app
        .state::<UsageLimitsService>()
        .claude_drop_path()
        .to_path_buf();
    let dir = drop
        .parent()
        .ok_or_else(|| "Claude status-line drop has no parent directory".to_string())?
        .to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let watched = drop
        .file_name()
        .ok_or_else(|| "Claude status-line drop has no file name".to_string())?
        .to_string_lossy()
        .to_string();

    let last_emit = AtomicU64::new(0);
    let started = std::time::Instant::now();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            // The script writes through `<name>.<pid>.tmp` and a rename, so
            // only the final name is worth reacting to.
            let touches_drop = event.paths.iter().any(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy() == watched.as_str())
                    .unwrap_or(false)
            });
            if !touches_drop {
                return;
            }

            let now = started.elapsed().as_millis() as u64;
            let previous = last_emit.load(Ordering::Relaxed);
            if now.saturating_sub(previous) < WATCH_DEBOUNCE_MS {
                return;
            }
            last_emit.store(now, Ordering::Relaxed);

            let service = app.state::<UsageLimitsService>();
            if !service.is_enabled() {
                return;
            }
            if refresh_claude(&service, chrono::Utc::now().timestamp()).is_ok() {
                emit_changed(&app);
            }
        },
        Config::default().with_poll_interval(std::time::Duration::from_millis(500)),
    )
    .map_err(|e| format!("Failed to create usage limits watcher: {e}"))?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch the status-line drop: {e}"))?;

    Ok(watcher)
}

/// Starts the drop-file watcher and parks it in the managed state.
///
/// A watcher that cannot start costs the live updates, not the feature — the
/// numbers still arrive on the next refresh.
pub fn install_claude_watcher(app: &tauri::AppHandle) {
    match watch_claude_drop(app.clone()) {
        Ok(watcher) => {
            let service = app.state::<UsageLimitsService>();
            if let Ok(mut slot) = service.watcher.lock() {
                *slot = Some(watcher);
            };
        }
        Err(error) => eprintln!("Usage limits: status-line watcher unavailable: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contract::{UsageWindow, WindowKind};
    use std::collections::BTreeMap;

    #[test]
    fn the_feature_is_off_on_a_fresh_install() {
        assert!(!enabled_in(&BTreeMap::new()));
    }

    #[test]
    fn only_the_literal_true_switches_it_on() {
        // The frontend writes `String(value)`. Anything else — a half-written
        // mirror, a hand-edited file, a future encoding — must read as off,
        // because on is the setting with side effects.
        let on = BTreeMap::from([(ENABLED_PREF_KEY.to_string(), "true".to_string())]);
        assert!(enabled_in(&on));

        for value in ["false", "1", "yes", "TRUE", ""] {
            let prefs = BTreeMap::from([(ENABLED_PREF_KEY.to_string(), value.to_string())]);
            assert!(!enabled_in(&prefs), "{value:?} must not enable the feature");
        }
    }

    #[test]
    fn a_missing_claude_drop_does_not_erase_the_last_reading() {
        // The drop file only exists while a sidecar has run. A manual refresh
        // before that — or after the file was cleaned up — must not make the
        // chip forget a reading it already had.
        let dir = tempfile::tempdir().unwrap();
        let service = UsageLimitsService::new(dir.path().to_path_buf());
        service
            .store
            .put(UsageSnapshot {
                provider: "claude".to_string(),
                plan_label: None,
                windows: vec![UsageWindow {
                    limit_id: "claude".to_string(),
                    limit_label: None,
                    kind: WindowKind::FiveHour,
                    label: "5 h".to_string(),
                    used_percent: 12.0,
                    resets_at: 1_787_301_067,
                    window_minutes: 300,
                }],
                credits: None,
                observed_at: 1_000,
                source: "statusline".to_string(),
            })
            .unwrap();

        let error = refresh_claude(&service, 2_000).expect_err("no drop file");
        assert!(
            error.to_string().starts_with("USAGE_UNAVAILABLE:"),
            "{error}"
        );
        let stored = service.store.read();
        assert_eq!(stored["claude"].windows[0].used_percent, 12.0);
    }
}
