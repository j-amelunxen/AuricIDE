mod agent_persistence;
mod agents;
pub mod crashlog;
mod database;
mod excalidraw;
mod llm;
mod mcp;
mod memory_report;
#[cfg(target_os = "macos")]
mod menu;
mod notifications;
mod project_icons;
mod project_skills;
mod providers;
mod recent_projects;
mod schedules;
mod themes;
mod utf8_stream;
mod video_import;
mod webview_prefs;

use agents::AgentManagerState;
use database::{
    BlueprintState, DatabaseState, GoalsState, GoalsSyncPayload, KvEntry, PmSavePayload, PmState,
    RequirementsState,
};
use git2::{Repository, StatusOptions};
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
fn greet(name: &str) -> String {
    if name.is_empty() {
        "Hello, World!".to_string()
    } else {
        format!("Hello, {}!", name)
    }
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
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let path_clone = path.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                let kind = format!("{:?}", event.kind);
                for p in event.paths {
                    let path_str = p.to_string_lossy().to_string();
                    if should_filter_watcher_path(&path_str) {
                        continue;
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
    Ok(())
}

#[tauri::command]
async fn unwatch_directory(
    path: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    if let Some(mut watcher) = watchers.remove(&path) {
        watcher
            .unwatch(Path::new(&path))
            .map_err(|e| e.to_string())?;
    }
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

#[tauri::command]
fn read_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    read_directory_impl(path)
}

#[tauri::command]
fn exists(path: &str) -> bool {
    Path::new(path).exists()
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

#[derive(Debug, Serialize)]
pub struct GitFileStatus {
    path: String,
    status: String,
}

#[derive(Debug, Serialize)]
pub struct BranchInfo {
    name: String,
    ahead: u32,
    behind: u32,
}

/// One commit as the evidence engine reads history: what it touched is the
/// payload — "a commit touches this path prefix" is a station predicate.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub summary: String,
    pub author: String,
    /// UTC, `YYYY-MM-DD HH:MM:SS` — the app's one timestamp format.
    pub timestamp: String,
    /// Repo-relative paths this commit changed (diff against first parent).
    pub touched: Vec<String>,
}

#[tauri::command]
fn git_status(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    git_status_impl(repo_path)
}

#[tauri::command]
fn git_branch_info(repo_path: &str) -> Result<BranchInfo, String> {
    git_branch_info_impl(repo_path)
}

#[tauri::command]
fn git_diff(repo_path: &str, file_path: &str) -> Result<String, String> {
    git_diff_impl(repo_path, file_path)
}

#[tauri::command]
fn git_stage(repo_path: &str, paths: Vec<String>) -> Result<(), String> {
    git_stage_impl(repo_path, &paths)
}

#[tauri::command]
fn git_unstage(repo_path: &str, paths: Vec<String>) -> Result<(), String> {
    git_unstage_impl(repo_path, &paths)
}

#[tauri::command]
fn git_commit(repo_path: &str, message: &str) -> Result<String, String> {
    git_commit_impl(repo_path, message)
}

#[tauri::command]
fn git_discard(repo_path: &str, file_path: &str) -> Result<(), String> {
    git_discard_impl(repo_path, file_path)
}

#[tauri::command]
fn git_push(repo_path: &str) -> Result<(), String> {
    git_push_impl(repo_path)
}

/// Commits actually walked before we give up, whether or not they matched.
/// The `limit` bounds the answer; this bounds the *work*. A `path_prefix` that
/// matches nothing (a freshly planned line is the normal case) would otherwise
/// diff every commit in the repo looking for a match that never comes, which
/// on a large history is tens of seconds of frozen work.
const GIT_LOG_MAX_SCAN: usize = 2000;

// `async` so Tauri runs this off the IPC thread: even bounded, 2000 tree diffs
// on a big repo should never block the window. A sync command would run inline.
#[tauri::command(async)]
fn git_log_since(
    repo_path: String,
    since_iso: Option<String>,
    path_prefix: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    // Hard cap: history is evidence, not an archive browser. 200 commits is
    // far beyond any staleness window a station predicate looks at.
    git_log_since_impl(
        &repo_path,
        since_iso.as_deref(),
        path_prefix.as_deref(),
        200,
        GIT_LOG_MAX_SCAN,
    )
}

/// Walks history from HEAD, newest first, stopping below `since_iso`, at
/// `limit` matches, or after `max_scan` commits visited. `path_prefix` keeps
/// only commits touching that prefix. Not a repo is an empty answer, not an
/// error — same contract as `git_status_impl`.
pub fn git_log_since_impl(
    repo_path: &str,
    since_iso: Option<&str>,
    path_prefix: Option<&str>,
    limit: usize,
    max_scan: usize,
) -> Result<Vec<CommitInfo>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };
    if repo.head().is_err() {
        return Ok(Vec::new()); // empty repo: no commits yet
    }

    let since_epoch: Option<i64> = match since_iso {
        Some(raw) => {
            let normalized = raw.replace('T', " ");
            let trimmed = normalized.trim_end_matches('Z').trim().to_string();
            let parsed = chrono::NaiveDateTime::parse_from_str(&trimmed, "%Y-%m-%d %H:%M:%S")
                .or_else(|_| {
                    chrono::NaiveDate::parse_from_str(&trimmed, "%Y-%m-%d")
                        .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
                })
                .map_err(|e| format!("Invalid since_iso '{}': {}", raw, e))?;
            Some(parsed.and_utc().timestamp())
        }
        None => None,
    };

    let mut walk = repo
        .revwalk()
        .map_err(|e| format!("Failed to walk history: {}", e))?;
    walk.push_head()
        .map_err(|e| format!("Failed to start at HEAD: {}", e))?;
    walk.set_sorting(git2::Sort::TIME)
        .map_err(|e| format!("Failed to sort history: {}", e))?;

    let mut result = Vec::new();
    for (scanned, oid) in walk.enumerate() {
        if result.len() >= limit || scanned >= max_scan {
            break;
        }
        let oid = oid.map_err(|e| format!("Failed to read commit id: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Failed to read commit: {}", e))?;
        let seconds = commit.time().seconds();
        if let Some(since) = since_epoch {
            // TIME sorting walks newest → oldest: past the cutoff means done.
            if seconds < since {
                break;
            }
        }

        let tree = commit
            .tree()
            .map_err(|e| format!("Failed to read commit tree: {}", e))?;
        let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
            .map_err(|e| format!("Failed to diff commit: {}", e))?;
        // HashSet membership, not a linear rescan: a merge commit diffed
        // against its first parent can touch thousands of files, and the old
        // `touched.iter().any(...)` made that quadratic.
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut touched: Vec<String> = Vec::with_capacity(diff.deltas().len().saturating_mul(2));
        for delta in diff.deltas() {
            for file in [delta.new_file(), delta.old_file()] {
                if let Some(path) = file.path().and_then(|p| p.to_str()) {
                    if seen.insert(path.to_string()) {
                        touched.push(path.to_string());
                    }
                }
            }
        }

        if let Some(prefix) = path_prefix {
            if !touched.iter().any(|p| p.starts_with(prefix)) {
                continue;
            }
        }

        let timestamp = chrono::DateTime::from_timestamp(seconds, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
            .unwrap_or_default();
        result.push(CommitInfo {
            oid: oid.to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("").to_string(),
            timestamp,
            touched,
        });
    }
    Ok(result)
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
        || is_atomic_write_temp(path)
}

// Pure functions for testability
pub fn read_directory_impl(path: &str) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut entries: Vec<FileEntry> = WalkDir::new(dir)
        .min_depth(1)
        .max_depth(1)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|entry| FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_directory: entry.file_type().is_dir(),
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

pub fn git_status_impl(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()), // Return empty if not a git repo
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let mut result = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        let label = if status.is_ignored() {
            "ignored"
        } else if status.is_index_new() {
            "added"
        } else if status.is_index_modified() || status.is_wt_modified() {
            "modified"
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            "deleted"
        } else if status.is_wt_new() {
            "untracked"
        } else {
            continue;
        };

        result.push(GitFileStatus {
            path,
            status: label.to_string(),
        });
    }

    Ok(result)
}

pub fn git_branch_info_impl(repo_path: &str) -> Result<BranchInfo, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(BranchInfo {
                name: "-".to_string(),
                ahead: 0,
                behind: 0,
            })
        }
    };

    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => {
            return Ok(BranchInfo {
                name: "no head".to_string(),
                ahead: 0,
                behind: 0,
            })
        }
    };
    let name = head.shorthand().unwrap_or("HEAD").to_string();

    Ok(BranchInfo {
        name,
        ahead: 0,
        behind: 0,
    })
}

pub fn git_stage_impl(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    for path in paths {
        index
            .add_path(Path::new(path))
            .map_err(|e| format!("Failed to stage {}: {}", path, e))?;
    }

    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    Ok(())
}

pub fn git_unstage_impl(repo_path: &str, paths: &[String]) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    repo.reset_default(
        head.as_ref().map(|t| t.as_object()),
        paths.iter().map(Path::new),
    )
    .map_err(|e| format!("Failed to unstage: {}", e))?;

    Ok(())
}

pub fn git_commit_impl(repo_path: &str, message: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    let tree_oid = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;

    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    let sig = repo.signature().map_err(|e| {
        format!(
            "Failed to get git signature: {}. Please configure git user.name and user.email.",
            e
        )
    })?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Failed to commit: {}", e))?;

    Ok(oid.to_string())
}

/// Pushes the current branch to `origin`, trying the SSH agent, the default
/// key files and the configured credential helper in that order. Sets the
/// upstream on first push so later pushes (and the branch display) know
/// where home is.
pub fn git_push_impl(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let head = repo
        .head()
        .map_err(|e| format!("Failed to read HEAD: {}", e))?;
    let branch_name = head
        .shorthand()
        .filter(|_| head.is_branch())
        .ok_or_else(|| "Detached HEAD — check out a branch before pushing".to_string())?
        .to_string();

    let mut remote = repo
        .find_remote("origin")
        .map_err(|_| "No 'origin' remote configured for this repository".to_string())?;

    // git2 re-asks the callback after every failed credential, which loops
    // forever if we keep proposing the same one — bail after a few tries
    // with a message that names the fix instead of hanging the UI.
    let attempts = std::cell::Cell::new(0u32);
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        let attempt = attempts.get();
        attempts.set(attempt + 1);
        if attempt > 4 {
            return Err(git2::Error::from_str(
                "no accepted credentials (tried SSH agent, key files and credential helper)",
            ));
        }
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username_from_url.unwrap_or("git");
            if attempt == 0 {
                if let Ok(cred) = git2::Cred::ssh_key_from_agent(user) {
                    return Ok(cred);
                }
            }
            if let Ok(home) = std::env::var("HOME") {
                for key in ["id_ed25519", "id_rsa"] {
                    let path = std::path::Path::new(&home).join(".ssh").join(key);
                    if path.exists() {
                        if let Ok(cred) = git2::Cred::ssh_key(user, None, &path, None) {
                            return Ok(cred);
                        }
                    }
                }
            }
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = git2::Cred::credential_helper(&config, url, username_from_url) {
                    return Ok(cred);
                }
            }
        }
        git2::Cred::default()
    });

    let mut options = git2::PushOptions::new();
    options.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    remote
        .push(&[&refspec], Some(&mut options))
        .map_err(|e| format!("Push failed: {}", e))?;

    // Best-effort: the push itself succeeded, a missing upstream note is a
    // cosmetic follow-up, not a failure.
    if let Ok(mut branch) = repo.find_branch(&branch_name, git2::BranchType::Local) {
        if branch.upstream().is_err() {
            let _ = branch.set_upstream(Some(&format!("origin/{branch_name}")));
        }
    }

    Ok(())
}

pub fn git_discard_impl(repo_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut opts = StatusOptions::new();
    opts.pathspec(file_path)
        .include_untracked(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let status = statuses
        .iter()
        .next()
        .map(|s| s.status())
        .unwrap_or(git2::Status::CURRENT);

    let full_path = Path::new(repo_path).join(file_path);

    if status.contains(git2::Status::WT_NEW) {
        // Untracked file — delete from disk
        fs::remove_file(&full_path)
            .map_err(|e| format!("Failed to delete untracked file: {}", e))?;
    } else if status.contains(git2::Status::INDEX_NEW) {
        // Staged new file — unstage (reset index entry to HEAD, which has no such file) then delete
        repo.reset_default(None, [Path::new(file_path)].iter().copied())
            .map_err(|e| format!("Failed to unstage: {}", e))?;
        if full_path.exists() {
            fs::remove_file(&full_path).map_err(|e| format!("Failed to delete file: {}", e))?;
        }
    } else {
        // Modified or deleted tracked file — restore from HEAD
        let mut checkout_opts = git2::build::CheckoutBuilder::new();
        checkout_opts.path(file_path).force();
        repo.checkout_head(Some(&mut checkout_opts))
            .map_err(|e| format!("Failed to discard changes: {}", e))?;
    }

    Ok(())
}

pub fn git_diff_impl(repo_path: &str, file_path: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut opts = StatusOptions::new();
    opts.pathspec(file_path)
        .include_untracked(true)
        .recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    if statuses.is_empty() {
        return Ok(String::new());
    }

    let entry = statuses.get(0).ok_or("File not found in status")?;
    let status = entry.status();

    // Untracked file: show entire content as added
    if status.is_wt_new() {
        let full_path = Path::new(repo_path).join(file_path);
        let content =
            fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
        let mut diff_text = format!("--- /dev/null\n+++ b/{}\n", file_path);
        let lines: Vec<&str> = content.lines().collect();
        diff_text.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
        for line in &lines {
            diff_text.push('+');
            diff_text.push_str(line);
            diff_text.push('\n');
        }
        return Ok(diff_text);
    }

    // Deleted file: show entire old content as removed
    if status.is_wt_deleted() || status.is_index_deleted() {
        let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        if let Some(tree) = head {
            if let Ok(blob_entry) = tree.get_path(Path::new(file_path)) {
                if let Ok(obj) = blob_entry.to_object(&repo) {
                    if let Some(blob) = obj.as_blob() {
                        let content = String::from_utf8_lossy(blob.content());
                        let mut diff_text = format!("--- a/{}\n+++ /dev/null\n", file_path);
                        let lines: Vec<&str> = content.lines().collect();
                        diff_text.push_str(&format!("@@ -1,{} +0,0 @@\n", lines.len()));
                        for line in &lines {
                            diff_text.push('-');
                            diff_text.push_str(line);
                            diff_text.push('\n');
                        }
                        return Ok(diff_text);
                    }
                }
            }
        }
        return Ok(String::new());
    }

    // Modified file: use git2 diff
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut diff_opts = git2::DiffOptions::new();
    diff_opts.pathspec(file_path);

    let diff = repo
        .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
        .map_err(|e| format!("Failed to generate diff: {}", e))?;

    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            '+' | '-' | ' ' => {
                diff_text.push(line.origin());
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            'F' => {
                // File header line
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            'H' => {
                // Hunk header
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            _ => {}
        }
        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;

    Ok(diff_text)
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
) -> Result<llm::LlmResponse, String> {
    llm::llm_call_impl(request, db_state).await
}

#[tauri::command]
async fn excalidraw_test_connection(
    project_path: String,
    db_state: tauri::State<'_, database::DatabaseState>,
) -> Result<String, String> {
    excalidraw::test_connection_impl(&project_path, db_state).await
}

#[tauri::command]
async fn excalidraw_list_collections(
    project_path: String,
    db_state: tauri::State<'_, database::DatabaseState>,
) -> Result<Vec<excalidraw::contract::Collection>, String> {
    excalidraw::list_collections_impl(&project_path, db_state).await
}

#[tauri::command]
async fn excalidraw_list_scenes(
    project_path: String,
    collection_id: String,
    db_state: tauri::State<'_, database::DatabaseState>,
) -> Result<Vec<excalidraw::contract::SceneSummary>, String> {
    excalidraw::list_scenes_impl(&project_path, &collection_id, db_state).await
}

#[tauri::command]
async fn excalidraw_get_scene_content(
    project_path: String,
    scene_id: String,
    db_state: tauri::State<'_, database::DatabaseState>,
) -> Result<String, String> {
    excalidraw::get_scene_content_impl(&project_path, &scene_id, db_state).await
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

            // The webview's own localStorage is scoped by data store and page
            // origin, neither of which matches between the dev binary and the
            // bundled app. Mirroring it here puts it on the same footing as
            // everything else the backend keeps: one file, one identifier.
            let webview_prefs_path = webview_prefs::prefs_path_in(
                &app.path().app_data_dir().map_err(|e| e.to_string())?,
            );
            app.manage(webview_prefs::WebviewPrefsState::new(webview_prefs_path));

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
        .manage(WatcherState {
            watchers: Mutex::new(HashMap::new()),
        })
        .manage(TerminalState {
            sessions: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_directory,
            exists,
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
            git_branch_info,
            git_diff,
            git_stage,
            git_unstage,
            git_commit,
            git_push,
            git_log_since,
            git_discard,
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
            project_skills::project_skills_list,
            project_icons::project_icon_candidates,
            video_import::video_import_analyze_media,
            video_import::video_import_local_status,
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
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    /// A repo with one commit, ready for push tests.
    fn committed_repo(dir: &TempDir) -> String {
        let path = dir.path().to_str().unwrap().to_string();
        let repo = Repository::init(&path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        fs::write(dir.path().join("a.txt"), "hi").unwrap();
        git_stage_impl(&path, &["a.txt".to_string()]).unwrap();
        git_commit_impl(&path, "init").unwrap();
        path
    }

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
    fn push_without_a_remote_names_the_problem() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let err = git_push_impl(&path).unwrap_err();
        assert!(err.contains("origin"), "unhelpful error: {err}");
    }

    #[test]
    fn push_reaches_a_local_bare_remote() {
        // A bare repo on disk is a real remote as far as git is concerned —
        // this proves the refspec and branch plumbing without any network.
        let work = TempDir::new().unwrap();
        let bare = TempDir::new().unwrap();
        let path = committed_repo(&work);
        Repository::init_bare(bare.path()).unwrap();
        {
            let repo = Repository::open(&path).unwrap();
            repo.remote("origin", bare.path().to_str().unwrap())
                .unwrap();
        }

        git_push_impl(&path).unwrap();

        let remote = Repository::open_bare(bare.path()).unwrap();
        assert!(remote.head().unwrap().peel_to_commit().is_ok());
    }

    #[test]
    fn push_sets_the_upstream_so_the_next_push_knows_where_home_is() {
        let work = TempDir::new().unwrap();
        let bare = TempDir::new().unwrap();
        let path = committed_repo(&work);
        Repository::init_bare(bare.path()).unwrap();
        {
            let repo = Repository::open(&path).unwrap();
            repo.remote("origin", bare.path().to_str().unwrap())
                .unwrap();
        }

        git_push_impl(&path).unwrap();

        let repo = Repository::open(&path).unwrap();
        let head = repo.head().unwrap();
        let branch = repo
            .find_branch(head.shorthand().unwrap(), git2::BranchType::Local)
            .unwrap();
        assert!(branch.upstream().is_ok());
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

    fn init_test_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path();
        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();
        dir
    }

    fn commit_file(dir: &TempDir, rel_path: &str, content: &str, message: &str) {
        let full = dir.path().join(rel_path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&full, content).unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", message])
            .current_dir(dir.path())
            .output()
            .unwrap();
    }

    #[test]
    fn test_git_log_since_lists_commits_newest_first_with_touched_paths() {
        let dir = init_test_repo();
        commit_file(&dir, "src/a.rs", "a", "first");
        commit_file(&dir, "docs/readme.md", "d", "second");

        let log =
            git_log_since_impl(dir.path().to_str().unwrap(), None, None, 200, usize::MAX).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].summary, "second");
        assert_eq!(log[0].touched, vec!["docs/readme.md".to_string()]);
        assert_eq!(log[1].summary, "first");
        assert_eq!(log[1].touched, vec!["src/a.rs".to_string()]);
        assert!(!log[0].timestamp.is_empty());
    }

    #[test]
    fn test_git_log_since_filters_by_path_prefix() {
        let dir = init_test_repo();
        commit_file(&dir, "src/a.rs", "a", "code");
        commit_file(&dir, "docs/readme.md", "d", "docs");

        let log = git_log_since_impl(
            dir.path().to_str().unwrap(),
            None,
            Some("docs/"),
            200,
            usize::MAX,
        )
        .unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].summary, "docs");
    }

    #[test]
    fn test_git_log_since_respects_the_cutoff() {
        let dir = init_test_repo();
        commit_file(&dir, "src/a.rs", "a", "old");
        // A cutoff far in the future excludes everything.
        let log = git_log_since_impl(
            dir.path().to_str().unwrap(),
            Some("2099-01-01 00:00:00"),
            None,
            200,
            usize::MAX,
        )
        .unwrap();
        assert!(log.is_empty());
        // A cutoff far in the past includes it.
        let log = git_log_since_impl(
            dir.path().to_str().unwrap(),
            Some("2000-01-01"),
            None,
            200,
            usize::MAX,
        )
        .unwrap();
        assert_eq!(log.len(), 1);
    }

    #[test]
    fn test_git_log_since_caps_at_limit() {
        let dir = init_test_repo();
        for i in 0..5 {
            commit_file(&dir, "f.txt", &format!("v{}", i), &format!("c{}", i));
        }
        let log =
            git_log_since_impl(dir.path().to_str().unwrap(), None, None, 3, usize::MAX).unwrap();
        assert_eq!(log.len(), 3);
        assert_eq!(log[0].summary, "c4");
    }

    #[test]
    fn test_git_log_since_caps_work_at_max_scan() {
        let dir = init_test_repo();
        // Five commits, none touching the requested prefix. Without a scan cap
        // the walk would diff all five hunting a match; max_scan stops it early.
        for i in 0..5 {
            commit_file(&dir, "src/f.txt", &format!("v{}", i), &format!("c{}", i));
        }
        let log =
            git_log_since_impl(dir.path().to_str().unwrap(), None, Some("docs/"), 200, 2).unwrap();
        // Prefix matches nothing, and we gave up after 2 commits: no results,
        // and — the point of the test — the loop terminated rather than
        // scanning the whole history.
        assert!(log.is_empty());
    }

    #[test]
    fn test_git_log_since_is_empty_for_non_repo_and_empty_repo() {
        let plain = TempDir::new().unwrap();
        assert!(
            git_log_since_impl(plain.path().to_str().unwrap(), None, None, 200, usize::MAX)
                .unwrap()
                .is_empty()
        );
        let empty = init_test_repo();
        assert!(
            git_log_since_impl(empty.path().to_str().unwrap(), None, None, 200, usize::MAX)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_git_log_since_rejects_garbage_cutoff() {
        let dir = init_test_repo();
        commit_file(&dir, "f.txt", "x", "c");
        let err = git_log_since_impl(
            dir.path().to_str().unwrap(),
            Some("next tuesday"),
            None,
            200,
            usize::MAX,
        )
        .unwrap_err();
        assert!(err.contains("Invalid since_iso"));
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
    fn test_git_diff_untracked_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("hello.txt"), "line1\nline2\n").unwrap();

        let diff = git_diff_impl(repo_path, "hello.txt").unwrap();
        assert!(diff.contains("+++ b/hello.txt"));
        assert!(diff.contains("+line1"));
        assert!(diff.contains("+line2"));
    }

    #[test]
    fn test_git_diff_modified_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();

        let diff = git_diff_impl(repo_path, "file.txt").unwrap();
        assert!(diff.contains("-original"));
        assert!(diff.contains("+modified"));
    }

    #[test]
    fn test_git_diff_deleted_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("gone.txt"), "bye\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        let diff = git_diff_impl(repo_path, "gone.txt").unwrap();
        assert!(diff.contains("--- a/gone.txt"));
        assert!(diff.contains("-bye"));
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

    #[test]
    fn test_git_diff_no_changes() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("clean.txt"), "hello\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        let diff = git_diff_impl(repo_path, "clean.txt").unwrap();
        assert!(diff.is_empty());
    }

    #[test]
    fn test_git_discard_modified_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("file.txt")).unwrap(),
            "modified\n"
        );

        git_discard_impl(repo_path, "file.txt").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("file.txt")).unwrap(),
            "original\n"
        );
    }

    #[test]
    fn test_git_discard_deleted_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("file.txt"), "content\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        fs::remove_file(dir.path().join("file.txt")).unwrap();
        assert!(!dir.path().join("file.txt").exists());

        git_discard_impl(repo_path, "file.txt").unwrap();
        assert!(dir.path().join("file.txt").exists());
        assert_eq!(
            fs::read_to_string(dir.path().join("file.txt")).unwrap(),
            "content\n"
        );
    }

    #[test]
    fn test_git_discard_untracked_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("new.txt"), "new content\n").unwrap();
        assert!(dir.path().join("new.txt").exists());

        git_discard_impl(repo_path, "new.txt").unwrap();
        assert!(!dir.path().join("new.txt").exists());
    }

    #[test]
    fn test_git_discard_staged_new_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        // Create initial commit so HEAD exists
        fs::write(dir.path().join("base.txt"), "base\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(dir.path())
            .output()
            .unwrap();

        // Stage a brand-new file
        fs::write(dir.path().join("added.txt"), "added\n").unwrap();
        StdCommand::new("git")
            .args(["add", "added.txt"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(dir.path().join("added.txt").exists());

        git_discard_impl(repo_path, "added.txt").unwrap();
        assert!(!dir.path().join("added.txt").exists());
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
