//! Quota readings for the agent CLIs, surfaced in the status bar.
//!
//! Opt-in and off by default: switching it on changes how AuricIDE invokes
//! `claude` and starts a short background process every 30 minutes, and neither
//! should happen unasked.
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

/// How long a reading counts as current. Every trigger — window focus, hover,
/// an agent finishing, the timer — goes through this, so five triggers in a row
/// still cost one process.
const REFRESH_TTL_SECS: i64 = 300;

/// How often the background timer looks. Deliberately far coarser than the TTL:
/// a weekly window does not move fast enough to justify waking up more often.
const TIMER_TICK_SECS: u64 = 1800;

/// Everything the commands need, managed by Tauri.
pub struct UsageLimitsService {
    pub store: UsageLimitsState,
    app_data_dir: PathBuf,
    /// Single-flight. Without it, hovering the chip forks one `codex` per
    /// mouse-over.
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

/// Whether a stored reading is old enough to be worth replacing.
pub fn needs_refresh(stored: Option<&UsageSnapshot>, now: i64, ttl_secs: i64) -> bool {
    match stored {
        None => true,
        // A reading stamped in the future is a clock that moved, not a fresh
        // number — refetching is the cheaper of the two wrong answers.
        Some(snapshot) => now < snapshot.observed_at || now - snapshot.observed_at >= ttl_secs,
    }
}

/// All stored readings, in a stable order.
pub fn snapshots_of(service: &UsageLimitsService) -> Vec<UsageSnapshot> {
    service.store.read().into_values().collect()
}

/// Refreshes the codex reading if the stored one has aged out.
///
/// Returns `Ok(None)` when the stored reading was still current — that is a
/// normal outcome, not a failure.
pub async fn refresh_codex(
    service: &UsageLimitsService,
    now: i64,
) -> Result<Option<UsageSnapshot>, UsageError> {
    let _flight = service.refresh_lock.lock().await;

    // Re-checked inside the lock: whoever was holding it may have just done
    // exactly this work.
    let stored = service.store.read();
    if !needs_refresh(stored.get("codex"), now, REFRESH_TTL_SECS) {
        return Ok(None);
    }

    let env = crate::agents::cached_login_shell_env().await;
    match codex::read_codex_limits(env, now).await {
        Ok(snapshot) => {
            // A store that will not take the value costs the persistence, not
            // the reading — the caller still gets it.
            if let Err(error) = service.store.put(snapshot.clone()) {
                eprintln!("Usage limits: could not persist the codex reading: {error}");
            }
            Ok(Some(snapshot))
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
            // none to give.
            let _ = service.store.remove("claude");
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

// ---------------------------------------------------------------------------
// Background refresh
// ---------------------------------------------------------------------------

/// Ticks every half hour, refreshing whatever has aged out.
///
/// Fires once immediately so a reading exists before anyone looks, and checks
/// the setting on every pass rather than at startup — a user who switches the
/// feature off should not have to restart for the process spawns to stop.
pub fn spawn_usage_limits_runner(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            {
                let service = app.state::<UsageLimitsService>();
                if service.is_enabled() {
                    let now = chrono::Utc::now().timestamp();
                    match refresh_codex(&service, now).await {
                        Ok(Some(_)) => emit_changed(&app),
                        Ok(None) => {}
                        Err(error) => eprintln!("Usage limits: {error}"),
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(TIMER_TICK_SECS)).await;
        }
    });
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

    fn snapshot_at(observed_at: i64) -> UsageSnapshot {
        UsageSnapshot {
            provider: "codex".to_string(),
            plan_label: None,
            windows: vec![UsageWindow {
                limit_id: "codex".to_string(),
                limit_label: None,
                kind: WindowKind::SevenDay,
                label: "7 d".to_string(),
                used_percent: 40.0,
                resets_at: 1_787_301_067,
                window_minutes: 10080,
            }],
            credits: None,
            observed_at,
            source: "app-server".to_string(),
        }
    }

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
    fn an_unread_provider_always_needs_a_refresh() {
        assert!(needs_refresh(None, 1_000, 300));
    }

    #[test]
    fn a_recent_reading_is_left_alone() {
        let stored = snapshot_at(1_000);
        assert!(!needs_refresh(Some(&stored), 1_200, 300));
    }

    #[test]
    fn a_reading_at_exactly_the_ttl_is_refreshed() {
        let stored = snapshot_at(1_000);
        assert!(needs_refresh(Some(&stored), 1_300, 300));
    }

    #[test]
    fn a_reading_from_the_future_is_refreshed_rather_than_trusted() {
        // A clock that jumped backwards would otherwise pin the chip to a
        // number that never updates again.
        let stored = snapshot_at(9_000);
        assert!(needs_refresh(Some(&stored), 1_000, 300));
    }

    #[test]
    fn the_timer_ticks_far_less_often_than_a_reading_goes_stale() {
        // If this ever inverted, every tick would find a current reading and
        // the background refresh would quietly stop doing anything.
        assert!(TIMER_TICK_SECS as i64 > REFRESH_TTL_SECS);
    }
}
