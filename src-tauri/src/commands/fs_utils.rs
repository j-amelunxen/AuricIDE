use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub created_at: Option<i64>,
    pub newest_file_created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub line_text: String,
}

pub const SEARCH_MAX_RESULTS: usize = 500;
pub const SEARCH_LINE_TEXT_CAP: usize = 300;

/// Marker in the sibling temp file name an atomic write uses. Defined once so
/// the writer and the watcher filter can never disagree about what to hide.
pub const ATOMIC_WRITE_MARKER: &str = ".tmp-";

/// Distinguishes concurrent writes within this process; the pid separates processes.
static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

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
pub fn file_created_at_ms(entry: &walkdir::DirEntry) -> Option<i64> {
    if entry.file_type().is_dir() {
        return None;
    }
    let created = entry.metadata().ok()?.created().ok()?;
    let duration = created.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

/// Modification time in unix milliseconds. Directories are omitted for the
/// same reason as `file_created_at_ms`: this is a file-row signal.
pub fn file_modified_at_ms(entry: &walkdir::DirEntry) -> Option<i64> {
    if entry.file_type().is_dir() {
        return None;
    }
    let modified = entry.metadata().ok()?.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

pub fn skip_recent_walk_dir(entry: &walkdir::DirEntry) -> bool {
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
pub fn walk_files_with_birth_time(root: &Path) -> Vec<(String, i64)> {
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
pub fn birth_time_of_file(path: &Path) -> Option<i64> {
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
pub fn newest_file_created_at_by_child(dir: &Path) -> HashMap<String, i64> {
    let mut newest: HashMap<String, i64> = HashMap::new();
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

pub fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
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

pub fn read_file_impl(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
}

pub fn write_file_impl(path: &str, content: &str) -> Result<(), String> {
    let requested = Path::new(path);
    let target = fs::canonicalize(requested).unwrap_or_else(|_| requested.to_path_buf());

    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "Failed to write file: path has no parent directory".to_string())?;

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
        file.sync_all()?;
        drop(file);

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

pub fn read_directory_impl(path: &str) -> Result<Vec<FileEntry>, String> {
    read_directory_dated_by(path, newest_file_created_at_by_child)
}

pub fn read_directory_dated_by(
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

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

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

pub fn ensure_scratch_dir(base: std::path::PathBuf) -> Result<std::path::PathBuf, String> {
    let dir = base.join("scratches");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
