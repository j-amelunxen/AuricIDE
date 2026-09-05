use super::fs_utils::{birth_time_of_file, should_filter_watcher_path, walk_files_with_birth_time};
use crate::recent_creations::RecentCreations;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

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

#[derive(Debug, Serialize, Clone)]
pub struct FileEvent {
    pub path: String,
    pub kind: String,
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

    let app_handle = app.clone();
    let path_clone = path.clone();
    let recent_for_events = recent.inner().clone();

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
                    // Carry the folder dating forward instead of letting the
                    // next directory read rebuild it by walking the subtree.
                    if let Some(created) = birth_time_of_file(&p) {
                        recent_for_events.note_file(&path_str, created);
                    }
                    let _ = app_handle.emit(
                        "file-event",
                        FileEvent {
                            path: path_str,
                            kind: kind.clone(),
                        },
                    );
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
