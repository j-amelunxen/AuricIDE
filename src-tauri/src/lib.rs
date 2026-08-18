mod agent_log;
mod agent_persistence;
mod agents;
mod app_config;
mod cc_usage;
pub mod crashlog;
mod database;
mod excalidraw;
mod git;
mod inbox;
mod llm;
mod mcp;
mod memory_report;
#[cfg(target_os = "macos")]
mod menu;
mod notifications;
mod project_icons;
mod project_skills;
mod provider_policy;
mod providers;
mod recent_creations;
mod recent_projects;
mod schedules;
mod themes;
mod usage_limits;
mod utf8_stream;
mod video_import;
mod webview_prefs;

use agents::AgentManagerState;
use database::{
    BlueprintState, DatabaseState, GoalsState, GoalsSyncPayload, KvEntry, PmSavePayload, PmState,
    RequirementsState,
};
use git::{
    git_blame, git_branch_info, git_commit, git_diff, git_diff_commit, git_diff_file_ref,
    git_diff_ref_files, git_discard, git_discover_repos, git_list_branches, git_log_since,
    git_projects_dirty, git_push, git_stage, git_status, git_unstage, git_worktree_add,
    git_worktree_list, git_worktree_remove,
};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use providers::ProviderRegistryState;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    /// Filesystem birth time in unix milliseconds. Absent for directories
    /// and when the OS does not report a creation time.
    created_at: Option<i64>,
    /// Newest descendant *file* birth time. Only set on directories, so a
    /// collapsed folder can glow without its children being loaded.
    newest_file_created_at: Option<i64>,
    /// Filesystem modification time in unix milliseconds. Files only, and
    /// deliberately no folder rollup: unlike creation, "recently modified"
    /// is common enough (every save) that bubbling it up to ancestors would
    /// leave most active folders lit for as long as they are worked in.
    modified_at: Option<i64>,
}

struct WatcherState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

struct TerminalState {
    sessions: Mutex<HashMap<String, Arc<AsyncMutex<TerminalSession>>>>,
}

struct TerminalSession {
    writer: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn MasterPty + Send>>,
}

#[derive(Debug, Serialize, Clone)]
struct FileEvent {
    path: String,
    kind: String,
}

#[tauri::command]
async fn check_cli_status(
    provider_id: Option<String>,
    providers: tauri::State<'_, ProviderRegistryState>,
) -> Result<bool, String> {
    let provider = match provider_id.as_deref() {
        Some(id) => providers
            .get(id)
            .unwrap_or_else(|| providers.default_provider()),
        None => providers.default_provider(),
    };
    let vc = provider.version_check();

    // Match the environment agents are actually spawned with (see
    // agents::cached_login_shell_env) — otherwise this check can report the
    // CLI as "missing" when it's only reachable via the user's shell PATH
    // (e.g. installed via nvm), even though spawning an agent would work fine.
    let mut command = Command::new(&vc.command);
    command.args(&vc.args);
    for (key, value) in agents::cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command.output().await;

    Ok(output.is_ok() && output.unwrap().status.success())
}

#[tauri::command]
async fn watch_directory(
    path: String,
    state: tauri::State<'_, WatcherState>,
    recent: tauri::State<'_, Arc<recent_creations::RecentCreations>>,
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
async fn unwatch_directory(
    path: String,
    state: tauri::State<'_, WatcherState>,
    recent: tauri::State<'_, Arc<recent_creations::RecentCreations>>,
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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn shell_spawn(
    id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            println!("Session '{}' already exists, skipping spawn", id);
            return Ok(());
        }
    }

    println!("Spawning PTY shell '{}' with id '{}'", command, id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.args(args);
    if let Some(ref c) = cwd {
        cmd.cwd(c);
    }
    // GUI apps on macOS launch with a minimal PATH — give terminal sessions
    // the same login-shell environment agents get (see agents.rs).
    for (key, value) in agents::cached_login_shell_env().await {
        cmd.env(key, value);
    }
    // Ensure child processes see a proper terminal type.
    // GUI apps on macOS do not inherit TERM from the user's shell.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(pair.master),
    }));

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(id.clone(), session);
    }

    let app_stdout = app.clone();
    let id_stdout = id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 16_384];
        let mut decoder = utf8_stream::Utf8StreamDecoder::new();
        let mut accumulated = String::new();
        let mut last_emit = std::time::Instant::now();
        let batch_interval = std::time::Duration::from_millis(16);

        loop {
            let n = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };

            // Decode only complete UTF-8 sequences; the decoder keeps trailing
            // incomplete bytes for the next read.
            accumulated.push_str(&decoder.push(&buffer[..n]));

            // Emit batched output every ~16 ms or when the buffer is large enough
            if last_emit.elapsed() >= batch_interval || accumulated.len() > 32_000 {
                if !accumulated.is_empty() {
                    let batch = std::mem::take(&mut accumulated);
                    let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), batch);
                }
                last_emit = std::time::Instant::now();
            }
        }

        // Flush any remaining data
        accumulated.push_str(&decoder.finish());
        if !accumulated.is_empty() {
            let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), accumulated);
        }
    });

    Ok(())
}

#[tauri::command]
async fn shell_write(
    id: String,
    data: String,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned().ok_or("Session not found")?
    };

    let mut session = session_arc.lock().await;
    if let Some(ref mut writer) = session.writer {
        if let Err(e) = writer.write_all(data.as_bytes()) {
            let err_msg = e.to_string();
            // If it's a broken pipe or I/O error, the session is likely dead
            println!("I/O Error writing to session '{}': {}", id, err_msg);
            drop(session); // release lock before removing
            let mut sessions = state.sessions.lock().unwrap();
            sessions.remove(&id);
            return Err(format!("Terminal session closed: {}", err_msg));
        }
        let _ = writer.flush();
    }
    Ok(())
}

#[tauri::command]
async fn shell_resize(
    id: String,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let session_arc = {
        let sessions = state.sessions.lock().unwrap();
        sessions.get(&id).cloned().ok_or("Session not found")?
    };

    let session = session_arc.lock().await;
    if let Some(ref master) = session.master {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_image_to_path(base64_data: String, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::io::Write;

    let data = base64_data
        .split(',')
        .next_back()
        .ok_or("Invalid base64 data")?;

    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    let file_path = Path::new(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_temp_image(base64_data: String, app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::io::Write;

    let data = base64_data
        .split(',')
        .next_back()
        .ok_or("Invalid base64 data")?;

    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    let temp_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }

    let file_name = format!(
        "screenshot_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let file_path = temp_dir.join(file_name);
    let mut file = fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Scratch files live in one global directory under the app-data dir,
/// independent of any opened project.
fn ensure_scratch_dir(base: std::path::PathBuf) -> Result<std::path::PathBuf, String> {
    let dir = base.join("scratches");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn get_scratch_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = ensure_scratch_dir(base)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_system_memory(
    agent_state: tauri::State<'_, agents::AgentManagerState>,
) -> Result<Vec<memory_report::SystemProcessEntry>, String> {
    // Agent processes are labeled by their real name instead of drowning in
    // an anonymous child-process bucket.
    let known: Vec<memory_report::KnownProcess> = {
        let manager = agent_state.lock().await;
        manager
            .agents
            .values()
            .filter_map(|agent| {
                agent
                    .child
                    .process_id()
                    .map(|pid| memory_report::KnownProcess {
                        pid,
                        label: format!("Agent: {}", agent.info.name),
                    })
            })
            .collect()
    };

    let entries = memory_report::read_ps_entries();
    Ok(memory_report::build_memory_report(
        std::process::id(),
        &entries,
        &known,
    ))
}

#[tauri::command]
fn append_metrics_log(line: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;

    if !log_dir.exists() {
        fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }

    let log_path = log_dir.join("memory-metrics.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open metrics log: {}", e))?;

    writeln!(file, "{}", line).map_err(|e| format!("Failed to write metrics log: {}", e))?;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ProjectFileInfo {
    path: String,
    extension: String,
    line_count: usize,
}

#[tauri::command]
async fn get_project_files_info(root_path: String) -> Result<Vec<ProjectFileInfo>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("Invalid root path".to_string());
    }

    let entries: Vec<ProjectFileInfo> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target" && name != ".auric"
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path();
            let extension = path
                .extension()
                .map(|ext| ext.to_string_lossy().to_string())
                .unwrap_or_default();

            // Only count lines for text files (heuristically)
            let is_text = matches!(
                extension.as_str(),
                "ts" | "tsx"
                    | "js"
                    | "jsx"
                    | "rs"
                    | "py"
                    | "md"
                    | "json"
                    | "html"
                    | "css"
                    | "toml"
                    | "yml"
                    | "yaml"
                    | "txt"
            );

            if !is_text {
                return None;
            }

            let content = fs::read_to_string(path).ok()?;
            let line_count = content.lines().count();

            Some(ProjectFileInfo {
                path: path.to_string_lossy().to_string(),
                extension,
                line_count,
            })
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
async fn list_all_files(root_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("Invalid root path".to_string());
    }

    let entries: Vec<String> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target" && name != ".auric"
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();

    Ok(entries)
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SearchMatch {
    path: String,
    line: usize,
    column: usize,
    line_text: String,
}

const SEARCH_MAX_RESULTS: usize = 500;
/// Long lines (minified JS, single-line JSON) would otherwise dwarf the payload.
const SEARCH_LINE_TEXT_CAP: usize = 300;

/// Plain substring search across every text file under `root_path`, skipping
/// the same dirs `list_all_files`/`get_project_files_info` skip. Files that
/// aren't valid UTF-8 (binaries) are silently skipped rather than failing
/// the whole search — one unreadable file shouldn't block the rest.
pub fn search_in_files_impl(
    root_path: &str,
    query: &str,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    let root = Path::new(root_path);
    if !root.is_dir() {
        return Err("Invalid root path".to_string());
    }
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut results = Vec::new();
    'walk: for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target" && name != ".auric"
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };

        for (idx, line) in content.lines().enumerate() {
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if let Some(byte_col) = haystack.find(&needle) {
                let column = haystack[..byte_col].chars().count() + 1;
                let line_text: String = line.chars().take(SEARCH_LINE_TEXT_CAP).collect();
                results.push(SearchMatch {
                    path: path.to_string_lossy().to_string(),
                    line: idx + 1,
                    column,
                    line_text,
                });
                if results.len() >= max_results {
                    break 'walk;
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn search_in_files(
    root_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchMatch>, String> {
    search_in_files_impl(&root_path, &query, case_sensitive, SEARCH_MAX_RESULTS)
}

/// Async so the recursive birth-time walk runs on Tauri's thread pool. A plain
/// `fn` command runs on the main thread, where the walk of a large project
/// blocks the UI for tens of milliseconds on every watcher-driven refresh.
#[tauri::command]
async fn read_directory(
    path: String,
    recent: tauri::State<'_, Arc<recent_creations::RecentCreations>>,
) -> Result<Vec<FileEntry>, String> {
    let recent = recent.inner().clone();
    read_directory_dated_by(&path, |dir| {
        recent
            .newest_by_child(&dir.to_string_lossy())
            .unwrap_or_else(|| newest_file_created_at_by_child(dir))
    })
}

#[tauri::command]
fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[tauri::command]
fn is_dir(path: &str) -> bool {
    Path::new(path).is_dir()
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    read_file_impl(path)
}

#[tauri::command]
fn read_file_base64(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = fs::read(path).map_err(|e| format!("Failed to read binary file: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<(), String> {
    write_file_impl(path, content)
}

#[tauri::command]
fn copy_file(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dest = Path::new(&destination);

    if src.is_dir() {
        copy_dir_recursive(src, dest).map_err(|e| e.to_string())
    } else {
        fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dest.join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Move a file or directory to a new absolute path (drag-and-drop in the
/// explorer). Refuses to clobber an existing target or move a directory into
/// its own subtree, and falls back to copy+delete across filesystems.
#[tauri::command]
fn move_path(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dest = Path::new(&destination);

    if !src.exists() {
        return Err(format!("Source no longer exists: {}", source));
    }
    if dest.exists() {
        let name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("that name");
        return Err(format!("An item named \"{}\" already exists here", name));
    }
    // Never move a directory into itself or one of its descendants.
    if src.is_dir() {
        if let (Ok(src_canon), Some(parent)) = (src.canonicalize(), dest.parent()) {
            if let Ok(parent_canon) = parent.canonicalize() {
                if parent_canon == src_canon || parent_canon.starts_with(&src_canon) {
                    return Err("Cannot move a folder into itself".to_string());
                }
            }
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        // rename() fails across filesystems (EXDEV): fall back to copy + delete.
        Err(_) => {
            if src.is_dir() {
                copy_dir_recursive(src, dest).map_err(|e| e.to_string())?;
                fs::remove_dir_all(src).map_err(|e| e.to_string())?;
            } else {
                fs::copy(src, dest).map_err(|e| e.to_string())?;
                fs::remove_file(src).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

/// Marker in the sibling temp file name an atomic write uses. Defined once so
/// the writer and the watcher filter can never disagree about what to hide.
const ATOMIC_WRITE_MARKER: &str = ".tmp-";

/// True for the short-lived sibling file `write_file_impl` renames into place.
/// Its shape is `.{name}.tmp-{pid}-{counter}`; both trailing parts must be
/// numeric so a user's own `.notes.tmp-draft` stays visible.
pub fn is_atomic_write_temp(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    if !name.starts_with('.') {
        return false;
    }
    let Some((_, tail)) = name.rsplit_once(ATOMIC_WRITE_MARKER) else {
        return false;
    };
    match tail.split_once('-') {
        Some((pid, counter)) => {
            !pid.is_empty()
                && !counter.is_empty()
                && pid.chars().all(|c| c.is_ascii_digit())
                && counter.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

/// Returns true if the path should be filtered out from file watcher events.
pub fn should_filter_watcher_path(path: &str) -> bool {
    path.contains("/.git/")
        || path.contains("/node_modules/")
        || path.contains("/target/")
        || path.contains("/.next/")
        || path.contains("/.turbo/")
        || path.contains("/__pycache__/")
        || path.contains("/.venv/")
        || path.contains("/venv/")
        || path.contains("/.pytest_cache/")
        || path.contains("/.mypy_cache/")
        || path.contains("/.ruff_cache/")
        || path.contains("/coverage/")
        || path.contains("/playwright-report/")
        || path.contains("/test-results/")
        || path.contains("/out/")
        || path.contains("/dist/")
        || path.contains("/.cache/")
        || path.ends_with("/.DS_Store")
        || path.ends_with("/Thumbs.db")
        || is_atomic_write_temp(path)
}

/// Birth time in unix milliseconds. Directories are omitted so the explorer
/// only lights up files — "created just now" is a file-row signal.
fn file_created_at_ms(entry: &walkdir::DirEntry) -> Option<i64> {
    if entry.file_type().is_dir() {
        return None;
    }
    let created = entry.metadata().ok()?.created().ok()?;
    let duration = created.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

/// Modification time in unix milliseconds. Directories are omitted for the
/// same reason as `file_created_at_ms`: this is a file-row signal.
fn file_modified_at_ms(entry: &walkdir::DirEntry) -> Option<i64> {
    if entry.file_type().is_dir() {
        return None;
    }
    let modified = entry.metadata().ok()?.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

pub(crate) fn skip_recent_walk_dir(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    name.ends_with(".auric-wt")
        || matches!(
            name.as_ref(),
            ".git"
                | "node_modules"
                | "target"
                | ".next"
                | ".turbo"
                | "__pycache__"
                | ".venv"
                | "venv"
                | ".pytest_cache"
                | ".mypy_cache"
                | ".ruff_cache"
                | "coverage"
                | "playwright-report"
                | "test-results"
                | "out"
                | "dist"
                | ".cache"
        )
}

/// Every file under `root` with its birth time, pruned exactly like the
/// directory walk — cache and fallback must agree on what counts, or a folder
/// would be dated differently depending on which of the two answered.
fn walk_files_with_birth_time(root: &Path) -> Vec<(String, i64)> {
    WalkDir::new(root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !skip_recent_walk_dir(e))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path().to_string_lossy().to_string();
            if should_filter_watcher_path(&path) {
                return None;
            }
            Some((path, file_created_at_ms(&e)?))
        })
        .collect()
}

/// Birth time of `path` in unix milliseconds, but only when it is a file.
/// Directories are excluded for the same reason as in the walk: "created just
/// now" is a signal about files.
fn birth_time_of_file(path: &Path) -> Option<i64> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let created = meta.created().ok()?;
    Some(
        created
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as i64,
    )
}

/// Newest file birth time under each immediate child of `dir`, one walk.
fn newest_file_created_at_by_child(dir: &Path) -> HashMap<String, i64> {
    let mut newest: HashMap<String, i64> = HashMap::new();
    // `min_depth(2)` must NOT be used here: walkdir applies `filter_entry` only
    // to entries the iterator actually yields, so a min-depth of 2 hides every
    // depth-1 directory from the predicate and `.git` gets walked in full
    // (4k+ files in this repo) only for the results to be dropped below. Walk
    // from depth 1 so the prune sees the top-level directories, and skip the
    // depth-1 entries afterwards instead.
    for entry in WalkDir::new(dir)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !skip_recent_walk_dir(e))
        .filter_map(|e| e.ok())
    {
        if entry.depth() < 2 || !entry.file_type().is_file() {
            continue;
        }
        let path_str = entry.path().to_string_lossy();
        if should_filter_watcher_path(&path_str) {
            continue;
        }
        let Some(created) = file_created_at_ms(&entry) else {
            continue;
        };
        let Ok(rel) = entry.path().strip_prefix(dir) else {
            continue;
        };
        let Some(first) = rel.components().next() else {
            continue;
        };
        let key = first.as_os_str().to_string_lossy().into_owned();
        newest
            .entry(key)
            .and_modify(|t| {
                if created > *t {
                    *t = created;
                }
            })
            .or_insert(created);
    }
    newest
}

// Pure functions for testability
pub fn read_directory_impl(path: &str) -> Result<Vec<FileEntry>, String> {
    read_directory_dated_by(path, newest_file_created_at_by_child)
}

/// `read_directory_impl` with the expensive half swapped out: `newest_by_child`
/// supplies the newest descendant-file birth time per child directory. The
/// default walks the subtree; the command hands in a maintained cache instead
/// and only falls back to the walk for directories nothing is known about.
fn read_directory_dated_by(
    path: &str,
    newest_by_child: impl FnOnce(&Path) -> HashMap<String, i64>,
) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let newest_by_child = newest_by_child(dir);

    let mut entries: Vec<FileEntry> = WalkDir::new(dir)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_directory = entry.file_type().is_dir();
            FileEntry {
                created_at: file_created_at_ms(&entry),
                newest_file_created_at: if is_directory {
                    newest_by_child.get(&name).copied()
                } else {
                    None
                },
                modified_at: file_modified_at_ms(&entry),
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_directory,
            }
        })
        .collect();

    // Sort: directories first, then files, both alphabetically
    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

pub fn read_file_impl(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Distinguishes concurrent writes within this process; the pid separates processes.
static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes a file so it is never observed half-written.
///
/// `fs::write` truncates the target and then fills it. A crash, a power loss or
/// a disk that runs out of space between those two steps leaves the user with a
/// truncated or empty file — and the editor autosaves continuously, so that
/// window is open all day. Writing to a sibling temp file and renaming it over
/// the target closes it: `rename` within a directory is atomic, so a reader
/// sees either the old file or the new one, never a partial one.
pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    let requested = Path::new(path);
    // Resolve symlinks first: renaming onto a link would replace the link
    // itself with a regular file, silently detaching it from its target.
    let target = fs::canonicalize(requested).unwrap_or_else(|_| requested.to_path_buf());

    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "Failed to write file: path has no parent directory".to_string())?;

    // The temp file must share the target's directory — rename is only atomic
    // within a filesystem, and /tmp is frequently a different one.
    let file_name = target
        .file_name()
        .ok_or_else(|| "Failed to write file: path has no file name".to_string())?
        .to_string_lossy()
        .to_string();
    let temp_path = dir.join(format!(
        ".{}{}{}-{}",
        file_name,
        ATOMIC_WRITE_MARKER,
        std::process::id(),
        WRITE_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(content.as_bytes())?;
        // Without this, the rename can land before the content does and a
        // power loss leaves an atomically-renamed empty file.
        file.sync_all()?;
        drop(file);

        // A fresh temp file carries default permissions; the target may be an
        // executable script or have deliberately tightened access.
        if let Ok(metadata) = fs::metadata(&target) {
            fs::set_permissions(&temp_path, metadata.permissions())?;
        }

        fs::rename(&temp_path, &target)
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to write file: {}", e));
    }

    Ok(())
}

#[tauri::command]
async fn list_agents(
    state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<agents::AgentInfo>, String> {
    agents::list_agents_impl(&state).await
}

#[tauri::command]
async fn spawn_agent(
    config: agents::AgentConfig,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    provider_state: tauri::State<'_, ProviderRegistryState>,
    app: tauri::AppHandle,
) -> Result<agents::AgentInfo, String> {
    spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app).await
}

/// Shared spawn path for `spawn_agent` and `resume_interrupted_agent`:
/// spawns the PTY process and registers its terminal session.
async fn spawn_agent_with_session(
    config: agents::AgentConfig,
    state: &AgentManagerState,
    terminal_state: &TerminalState,
    provider_state: &ProviderRegistryState,
    app: tauri::AppHandle,
) -> Result<agents::AgentInfo, String> {
    // On natural termination the reaper drops the terminal session — without
    // this, every finished agent leaked its PTY master, writer, and FDs.
    let app_for_cleanup = app.clone();
    let (info, writer, master) = agents::spawn_agent_impl(
        config,
        state,
        &app,
        provider_state,
        move |agent_id: String| {
            let ts = app_for_cleanup.state::<TerminalState>();
            let mut sessions = ts.sessions.lock().unwrap();
            sessions.remove(&format!("agent-{}", agent_id));
        },
    )
    .await?;

    // Register agent PTY writer and master in the global terminal state
    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(master),
    }));

    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        sessions.insert(format!("agent-{}", info.id), session);
    }

    // Close the fast-exit race: if the agent already terminated (the reaper
    // removed it from the registry before this insert), drop the session now.
    {
        let manager = state.lock().await;
        if !manager.agents.contains_key(&info.id) {
            let mut sessions = terminal_state.sessions.lock().unwrap();
            sessions.remove(&format!("agent-{}", info.id));
        }
    }

    Ok(info)
}

#[tauri::command]
async fn kill_agent(
    agent_id: String,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 1. Clean up terminal session first (prevents dangling handles)
    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        sessions.remove(&format!("agent-{}", agent_id));
    }

    // 2. Kill the agent in the manager (handles removal and status emission)
    agents::kill_agent_impl(&agent_id, &state, &app).await
}

#[tauri::command]
async fn rename_agent(
    agent_id: String,
    name: String,
    state: tauri::State<'_, AgentManagerState>,
    app: tauri::AppHandle,
) -> Result<agents::AgentInfo, String> {
    agents::rename_agent_impl(&agent_id, &name, &state, &app).await
}

// ── Interrupted agents (restart persistence) ────────────────────────

#[tauri::command]
async fn list_interrupted_agents(
    persistence: tauri::State<'_, agent_persistence::AgentPersistenceState>,
) -> Result<Vec<agent_persistence::PersistedAgent>, String> {
    let p = persistence.lock().map_err(|e| e.to_string())?;
    Ok(p.interrupted())
}

#[tauri::command]
async fn discard_interrupted_agent(
    agent_id: String,
    persistence: tauri::State<'_, agent_persistence::AgentPersistenceState>,
) -> Result<(), String> {
    let mut p = persistence.lock().map_err(|e| e.to_string())?;
    if p.discard_interrupted(&agent_id) {
        Ok(())
    } else {
        Err(format!("Interrupted agent not found: {}", agent_id))
    }
}

#[tauri::command]
async fn resume_interrupted_agent(
    agent_id: String,
    persistence: tauri::State<'_, agent_persistence::AgentPersistenceState>,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    provider_state: tauri::State<'_, ProviderRegistryState>,
    app: tauri::AppHandle,
) -> Result<agents::AgentInfo, String> {
    let persisted = {
        let mut p = persistence.lock().map_err(|e| e.to_string())?;
        p.take_interrupted(&agent_id)
            .ok_or_else(|| format!("Interrupted agent not found: {}", agent_id))?
    };

    let config = agents::AgentConfig {
        name: persisted.name,
        model: persisted.model,
        task: agents::resume_task_prompt(&persisted.task),
        cwd: persisted.cwd,
        permission_mode: persisted.permission_mode,
        dangerously_ignore_permissions: Some(persisted.dangerously_ignore_permissions),
        auto_accept_edits: Some(persisted.auto_accept_edits),
        provider: Some(persisted.provider),
        headless: Some(persisted.headless),
        spawned_by_ticket_id: persisted.spawned_by_ticket_id,
        spawned_by_goal_id: persisted.spawned_by_goal_id,
    };

    spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app).await
}

#[tauri::command]
async fn kill_agents_for_repo(
    repo_path: String,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    // 1. Identify agents for this repo path
    let ids_to_kill: Vec<String> = {
        let manager = state.lock().await;
        manager
            .agents
            .values()
            .filter(|p| p.info.repo_path.as_deref() == Some(&repo_path))
            .map(|p| p.info.id.clone())
            .collect()
    };

    // 2. Clean up terminal sessions for each identified agent
    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        for id in &ids_to_kill {
            sessions.remove(&format!("agent-{}", id));
        }
    }

    // 3. Kill agents in the backend
    agents::kill_agents_for_repo_impl(&repo_path, &state, &app).await
}

#[tauri::command]
fn list_providers(state: tauri::State<'_, ProviderRegistryState>) -> Vec<providers::ProviderInfo> {
    state.list_providers()
}

#[tauri::command]
fn import_provider(
    json: String,
    state: tauri::State<'_, ProviderRegistryState>,
) -> Result<providers::ProviderInfo, String> {
    state.import_provider(&json)
}

/// Discover user-supplied Theme JSON files (validation is frontend-side).
#[tauri::command]
fn list_themes(app: tauri::AppHandle) -> Vec<themes::ThemeFile> {
    themes::scan_themes(Some(&app))
}

/// Copy a validated theme JSON into `<app_data>/themes/<filename>`.
#[tauri::command]
fn import_theme(
    app: tauri::AppHandle,
    content: String,
    filename: String,
) -> Result<themes::ThemeFile, String> {
    let dir = themes::user_themes_dir(&app)?;
    themes::install_theme_file(&dir, &filename, &content)
}

#[tauri::command]
fn get_prompt_template(
    provider_id: Option<String>,
    state: tauri::State<'_, ProviderRegistryState>,
) -> providers::PromptTemplate {
    let provider = match provider_id.as_deref() {
        Some(id) => state.get(id).unwrap_or_else(|| state.default_provider()),
        None => state.default_provider(),
    };
    provider.prompt_template()
}

#[tauri::command]
fn init_project_db(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut connections = state.connections.lock().unwrap();
    if connections.contains_key(&project_path) {
        return Ok(());
    }
    let conn = database::init_db(&project_path)?;
    connections.insert(project_path, conn);
    Ok(())
}

#[tauri::command]
fn db_get(
    project_path: String,
    namespace: String,
    key: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Option<String>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_get(conn, &namespace, &key)
}

#[tauri::command]
fn db_set(
    project_path: String,
    namespace: String,
    key: String,
    value: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_set(conn, &namespace, &key, &value)
}

#[tauri::command]
fn db_delete(
    project_path: String,
    namespace: String,
    key: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<bool, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_delete(conn, &namespace, &key)
}

#[tauri::command]
fn db_list(
    project_path: String,
    namespace: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<KvEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_list(conn, &namespace)
}

#[tauri::command]
fn close_project_db(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut connections = state.connections.lock().unwrap();
    connections.remove(&project_path);
    Ok(())
}

#[tauri::command]
fn db_export(
    project_path: String,
    destination_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    // 1. Flush WAL to main DB file (checkpoint)
    {
        let connections = state.connections.lock().unwrap();
        if let Some(conn) = connections.get(&project_path) {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|e| format!("Failed to checkpoint database: {}", e))?;
        }
    }

    let auric_dir = database::ensure_auric_dir(&project_path)?;
    let db_path = auric_dir.join("project.db");

    if !db_path.exists() {
        return Err("Database file not found".to_string());
    }

    fs::copy(db_path, destination_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to export database: {}", e))
}

#[tauri::command]
fn db_import(
    project_path: String,
    source_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    // 1. Close current connection
    {
        let mut connections = state.connections.lock().unwrap();
        connections.remove(&project_path);
    }

    // 2. Ensure .auric dir exists
    let auric_dir = database::ensure_auric_dir(&project_path)?;
    let db_path = auric_dir.join("project.db");

    // 3. Delete old DB and its WAL/SHM files to prevent conflicts
    let _ = fs::remove_file(auric_dir.join("project.db-wal"));
    let _ = fs::remove_file(auric_dir.join("project.db-shm"));
    if db_path.exists() {
        fs::remove_file(&db_path).map_err(|e| format!("Failed to remove old database: {}", e))?;
    }

    // 4. Copy new database file
    fs::copy(source_path, &db_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to import database: {}", e))?;

    // 5. Re-initialize (run migrations etc)
    let conn = database::init_db(&project_path)?;
    let mut connections = state.connections.lock().unwrap();
    connections.insert(project_path, conn);

    Ok(())
}

#[tauri::command]
fn pm_save(
    project_path: String,
    payload: PmSavePayload,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_save_impl(conn, &payload)
}

#[tauri::command]
fn pm_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<PmState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_load_impl(conn)
}

#[tauri::command]
fn pm_load_history(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<database::PmStatusHistoryEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_load_history_impl(conn)
}

#[tauri::command]
fn agent_prompt_history_add(
    project_path: String,
    entry: database::AgentPromptHistoryEntry,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::agent_prompt_history_add_impl(conn, &entry)
}

#[tauri::command]
fn agent_prompt_history_list(
    project_path: String,
    limit: Option<usize>,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<database::AgentPromptHistoryEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::agent_prompt_history_list_impl(conn, limit)
}

#[tauri::command]
fn pm_latest_ticket_review(
    project_path: String,
    ticket_id: String,
    since_iso: Option<String>,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Option<database::TicketReview>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_latest_ticket_review_impl(conn, &ticket_id, since_iso.as_deref())
}

#[tauri::command]
fn pm_clear(project_path: String, state: tauri::State<'_, DatabaseState>) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_clear_impl(conn)
}

#[tauri::command]
fn blueprints_save(
    project_path: String,
    payload: BlueprintState,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_save_impl(conn, &payload)
}

#[tauri::command]
fn blueprints_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<BlueprintState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_load_impl(conn)
}

#[tauri::command]
fn blueprints_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_clear_impl(conn)
}

// --- Notification inbox -----------------------------------------------------
// One global inbox across every project, so a message from a repo you are not
// currently looking at is still waiting when you come back.

#[tauri::command]
fn notifications_dispatch(
    payload: notifications::NotificationInput,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<notifications::Notification, String> {
    let mut conn = state.conn.lock().unwrap();
    notifications::dispatch_impl(&mut conn, &payload)
}

#[tauri::command]
fn notifications_list(
    since_id: Option<i64>,
    limit: Option<usize>,
    project_path: Option<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<Vec<notifications::Notification>, String> {
    let conn = state.conn.lock().unwrap();
    notifications::list_impl(&conn, since_id, limit, project_path.as_deref())
}

#[tauri::command]
fn notifications_mark_read(
    uids: Vec<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::mark_read_impl(&conn, &uids)
}

#[tauri::command]
fn notifications_mark_all_read(
    project_path: Option<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::mark_all_read_impl(&conn, project_path.as_deref())
}

#[tauri::command]
fn notifications_answer(
    uid: String,
    answer: String,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::answer_impl(&conn, &uid, &answer)
}

#[tauri::command]
fn notifications_unread_count(
    project_path: Option<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    notifications::unread_count_impl(&conn, project_path.as_deref())
}

#[tauri::command]
fn notifications_clear(
    project_path: Option<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::clear_impl(&conn, project_path.as_deref())
}

#[tauri::command]
fn notifications_delete(
    uids: Vec<String>,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::delete_impl(&conn, &uids)
}

// --- Inbox (Fast Access Task Box) -------------------------------------------
// App-level GTD inbox: items are captured globally, then assigned to a
// project, which creates a real ticket in that project's `.auric/project.db`.

#[tauri::command]
fn inbox_list(state: tauri::State<'_, inbox::InboxState>) -> Result<Vec<inbox::InboxItem>, String> {
    let conn = state.conn.lock().unwrap();
    inbox::list_impl(&conn)
}

#[tauri::command]
fn inbox_add(
    input: inbox::InboxItemInput,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::add_impl(&conn, &input)
}

#[tauri::command]
fn inbox_update(
    id: String,
    patch: inbox::InboxItemPatch,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::update_impl(&conn, &id, &patch)
}

#[tauri::command]
fn inbox_dismiss(id: String, state: tauri::State<'_, inbox::InboxState>) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    inbox::dismiss_impl(&conn, &id)
}

#[tauri::command]
fn inbox_assign(
    request: inbox::InboxAssignRequest,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::assign_impl(&conn, &request)
}

#[tauri::command]
fn inbox_unassign(
    id: String,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::unassign_impl(&conn, &id)
}

#[tauri::command]
fn inbox_attach(
    item_id: String,
    source_path: String,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::attach_impl(
        &conn,
        &state.attachments_dir,
        &item_id,
        std::path::Path::new(&source_path),
    )
}

#[tauri::command]
fn inbox_detach(
    item_id: String,
    attachment_id: String,
    state: tauri::State<'_, inbox::InboxState>,
) -> Result<inbox::InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::detach_impl(&conn, &item_id, &attachment_id)
}

/// Reads several projects' `.auric/project.db` files read-only, so a
/// possibly large batch does not block the main thread.
#[tauri::command]
async fn projects_pm_overview(
    project_paths: Vec<String>,
) -> Result<Vec<inbox::ProjectPmOverview>, String> {
    tauri::async_runtime::spawn_blocking(move || inbox::projects_pm_overview_impl(&project_paths))
        .await
        .map_err(|e| e.to_string())
}

// --- Agent activity log -----------------------------------------------------
// Opt-in history for the Agent Console's feed. App-global for the same reason
// the inbox is: the console shows several repos at once.

#[tauri::command]
fn agent_log_append(
    events: Vec<agent_log::AgentLogEvent>,
    state: tauri::State<'_, agent_log::AgentLogState>,
) -> Result<(), String> {
    state.with_connection(|conn| agent_log::append_impl(conn, &events))
}

#[tauri::command]
fn agent_log_load(
    limit: u32,
    state: tauri::State<'_, agent_log::AgentLogState>,
) -> Result<Vec<agent_log::AgentLogEvent>, String> {
    state.with_connection(|conn| agent_log::load_impl(conn, limit))
}

#[tauri::command]
fn agent_log_prune(
    retention_days: u32,
    max_rows: u32,
    state: tauri::State<'_, agent_log::AgentLogState>,
) -> Result<u64, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    state.with_connection(|conn| agent_log::prune_impl(conn, retention_days, max_rows, now_ms))
}

#[tauri::command]
fn agent_log_purge(state: tauri::State<'_, agent_log::AgentLogState>) -> Result<(), String> {
    state.with_connection(|conn| agent_log::purge_impl(conn))
}

/// How often the runner looks. A schedule has no event to be driven by, so
/// this poll *is* the mechanism, not a watchdog over one.
const SCHEDULE_TICK_SECS: u64 = 30;

/// Starts the schedule runner.
///
/// The first pass happens immediately, and that pass is the catch-up: anything
/// that came due while the app was closed is noticed here, before the UI has
/// even finished loading. Deliberately in the backend rather than the frontend
/// for exactly that reason — a missed reminder must not depend on which panel
/// happens to get mounted.
fn spawn_schedule_runner(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        {
            let state = app.state::<notifications::NotificationsState>();
            let mut conn = match state.conn.lock() {
                Ok(conn) => conn,
                Err(_) => break,
            };
            match schedules::run_due_impl(&mut conn, chrono::Utc::now()) {
                Ok(fired) if fired > 0 => {
                    drop(conn);
                    let _ = app.emit("notifications-changed", ());
                }
                Ok(_) => {}
                Err(error) => eprintln!("Schedule runner failed: {error}"),
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(SCHEDULE_TICK_SECS));
    });
}

// --- Schedules ---------------------------------------------------------------
// Reminders that survive the app being closed. They only ever raise a
// notification; starting the work is always a human pressing a button.

#[tauri::command]
fn schedules_list(
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<Vec<schedules::Schedule>, String> {
    let conn = state.conn.lock().unwrap();
    schedules::list_impl(&conn)
}

#[tauri::command]
fn schedules_upsert(
    schedule: schedules::Schedule,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<schedules::Schedule, String> {
    let conn = state.conn.lock().unwrap();
    schedules::upsert_impl(&conn, &schedule)
}

#[tauri::command]
fn schedules_delete(
    id: String,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::delete_impl(&conn, &id)
}

#[tauri::command]
fn schedules_set_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, notifications::NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::set_enabled_impl(&conn, &id, enabled)
}

/// The next few occurrences, for the editor. A schedule you only discover is
/// wrong three weeks later is a trap, so the form shows its own future.
#[tauri::command]
fn schedules_preview(
    schedule: schedules::Schedule,
    count: Option<usize>,
) -> Result<Vec<String>, String> {
    schedules::preview_impl(&schedule, chrono::Utc::now(), count.unwrap_or(3))
}

#[tauri::command]
fn requirements_save(
    project_path: String,
    payload: RequirementsState,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_save_impl(conn, &payload)
}

#[tauri::command]
fn requirements_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<RequirementsState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_load_impl(conn)
}

#[tauri::command]
fn requirements_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_clear_impl(conn)
}

#[tauri::command]
fn goals_save(
    project_path: String,
    payload: GoalsSyncPayload,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_sync_impl(conn, &payload)
}

#[tauri::command]
fn goals_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<GoalsState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_load_impl(conn)
}

#[tauri::command]
fn goals_clear(project_path: String, state: tauri::State<'_, DatabaseState>) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_clear_impl(conn)
}

#[tauri::command]
async fn llm_call(
    request: llm::LlmRequest,
    db_state: tauri::State<'_, database::DatabaseState>,
    credentials: tauri::State<'_, app_config::AppCredentialsState>,
) -> Result<llm::LlmResponse, String> {
    llm::llm_call_impl(request, db_state, credentials).await
}

#[tauri::command]
async fn excalidraw_test_connection(
    project_path: String,
    db_state: tauri::State<'_, database::DatabaseState>,
    credentials: tauri::State<'_, app_config::AppCredentialsState>,
) -> Result<String, String> {
    excalidraw::test_connection_impl(&project_path, db_state, credentials).await
}

#[tauri::command]
async fn excalidraw_list_collections(
    project_path: String,
    db_state: tauri::State<'_, database::DatabaseState>,
    credentials: tauri::State<'_, app_config::AppCredentialsState>,
) -> Result<Vec<excalidraw::contract::Collection>, String> {
    excalidraw::list_collections_impl(&project_path, db_state, credentials).await
}

#[tauri::command]
async fn excalidraw_list_scenes(
    project_path: String,
    collection_id: String,
    db_state: tauri::State<'_, database::DatabaseState>,
    credentials: tauri::State<'_, app_config::AppCredentialsState>,
) -> Result<Vec<excalidraw::contract::SceneSummary>, String> {
    excalidraw::list_scenes_impl(&project_path, &collection_id, db_state, credentials).await
}

#[tauri::command]
async fn excalidraw_get_scene_content(
    project_path: String,
    scene_id: String,
    db_state: tauri::State<'_, database::DatabaseState>,
    credentials: tauri::State<'_, app_config::AppCredentialsState>,
) -> Result<String, String> {
    excalidraw::get_scene_content_impl(&project_path, &scene_id, db_state, credentials).await
}

#[tauri::command]
fn excalidraw_scene_url(workspace_id: Option<String>, scene_id: String) -> String {
    excalidraw::scene_url_impl(workspace_id.as_deref(), &scene_id)
}

#[tauri::command]
fn report_frontend_crash(
    error: crashlog::FrontendError,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::ensure_crash_dir(&log_dir)?;
    let report = crashlog::format_frontend_report(&error);
    let path = crashlog::write_crash_file(&crash_path, &report)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn list_crash_logs(app: tauri::AppHandle) -> Result<Vec<crashlog::CrashLogEntry>, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::crash_dir(&log_dir);
    crashlog::list_crash_logs(&crash_path)
}

#[tauri::command]
fn read_crash_log(filename: String, app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::crash_dir(&log_dir);
    crashlog::read_crash_log(&crash_path, &filename)
}

#[tauri::command]
async fn start_mcp(
    project_path: String,
    state: tauri::State<'_, mcp::McpServerState>,
    app: tauri::AppHandle,
) -> Result<mcp::McpStatusInfo, String> {
    // Resolve before taking the lock — the std MutexGuard must not live
    // across an await point.
    let mut shell_env = agents::cached_login_shell_env().await.to_vec();

    // Tells the MCP server where the shared inbox is, so an agent's `notify`
    // reaches the same list the app shows. Without it the notify tools are not
    // registered at all — an agent must be able to trust that a tool it can see
    // actually reaches someone.
    if let Ok(dir) = app.path().app_data_dir() {
        shell_env.push((
            "AURIC_NOTIFICATIONS_DB".to_string(),
            notifications::db_path_in(&dir)
                .to_string_lossy()
                .to_string(),
        ));
    }
    shell_env.push(("AURIC_PROJECT_ROOT".to_string(), project_path.clone()));

    let mut guard = state.process.lock().unwrap();
    if guard.is_some() {
        return Err("MCP server is already running".to_string());
    }

    let db_path = std::path::Path::new(&project_path)
        .join(".auric")
        .join("project.db");
    let db_path_str = db_path.to_string_lossy().to_string();

    let script_path = std::path::Path::new(&project_path)
        .join("src")
        .join("mcp")
        .join("server.ts");
    let script_path_str = script_path.to_string_lossy().to_string();

    let child = mcp::start_mcp_server(&db_path_str, &script_path_str, &shell_env)?;
    let pid = child.id();
    *guard = Some(child);

    Ok(mcp::McpStatusInfo {
        status: mcp::McpServerStatus::Running,
        pid: Some(pid),
    })
}

#[tauri::command]
fn stop_mcp(state: tauri::State<'_, mcp::McpServerState>) -> Result<(), String> {
    let mut guard = state.process.lock().unwrap();
    match guard.take() {
        Some(mut child) => mcp::stop_mcp_server(&mut child),
        None => Err("MCP server is not running".to_string()),
    }
}

#[tauri::command]
fn mcp_status(state: tauri::State<'_, mcp::McpServerState>) -> mcp::McpStatusInfo {
    mcp::get_mcp_status(&state)
}

/// Greys out the project-gated menu commands when no project is open, so the
/// native menu reports what the app can actually do right now. No-op off macOS,
/// where there is no app menu to keep honest.
#[tauri::command]
fn set_menu_command_states(app: tauri::AppHandle, project_open: bool) {
    #[cfg(target_os = "macos")]
    menu::set_command_states(&app, project_open);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, project_open);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                crashlog::set_crash_log_dir(log_dir);
            }
            app.manage(providers::new_provider_registry(Some(app.handle())));

            let recent_projects_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("recent-projects.json");
            app.manage(recent_projects::RecentProjectsState::initialize(
                recent_projects_path,
            ));
            // The notification inbox is app-global, not per project: agents run
            // in several repos at once here, and a message must still be waiting
            // when you come back to the project it came from.
            let notifications_db =
                notifications::db_path_in(&app.path().app_data_dir().map_err(|e| e.to_string())?);
            match notifications::init_db(&notifications_db) {
                Ok(conn) => {
                    let handle = app.handle().clone();
                    let watcher = notifications::watch_inbox(&notifications_db, move || {
                        let _ = handle.emit("notifications-changed", ());
                    })
                    .map_err(|error| {
                        eprintln!("Notification inbox watcher unavailable: {error}");
                        error
                    })
                    .ok();
                    app.manage(notifications::NotificationsState {
                        conn: std::sync::Mutex::new(conn),
                        watcher: std::sync::Mutex::new(watcher),
                    });
                    spawn_schedule_runner(app.handle().clone());
                }
                // A missing inbox must not stop the IDE from opening. The
                // commands then fail loudly per call instead.
                Err(error) => eprintln!("Notification inbox unavailable: {error}"),
            }

            // The GTD inbox is app-global for the same reason: a captured
            // thought does not yet belong to any one project.
            let task_inbox_db =
                inbox::db_path_in(&app.path().app_data_dir().map_err(|e| e.to_string())?);
            match inbox::init_db(&task_inbox_db) {
                Ok(conn) => {
                    app.manage(inbox::InboxState {
                        conn: std::sync::Mutex::new(conn),
                        attachments_dir: inbox::attachments_dir_in(
                            &app.path().app_data_dir().map_err(|e| e.to_string())?,
                        ),
                    });
                }
                // A missing inbox must not stop the IDE from opening either.
                Err(error) => eprintln!("Task inbox unavailable: {error}"),
            }

            // The agent activity log is app-global for the same reason. Only
            // the path is settled here: the store opens its database on first
            // use, so a user who leaves history off never gets a file.
            app.manage(agent_log::AgentLogState::new(agent_log::db_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            )));

            // The webview's own localStorage is scoped by data store and page
            // origin, neither of which matches between the dev binary and the
            // bundled app. Mirroring it here puts it on the same footing as
            // everything else the backend keeps: one file, one identifier.
            let webview_prefs_path = webview_prefs::prefs_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            );
            app.manage(webview_prefs::WebviewPrefsState::new(webview_prefs_path));

            // Credentials are application-wide too, but they stay out of the
            // mirror above: that store exists to copy whatever the webview puts
            // in localStorage, and an API key does not belong in a second copy
            // inside a WebKit database. This one is written by Rust at 0600.
            let credentials_path = app_config::credentials_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            );
            app.manage(app_config::AppCredentialsState::new(credentials_path));

            // CLI quota readings for the status bar. The service reads its own
            // on/off switch out of the mirror above on every call, so nothing
            // here decides whether it runs — only where it keeps its state.
            app.manage(usage_limits::UsageLimitsService::new(
                app.path().app_data_dir().map_err(|e| e.to_string())?,
            ));
            usage_limits::install_claude_watcher(app.handle());
            usage_limits::spawn_usage_limits_runner(app.handle().clone());

            // Historical spend, read from the CLIs' own transcripts. Separate
            // from the quota above on purpose: that one is a fuel gauge, this
            // one is a logbook, and neither can be derived from the other.
            app.manage(cc_usage::CcUsageService::new(
                app.path().app_data_dir().ok(),
                app.path().resource_dir().ok(),
                app.path().home_dir().map_err(|e| e.to_string())?,
            ));

            let starred_projects_path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join("starred-projects.json");
            app.manage(recent_projects::StarredProjectsState::initialize(
                starred_projects_path,
            ));

            // Restart persistence: agents running when the app last quit are
            // loaded as "interrupted" and offered for resume in the frontend.
            let persistence_path = app
                .path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("active-agents.json"));
            let persistence = agent_persistence::new_agent_persistence_state(persistence_path);
            // Seed the agent id counter past restored ids so a new spawn never
            // reuses the id of an interrupted agent still shown in the UI.
            let max_restored = persistence
                .lock()
                .map(|p| p.max_agent_number())
                .unwrap_or(0);
            app.manage(persistence);
            if max_restored > 0 {
                let manager_state = app.state::<AgentManagerState>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    let mut manager = manager_state.lock().await;
                    manager.counter = manager.counter.max(max_restored);
                });
            }

            // Pre-resolve the login-shell environment in the background so the
            // first agent spawn doesn't pay for it (see agents::warm_shell_env_cache).
            tauri::async_runtime::spawn(agents::warm_shell_env_cache());
            Ok(())
        })
        .manage(DatabaseState {
            connections: Mutex::new(HashMap::new()),
        })
        .manage(agents::new_agent_manager_state())
        .manage(mcp::McpServerState::new())
        .manage(Arc::new(recent_creations::RecentCreations::default()))
        .manage(WatcherState {
            watchers: Mutex::new(HashMap::new()),
        })
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            read_directory,
            exists,
            is_dir,
            list_all_files,
            get_project_files_info,
            search_in_files,
            read_file,
            read_file_base64,
            write_file,
            copy_file,
            delete_file,
            create_directory,
            move_path,
            save_temp_image,
            save_image_to_path,
            get_scratch_dir,
            check_cli_status,
            watch_directory,
            unwatch_directory,
            shell_spawn,
            shell_write,
            shell_resize,
            git_status,
            git_discover_repos,
            git_projects_dirty,
            git_branch_info,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_push,
            git_log_since,
            git_discard,
            git_list_branches,
            git_blame,
            git_diff_commit,
            git_diff_ref_files,
            git_diff_file_ref,
            git_worktree_add,
            git_worktree_list,
            git_worktree_remove,
            list_agents,
            spawn_agent,
            kill_agent,
            kill_agents_for_repo,
            rename_agent,
            list_interrupted_agents,
            resume_interrupted_agent,
            discard_interrupted_agent,
            list_providers,
            import_provider,
            list_themes,
            import_theme,
            get_prompt_template,
            get_system_memory,
            init_project_db,
            db_get,
            db_set,
            db_delete,
            db_list,
            db_export,
            db_import,
            close_project_db,
            pm_save,
            pm_load,
            pm_load_history,
            pm_clear,
            pm_latest_ticket_review,
            agent_prompt_history_add,
            agent_prompt_history_list,
            blueprints_save,
            blueprints_load,
            blueprints_clear,
            requirements_save,
            requirements_load,
            requirements_clear,
            notifications_dispatch,
            notifications_list,
            notifications_mark_read,
            notifications_mark_all_read,
            notifications_answer,
            notifications_unread_count,
            notifications_clear,
            notifications_delete,
            inbox_list,
            inbox_add,
            inbox_update,
            inbox_dismiss,
            inbox_assign,
            inbox_unassign,
            inbox_attach,
            inbox_detach,
            projects_pm_overview,
            agent_log_append,
            agent_log_load,
            agent_log_prune,
            agent_log_purge,
            schedules_list,
            schedules_upsert,
            schedules_delete,
            schedules_set_enabled,
            schedules_preview,
            goals_save,
            goals_load,
            goals_clear,
            append_metrics_log,
            report_frontend_crash,
            list_crash_logs,
            read_crash_log,
            llm_call,
            excalidraw_test_connection,
            excalidraw_list_collections,
            excalidraw_list_scenes,
            excalidraw_get_scene_content,
            excalidraw_scene_url,
            start_mcp,
            stop_mcp,
            mcp_status,
            set_menu_command_states,
            recent_projects::recent_projects_list,
            recent_projects::recent_projects_import,
            recent_projects::recent_projects_add,
            recent_projects::recent_projects_remove,
            recent_projects::starred_projects_list,
            recent_projects::starred_projects_import,
            recent_projects::starred_projects_add,
            recent_projects::starred_projects_remove,
            recent_projects::starred_projects_update_settings,
            webview_prefs::webview_prefs_sync,
            webview_prefs::webview_prefs_set,
            webview_prefs::webview_prefs_remove,
            app_config::app_credential_list,
            app_config::app_credential_set,
            usage_limits::usage_limits_read,
            usage_limits::usage_limits_refresh,
            cc_usage::cc_usage_plugins,
            cc_usage::cc_usage_report,
            project_skills::project_skills_list,
            project_icons::project_icon_candidates,
            video_import::video_import_analyze_media,
            video_import::video_import_preflight,
            video_import::video_import_install_local,
            video_import::video_import_save_process,
            video_import::video_import_clear
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(agents::cleanup_all_agents(app));
            }
        });

    // macOS gets Tauri's default menu, whose File and Window submenus both
    // bind "Close Window" to ⌘W — so ⌘W killed the whole window instead of a
    // tab. Rebind like Safari/Xcode: ⌘W becomes "Close Tab" (delegated to the
    // frontend tab bar via the menu:close-tab event), "Close Window" moves to
    // ⇧⌘W. The menu accelerator consumes the key before the webview sees it,
    // so this cannot be fixed in JavaScript alone.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(|handle| {
            use tauri::menu::{Menu, MenuItem, MenuItemKind};

            let menu = Menu::default(handle)?;
            for item in menu.items()? {
                let MenuItemKind::Submenu(submenu) = item else {
                    continue;
                };
                let is_file_menu = submenu.text().map(|t| t == "File").unwrap_or(false);
                for (position, sub_item) in submenu.items()?.iter().enumerate() {
                    let is_close_window = match sub_item {
                        MenuItemKind::Predefined(predefined) => predefined
                            .text()
                            .map(|t| t == "Close Window")
                            .unwrap_or(false),
                        _ => false,
                    };
                    if !is_close_window {
                        continue;
                    }
                    submenu.remove_at(position)?;
                    if is_file_menu {
                        submenu.insert(
                            &MenuItem::with_id(
                                handle,
                                "close_tab",
                                "Close Tab",
                                true,
                                Some("CmdOrCtrl+W"),
                            )?,
                            position,
                        )?;
                        submenu.insert(
                            &MenuItem::with_id(
                                handle,
                                "close_window",
                                "Close Window",
                                true,
                                Some("Shift+CmdOrCtrl+W"),
                            )?,
                            position + 1,
                        )?;
                    }
                    break;
                }
            }
            // Every command in the palette also gets a real menu item, so the
            // app is drivable through the one surface macOS always exposes
            // semantically — even while a modal owns the webview's focus.
            menu::extend_with_commands(handle, &menu)?;
            menu::polish_standard_items(&menu)?;

            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "close_tab" => {
                    let _ = app.emit("menu:close-tab", ());
                }
                "close_window" => {
                    let focused = app
                        .webview_windows()
                        .into_values()
                        .find(|w| w.is_focused().unwrap_or(false));
                    if let Some(window) = focused {
                        let _ = window.close();
                    }
                }
                // A manifest command. The frontend runs it through the very
                // same path the command palette uses, so a menu invocation and
                // a palette invocation are indistinguishable — including the
                // usage bookkeeping.
                other if other.contains('.') => {
                    let _ = app.emit("menu:command", other);
                }
                _ => {}
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn scratch_dir_is_created_under_the_base_and_is_idempotent() {
        let base = TempDir::new().unwrap();
        let dir = ensure_scratch_dir(base.path().to_path_buf()).unwrap();
        assert!(dir.is_dir());
        assert!(dir.ends_with("scratches"));
        let again = ensure_scratch_dir(base.path().to_path_buf()).unwrap();
        assert_eq!(dir, again);
    }

    #[test]
    fn atomic_write_temp_files_are_hidden_from_the_watcher() {
        assert!(is_atomic_write_temp("/project/.note.md.tmp-4321-0"));
        assert!(should_filter_watcher_path("/project/.note.md.tmp-4321-7"));
    }

    #[test]
    fn ordinary_files_are_not_mistaken_for_write_temp_files() {
        assert!(!is_atomic_write_temp("/project/note.md"));
        assert!(!is_atomic_write_temp("/project/.gitignore"));
        // A user's own temp-ish dotfile must stay visible.
        assert!(!is_atomic_write_temp("/project/.notes.tmp-draft"));
        assert!(!is_atomic_write_temp("/project/note.md.tmp-1-2"));
        assert!(!is_atomic_write_temp("/project/.note.md.tmp-1"));
    }

    #[test]
    fn the_temp_file_a_write_creates_is_one_the_watcher_hides() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("subdir");
        fs::create_dir(&path).unwrap();
        // Renaming onto a directory fails, so the temp file is observable.
        let _ = write_file_impl(path.to_str().unwrap(), "nope");

        // Nothing survives; had it, the watcher filter must have covered it.
        let leftovers: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().path().to_string_lossy().to_string())
            .filter(|p| !p.ends_with("subdir"))
            .collect();
        for leftover in &leftovers {
            assert!(
                is_atomic_write_temp(leftover),
                "unfiltered leftover: {leftover}"
            );
        }
    }

    #[test]
    fn read_directory_impl_reports_file_birth_time() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("fresh.md"), "hi").unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let file = entries.iter().find(|e| e.name == "fresh.md").unwrap();
        assert!(!file.is_directory);
        let created = file.created_at.expect("birth time");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!(
            now - created < 60_000,
            "created_at should be recent: {created} vs {now}"
        );
    }

    #[test]
    fn read_directory_impl_omits_birth_time_on_directories() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_directory);
        assert!(sub.created_at.is_none());
    }

    #[test]
    fn read_directory_impl_reports_file_modified_time() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("touched.md"), "hi").unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let file = entries.iter().find(|e| e.name == "touched.md").unwrap();
        assert!(!file.is_directory);
        let modified = file.modified_at.expect("modified time");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!(
            now - modified < 60_000,
            "modified_at should be recent: {modified} vs {now}"
        );
    }

    #[test]
    fn read_directory_impl_omits_modified_time_on_directories() {
        let dir = TempDir::new().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_directory);
        assert!(sub.modified_at.is_none());
    }

    #[test]
    fn read_directory_impl_reports_newest_descendant_file_on_folders() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("src").join("lib");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("fresh.md"), "hi").unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let src = entries.iter().find(|e| e.name == "src").unwrap();
        assert!(src.is_directory);
        let newest = src.newest_file_created_at.expect("descendant birth time");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!(
            now - newest < 60_000,
            "newest_file_created_at should be recent: {newest} vs {now}"
        );
    }

    /// The name/date pairs a directory listing reports for its folders.
    fn folder_dates(entries: &[FileEntry]) -> Vec<(String, Option<i64>)> {
        entries
            .iter()
            .filter(|e| e.is_directory)
            .map(|e| (e.name.clone(), e.newest_file_created_at))
            .collect()
    }

    #[test]
    fn the_maintained_dates_replace_the_walk_rather_than_supplement_it() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("src");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("a.ts"), "x").unwrap();

        // A birth time no filesystem could produce: if it comes back out, the
        // subtree walk really was skipped rather than merged with.
        let sentinel = 4_102_444_800_000;
        let entries = read_directory_dated_by(dir.path().to_str().unwrap(), |_| {
            HashMap::from([("src".to_string(), sentinel)])
        })
        .unwrap();

        let src = entries.iter().find(|e| e.name == "src").unwrap();
        assert_eq!(src.newest_file_created_at, Some(sentinel));
    }

    #[test]
    fn the_cache_dates_folders_exactly_as_the_walk_would() {
        // The invariant the whole optimisation rests on: whichever half answers,
        // the explorer must be told the same thing.
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("src").join("lib")).unwrap();
        fs::write(dir.path().join("src").join("lib").join("a.ts"), "x").unwrap();
        fs::create_dir_all(dir.path().join("empty")).unwrap();
        fs::write(dir.path().join("top.md"), "x").unwrap();

        let root = dir.path().to_str().unwrap();
        let cache = recent_creations::RecentCreations::default();
        cache.seed_root(root, &walk_files_with_birth_time(dir.path()));

        let walked = read_directory_impl(root).unwrap();
        let cached = read_directory_dated_by(root, |d| {
            cache
                .newest_by_child(&d.to_string_lossy())
                .expect("root was seeded")
        })
        .unwrap();

        assert_eq!(folder_dates(&walked), folder_dates(&cached));
        assert!(
            folder_dates(&walked)
                .iter()
                .any(|(n, d)| n == "src" && d.is_some()),
            "the fixture must actually exercise a dated folder"
        );
    }

    #[test]
    fn a_file_created_after_seeding_dates_its_folder_without_another_walk() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        let root = dir.path().to_str().unwrap();

        let cache = recent_creations::RecentCreations::default();
        cache.seed_root(root, &walk_files_with_birth_time(dir.path()));

        let fresh = dir.path().join("src").join("late.ts");
        fs::write(&fresh, "x").unwrap();
        let created = birth_time_of_file(&fresh).expect("birth time");
        cache.note_file(&fresh.to_string_lossy(), created);

        let entries = read_directory_dated_by(root, |d| {
            cache.newest_by_child(&d.to_string_lossy()).unwrap()
        })
        .unwrap();
        let src = entries.iter().find(|e| e.name == "src").unwrap();
        assert_eq!(src.newest_file_created_at, Some(created));
    }

    #[test]
    fn the_seeding_walk_prunes_what_the_directory_walk_prunes() {
        // Two walks feeding one answer: if they disagreed on what counts, a
        // folder's date would depend on which one happened to run.
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join(".next")).unwrap();
        fs::write(dir.path().join(".next").join("chunk.js"), "x").unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules").join("dep.js"), "x").unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src").join("a.ts"), "x").unwrap();

        let files = walk_files_with_birth_time(dir.path());
        assert!(files.iter().any(|(p, _)| p.ends_with("/src/a.ts")));
        assert!(!files.iter().any(|(p, _)| p.contains("/.next/")));
        assert!(!files.iter().any(|(p, _)| p.contains("/node_modules/")));
    }

    #[cfg(unix)]
    #[test]
    fn the_cache_and_the_walk_agree_about_symlinked_directories() {
        // Neither walk follows links, so a linked-in tree must be invisible to
        // both. If only one of them descended, a folder's date would depend on
        // which half answered.
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::create_dir_all(outside.path().join("deep")).unwrap();
        fs::write(outside.path().join("deep").join("hidden.ts"), "x").unwrap();

        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src").join("a.ts"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();

        let files = walk_files_with_birth_time(dir.path());
        assert!(
            !files.iter().any(|(p, _)| p.contains("hidden.ts")),
            "the seeding walk must not descend into a symlink"
        );

        let root = dir.path().to_str().unwrap();
        let cache = recent_creations::RecentCreations::default();
        cache.seed_root(root, &files);

        let walked = read_directory_impl(root).unwrap();
        let cached = read_directory_dated_by(root, |d| {
            cache
                .newest_by_child(&d.to_string_lossy())
                .expect("root was seeded")
        })
        .unwrap();
        assert_eq!(folder_dates(&walked), folder_dates(&cached));
    }

    #[test]
    fn birth_time_is_read_for_files_only() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a.ts");
        fs::write(&file, "x").unwrap();

        assert!(birth_time_of_file(&file).is_some());
        assert!(birth_time_of_file(dir.path()).is_none());
        assert!(birth_time_of_file(&dir.path().join("missing.ts")).is_none());
    }

    #[test]
    fn read_directory_impl_ignores_build_output_when_dating_folders() {
        // Otherwise the build directory is the brightest thing in the explorer
        // during `pnpm dev` — and it outshines the .gitignore dimming, because
        // a recent row deliberately overrides that.
        let dir = TempDir::new().unwrap();
        let build = dir.path().join(".next").join("static");
        fs::create_dir_all(&build).unwrap();
        fs::write(build.join("chunk.js"), "x").unwrap();
        let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
        let next = entries.iter().find(|e| e.name == ".next").unwrap();
        assert!(next.is_directory);
        assert!(next.newest_file_created_at.is_none());
    }

    #[test]
    fn write_file_impl_writes_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        write_file_impl(path.to_str().unwrap(), "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn write_file_impl_replaces_existing_content() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, "old and much longer content").unwrap();
        write_file_impl(path.to_str().unwrap(), "new").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new");
    }

    #[test]
    fn write_file_impl_leaves_no_temp_files_behind() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        write_file_impl(path.to_str().unwrap(), "hello").unwrap();
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries, vec!["note.md".to_string()]);
    }

    #[test]
    fn write_file_impl_keeps_the_old_content_when_the_write_fails() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("subdir");
        fs::create_dir(&path).unwrap();
        // A directory can never be replaced by a file write; the original must survive.
        let result = write_file_impl(path.to_str().unwrap(), "nope");
        assert!(result.is_err());
        assert!(path.is_dir());
    }

    #[test]
    fn write_file_impl_reports_a_missing_directory() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nope").join("note.md");
        let err = write_file_impl(path.to_str().unwrap(), "hello").unwrap_err();
        assert!(
            err.contains("Failed to write file"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn write_file_impl_cleans_up_after_a_failed_write() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("subdir");
        fs::create_dir(&path).unwrap();
        let _ = write_file_impl(path.to_str().unwrap(), "nope");
        // The temp file must not survive a failure.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|name| name != "subdir")
            .collect();
        assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
    }

    #[test]
    fn write_file_impl_preserves_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("script.sh");
        fs::write(&path, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        write_file_impl(path.to_str().unwrap(), "#!/bin/sh\necho hi\n").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o755, "the executable bit must survive a save");
    }

    #[test]
    fn write_file_impl_writes_through_a_symlink() {
        use std::os::unix::fs::symlink;
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("real.md");
        let link = dir.path().join("link.md");
        fs::write(&target, "old").unwrap();
        symlink(&target, &link).unwrap();

        write_file_impl(link.to_str().unwrap(), "new").unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn test_move_path_moves_file_between_dirs() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let src = dir.path().join("note.md");
        fs::write(&src, "hello").unwrap();
        let dest = sub.join("note.md");

        move_path(
            src.to_str().unwrap().to_string(),
            dest.to_str().unwrap().to_string(),
        )
        .unwrap();

        assert!(!src.exists());
        assert!(dest.exists());
        assert_eq!(fs::read_to_string(&dest).unwrap(), "hello");
    }

    #[test]
    fn test_move_path_moves_directory() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("folder");
        fs::create_dir(&src).unwrap();
        fs::write(src.join("a.txt"), "x").unwrap();
        let target_parent = dir.path().join("dest");
        fs::create_dir(&target_parent).unwrap();
        let dest = target_parent.join("folder");

        move_path(
            src.to_str().unwrap().to_string(),
            dest.to_str().unwrap().to_string(),
        )
        .unwrap();

        assert!(!src.exists());
        assert!(dest.join("a.txt").exists());
    }

    #[test]
    fn test_move_path_refuses_to_overwrite_existing() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("a.txt");
        fs::write(&src, "one").unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let dest = sub.join("a.txt");
        fs::write(&dest, "two").unwrap();

        let err = move_path(
            src.to_str().unwrap().to_string(),
            dest.to_str().unwrap().to_string(),
        )
        .unwrap_err();

        assert!(err.contains("already exists"));
        // Nothing was moved or clobbered.
        assert_eq!(fs::read_to_string(&src).unwrap(), "one");
        assert_eq!(fs::read_to_string(&dest).unwrap(), "two");
    }

    #[test]
    fn test_move_path_rejects_folder_into_own_subtree() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("folder");
        let child = folder.join("child");
        fs::create_dir_all(&child).unwrap();
        // Move `folder` into `folder/child` — illegal.
        let dest = child.join("folder");

        let err = move_path(
            folder.to_str().unwrap().to_string(),
            dest.to_str().unwrap().to_string(),
        )
        .unwrap_err();

        assert!(err.contains("into itself"));
        assert!(folder.exists());
    }

    #[test]
    fn test_pty_resize_after_clone_reader_and_take_writer() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        // Clone reader and take writer — same sequence as shell_spawn
        let _reader = pair.master.try_clone_reader().expect("clone reader");
        let _writer = pair.master.take_writer().expect("take writer");

        // Resize should still work on the master
        pair.master
            .resize(PtySize {
                rows: 50,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("resize after clone_reader + take_writer should succeed");
    }

    #[test]
    fn test_watcher_filters_git_paths() {
        assert!(should_filter_watcher_path(
            "/home/user/project/.git/objects/abc123"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.git/refs/heads/main"
        ));
        assert!(should_filter_watcher_path("/home/user/project/.git/index"));
    }

    #[test]
    fn test_watcher_filters_node_modules() {
        assert!(should_filter_watcher_path(
            "/home/user/project/node_modules/react/index.js"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/node_modules/.pnpm/some-pkg/node_modules/dep"
        ));
    }

    #[test]
    fn test_watcher_filters_target_dir() {
        assert!(should_filter_watcher_path(
            "/home/user/project/target/debug/build"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/target/release/libmyapp.rlib"
        ));
    }

    #[test]
    fn test_watcher_filters_build_output() {
        // `pnpm dev` rewrites .next continuously. Left unfiltered these events
        // reset the tree-refresh debounce forever, so the explorer never
        // refreshes at all while the dev server runs.
        assert!(should_filter_watcher_path(
            "/home/user/project/.next/static/chunks/main.js"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.turbo/daemon/log"
        ));
    }

    #[test]
    fn test_watcher_filters_ds_store() {
        // Finder rewrites .DS_Store on every folder view, which would
        // otherwise make the explorer glow folders nobody actually touched.
        assert!(should_filter_watcher_path("/home/user/project/.DS_Store"));
        assert!(should_filter_watcher_path(
            "/home/user/project/src/.DS_Store"
        ));
    }

    #[test]
    fn test_watcher_filters_windows_thumbs_db() {
        assert!(should_filter_watcher_path("/home/user/project/Thumbs.db"));
        assert!(should_filter_watcher_path(
            "/home/user/project/src/Thumbs.db"
        ));
    }

    #[test]
    fn test_watcher_filters_python_caches() {
        assert!(should_filter_watcher_path(
            "/home/user/project/src/__pycache__/mod.cpython-312.pyc"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.venv/lib/site-packages/pkg.py"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/venv/lib/site-packages/pkg.py"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.pytest_cache/v/cache/lastfailed"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.mypy_cache/3.12/module.data.json"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.ruff_cache/0.5.0/cache"
        ));
    }

    #[test]
    fn test_watcher_filters_test_and_build_output() {
        assert!(should_filter_watcher_path(
            "/home/user/project/coverage/lcov.info"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/playwright-report/index.html"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/test-results/report.json"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/out/index.html"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/dist/main.js"
        ));
        assert!(should_filter_watcher_path(
            "/home/user/project/.cache/babel-loader/abc123"
        ));
    }

    #[test]
    fn test_watcher_allows_normal_paths() {
        assert!(!should_filter_watcher_path(
            "/home/user/project/src/main.rs"
        ));
        assert!(!should_filter_watcher_path("/home/user/project/README.md"));
        assert!(!should_filter_watcher_path(
            "/home/user/project/src/app/page.tsx"
        ));
        assert!(!should_filter_watcher_path("/home/user/project/.gitignore"));
    }

    fn search_dir(files: &[(&str, &str)]) -> TempDir {
        let dir = TempDir::new().unwrap();
        for (name, content) in files {
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
        dir
    }

    #[test]
    fn search_finds_a_match_with_one_based_line_and_column() {
        let dir = search_dir(&[("note.md", "first line\nsecond needle line\n")]);
        let results =
            search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line, 2);
        assert_eq!(results[0].column, 8);
        assert_eq!(results[0].line_text, "second needle line");
    }

    #[test]
    fn search_collects_matches_across_multiple_files() {
        let dir = search_dir(&[("a.md", "hit here"), ("b.md", "and hit here too")]);
        let results = search_in_files_impl(dir.path().to_str().unwrap(), "hit", true, 500).unwrap();
        let paths: Vec<&str> = results.iter().map(|r| r.path.as_str()).collect();
        assert_eq!(results.len(), 2);
        assert!(paths.iter().any(|p| p.ends_with("a.md")));
        assert!(paths.iter().any(|p| p.ends_with("b.md")));
    }

    #[test]
    fn search_is_case_insensitive_by_default() {
        let dir = search_dir(&[("a.md", "Needle here")]);
        let results =
            search_in_files_impl(dir.path().to_str().unwrap(), "needle", false, 500).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_case_sensitive_excludes_different_casing() {
        let dir = search_dir(&[("a.md", "Needle here")]);
        let results =
            search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_skips_git_and_node_modules_directories() {
        let dir = search_dir(&[
            (".git/config", "needle"),
            ("node_modules/pkg/index.js", "needle"),
            ("src/real.md", "needle"),
        ]);
        let results =
            search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].path.ends_with("real.md"));
    }

    #[test]
    fn search_returns_empty_for_an_empty_query() {
        let dir = search_dir(&[("a.md", "anything")]);
        let results = search_in_files_impl(dir.path().to_str().unwrap(), "", true, 500).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_stops_at_max_results() {
        let files: Vec<(String, String)> = (0..10)
            .map(|i| (format!("f{i}.md"), "needle".to_string()))
            .collect();
        let file_refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(n, c)| (n.as_str(), c.as_str()))
            .collect();
        let dir = search_dir(&file_refs);
        let results =
            search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 3).unwrap();
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn search_errors_on_a_root_that_is_not_a_directory() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("nope");
        let err = search_in_files_impl(missing.to_str().unwrap(), "needle", true, 500).unwrap_err();
        assert!(err.contains("Invalid root path"));
    }
}
