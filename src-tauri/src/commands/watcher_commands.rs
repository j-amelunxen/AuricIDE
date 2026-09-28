use super::fs_utils::{birth_time_of_file, should_filter_watcher_path, walk_files_with_birth_time};
use crate::recent_creations::RecentCreations;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

/// How long a burst of filesystem events is collected before it crosses to
/// the webview as one message. The frontend debounces its tree refresh at
/// 300 ms anyway; this only stops a build or an agent from sending one IPC
/// message per touched path.
const BATCH_WINDOW: Duration = Duration::from_millis(150);

pub struct WatcherState {
    pub watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct FileEvent {
    pub path: String,
    pub kind: String,
    /// Whether the path existed when the batch was sent. Lets the frontend
    /// tell a rename over an existing file (a save) from a path appearing or
    /// vanishing, without a stat of its own.
    pub exists: bool,
}

/// One raw watcher event: path and notify's `EventKind` in Debug form.
pub type RawFileEvent = (String, String);

/// Turns a collected burst into what the webview receives: exact repeats
/// dropped (first occurrence keeps its place), and each path's existence
/// asked once. Different kinds for the same path all stay — whether a kind
/// changes the set of paths is the frontend's rule, not duplicated here.
pub fn finish_batch(raw: Vec<RawFileEvent>, exists: impl Fn(&str) -> bool) -> Vec<FileEvent> {
    let mut seen = HashSet::new();
    let mut known: HashMap<String, bool> = HashMap::new();
    let mut out = Vec::new();
    for (path, kind) in raw {
        if !seen.insert((path.clone(), kind.clone())) {
            continue;
        }
        let present = *known.entry(path.clone()).or_insert_with(|| exists(&path));
        out.push(FileEvent {
            path,
            kind,
            exists: present,
        });
    }
    out
}

/// Collects events for `BATCH_WINDOW` after the first one of a burst, then
/// dates the files and emits the whole burst as one `file-events` message.
/// Ends when the watcher (the only sender) is dropped.
fn run_batcher(rx: Receiver<RawFileEvent>, app: tauri::AppHandle, recent: Arc<RecentCreations>) {
    while let Ok(first) = rx.recv() {
        let mut raw = vec![first];
        let deadline = Instant::now() + BATCH_WINDOW;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(event) => raw.push(event),
                Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
            }
        }
        let batch = finish_batch(raw, |path| Path::new(path).symlink_metadata().is_ok());
        for event in batch.iter().filter(|e| e.exists) {
            // Carry the folder dating forward instead of letting the next
            // directory read rebuild it by walking the subtree.
            if let Some(created) = birth_time_of_file(Path::new(&event.path)) {
                recent.note_file(&event.path, created);
            }
        }
        let _ = app.emit("file-events", batch);
    }
}

#[tauri::command]
pub async fn watch_directory(
    path: String,
    state: tauri::State<'_, WatcherState>,
    recent: tauri::State<'_, Arc<RecentCreations>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let path_clone = path.clone();
    let (tx, rx) = mpsc::channel::<RawFileEvent>();
    let recent_for_events = recent.inner().clone();
    std::thread::spawn(move || run_batcher(rx, app, recent_for_events));

    // Opened before the watcher is armed, so no event can arrive while the root
    // is unknown and be dropped. It closes when the seeding walk lands below;
    // until then `newest_by_child` reports "unknown" and reads fall back to
    // walking, which keeps the explorer correct the whole way — just not cheap.
    recent.begin_seeding(&path);

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let kind = format!("{:?}", event.kind);
                for p in event.paths {
                    let path_str = p.to_string_lossy().to_string();
                    if should_filter_watcher_path(&path_str) {
                        continue;
                    }
                    // The batcher only stops once this sender is dropped
                    // with the watcher, so a failed send means shutdown.
                    let _ = tx.send((path_str, kind.clone()));
                }
            }
        },
        Config::default().with_poll_interval(std::time::Duration::from_millis(500)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    watchers.insert(path_clone, watcher);
    drop(watchers);

    let recent_for_seed = recent.inner().clone();
    let root = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let files = walk_files_with_birth_time(Path::new(&root));
        recent_for_seed.seed_root(&root, &files);
    });

    Ok(())
}

#[tauri::command]
pub async fn unwatch_directory(
    path: String,
    state: tauri::State<'_, WatcherState>,
    recent: tauri::State<'_, Arc<RecentCreations>>,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    if let Some(mut watcher) = watchers.remove(&path) {
        watcher
            .unwatch(Path::new(&path))
            .map_err(|e| e.to_string())?;
    }
    recent.forget_root(&path);
    Ok(())
}
