mod agents;
pub mod crashlog;
mod database;
mod llm;
mod mcp;
mod providers;

use agents::AgentManagerState;
use database::{DatabaseState, KvEntry, PmSavePayload, PmState};
use git2::{Repository, StatusOptions};
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use providers::ProviderRegistryState;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
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

    let output = Command::new(&vc.command).args(&vc.args).output().await;

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
        let mut buffer = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            let _ = app_stdout.emit(&format!("terminal-out-{}", id_stdout), data);
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

#[derive(Debug, Serialize, Clone)]
pub struct SystemProcessEntry {
    label: String,
    pid: u32,
    rss_bytes: u64,
}

struct PsEntry {
    pid: u32,
    ppid: u32,
    rss_kb: u64,
    command: String,
}

fn parse_ps_output() -> Vec<PsEntry> {
    let output = match std::process::Command::new("ps")
        .args(["axo", "pid=,ppid=,rss=,command="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                return None;
            }
            let pid: u32 = parts[0].parse().ok()?;
            let ppid: u32 = parts[1].parse().ok()?;
            let rss_kb: u64 = parts[2].parse().ok()?;
            let command = parts[3..].join(" ");
            Some(PsEntry {
                pid,
                ppid,
                rss_kb,
                command,
            })
        })
        .collect()
}

fn find_descendants(root_pid: u32, entries: &[PsEntry]) -> Vec<&PsEntry> {
    let mut result = Vec::new();
    let mut parents = vec![root_pid];
    let mut visited = std::collections::HashSet::new();
    visited.insert(root_pid);

    while !parents.is_empty() {
        let mut next_parents = Vec::new();
        for entry in entries {
            if parents.contains(&entry.ppid) && !visited.contains(&entry.pid) {
                visited.insert(entry.pid);
                result.push(entry);
                next_parents.push(entry.pid);
            }
        }
        parents = next_parents;
    }

    result
}

#[tauri::command]
fn get_system_memory() -> Vec<SystemProcessEntry> {
    let own_pid = std::process::id();
    let entries = parse_ps_output();
    let mut result = Vec::new();

    // 1. Own process (Tauri / Rust)
    if let Some(e) = entries.iter().find(|e| e.pid == own_pid) {
        result.push(SystemProcessEntry {
            label: "Tauri (Rust)".to_string(),
            pid: e.pid,
            rss_bytes: e.rss_kb * 1024,
        });
    }

    // 2. Next.js dev server — look for node processes running next-server
    let next_entries: Vec<&PsEntry> = entries
        .iter()
        .filter(|e| {
            e.pid != own_pid
                && (e.command.contains("next-server")
                    || (e.command.contains("node") && e.command.contains(".next")))
        })
        .collect();

    if !next_entries.is_empty() {
        let total_rss: u64 = next_entries.iter().map(|e| e.rss_kb).sum();
        result.push(SystemProcessEntry {
            label: "Next.js".to_string(),
            pid: next_entries[0].pid,
            rss_bytes: total_rss * 1024,
        });
    }

    // 3. WebView / child processes — walk the process tree from our PID
    let descendants = find_descendants(own_pid, &entries);
    let desc_rss: u64 = descendants.iter().map(|e| e.rss_kb).sum();

    if desc_rss > 0 {
        result.push(SystemProcessEntry {
            label: "WebView (UI)".to_string(),
            pid: 0,
            rss_bytes: desc_rss * 1024,
        });
    } else {
        // Fallback: find WebKit content processes system-wide
        let wc_total: u64 = entries
            .iter()
            .filter(|e| e.pid != own_pid && e.command.contains("WebContent"))
            .map(|e| e.rss_kb)
            .sum();
        if wc_total > 0 {
            result.push(SystemProcessEntry {
                label: "WebView (est.)".to_string(),
                pid: 0,
                rss_bytes: wc_total * 1024,
            });
        }
    }

    result
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

/// Returns true if the path should be filtered out from file watcher events.
pub fn should_filter_watcher_path(path: &str) -> bool {
    path.contains("/.git/") || path.contains("/node_modules/") || path.contains("/target/")
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

pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|e| format!("Failed to write file: {}", e))
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
    let (info, writer, master) =
        agents::spawn_agent_impl(config, &state, &app, &provider_state).await?;

    // Register agent PTY writer and master in the global terminal state
    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(master),
    }));

    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        sessions.insert(format!("agent-{}", info.id), session);
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
fn pm_clear(project_path: String, state: tauri::State<'_, DatabaseState>) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_clear_impl(conn)
}

#[tauri::command]
async fn llm_call(
    request: llm::LlmRequest,
    db_state: tauri::State<'_, database::DatabaseState>,
) -> Result<llm::LlmResponse, String> {
    llm::llm_call_impl(request, db_state).await
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
fn start_mcp(
    project_path: String,
    state: tauri::State<'_, mcp::McpServerState>,
) -> Result<mcp::McpStatusInfo, String> {
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

    let child = mcp::start_mcp_server(&db_path_str, &script_path_str)?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Ok(log_dir) = app.path().app_log_dir() {
                crashlog::set_crash_log_dir(log_dir);
            }
            app.manage(providers::new_provider_registry(Some(app.handle())));
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
            read_file,
            read_file_base64,
            write_file,
            copy_file,
            delete_file,
            create_directory,
            save_temp_image,
            save_image_to_path,
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
            git_discard,
            list_agents,
            spawn_agent,
            kill_agent,
            kill_agents_for_repo,
            list_providers,
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
            append_metrics_log,
            report_frontend_crash,
            list_crash_logs,
            read_crash_log,
            llm_call,
            start_mcp,
            stop_mcp,
            mcp_status
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(agents::cleanup_all_agents(app));
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

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
}
