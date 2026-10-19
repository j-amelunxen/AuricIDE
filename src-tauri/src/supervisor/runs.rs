//! The folders earlier supervisor runs left behind under
//! `~/.auric/supervisors/`: listing them for the runs browser, and checking a
//! folder a new supervisor is asked to resume in.
//!
//! A resumed supervisor still runs under `--restricted`, so the folder it gets
//! decides everything its file tools may touch. That is why a resume target
//! must be one run folder exactly, a direct child of the runs root after
//! symlinks are resolved, and never the root itself or anything below a run.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Past this many entries a run's walk stops. A run folder holds notes,
/// transcripts and frames; one that holds more is not browsed file by file.
const MAX_FILES_PER_RUN: usize = 2000;
/// Deep enough for `frames/<item>/…`, shallow enough that a stray clone does
/// not turn one listing into a walk of a whole repository.
const MAX_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorRun {
    /// The folder name, which is the run's start time (`2026-10-16_185017`).
    pub name: String,
    pub path: String,
    /// The newest modification time inside the run, the folder's own when
    /// it is empty. Milliseconds since the epoch.
    pub modified_at_ms: Option<u64>,
    pub file_count: usize,
    /// The walk stopped at `MAX_FILES_PER_RUN`; `file_count` is a floor.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorRunFile {
    /// Relative to the run folder, `/`-separated.
    pub relative_path: String,
    pub path: String,
    pub size: u64,
    pub modified_at_ms: Option<u64>,
}

fn modified_ms(meta: &std::fs::Metadata) -> Option<u64> {
    let since = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(since.as_millis()).ok()
}

/// Regular files below `dir`, symlinks not followed, at most `limit`.
fn walk_files(dir: &Path, limit: usize) -> (Vec<SupervisorRunFile>, bool) {
    let mut files = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((current, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = entry.path().symlink_metadata() else {
                continue;
            };
            if meta.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((entry.path(), depth + 1));
                }
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            if files.len() == limit {
                return (files, true);
            }
            let path = entry.path();
            let relative = path
                .strip_prefix(dir)
                .unwrap_or(&path)
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            files.push(SupervisorRunFile {
                relative_path: relative,
                path: path.to_string_lossy().into_owned(),
                size: meta.len(),
                modified_at_ms: modified_ms(&meta),
            });
        }
    }
    (files, false)
}

/// Every run folder under `root`, the one changed most recently first.
pub fn list_runs(root: &Path) -> Vec<SupervisorRun> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut runs: Vec<SupervisorRun> = entries
        .flatten()
        .filter_map(|entry| {
            let meta = entry.path().symlink_metadata().ok()?;
            if !meta.is_dir() {
                return None;
            }
            let path = entry.path();
            let (files, truncated) = walk_files(&path, MAX_FILES_PER_RUN);
            let newest = files.iter().filter_map(|file| file.modified_at_ms).max();
            Some(SupervisorRun {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                modified_at_ms: newest.or_else(|| modified_ms(&meta)),
                file_count: files.len(),
                truncated,
            })
        })
        .collect();
    runs.sort_by(|a, b| {
        b.modified_at_ms
            .cmp(&a.modified_at_ms)
            .then_with(|| b.name.cmp(&a.name))
    });
    runs
}

/// `requested` as one run folder under `root`, or why it is not one.
pub fn resolve_run_dir(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let not_a_run = || format!("'{requested}' is not a supervisor run folder.");
    let root = root.canonicalize().map_err(|_| not_a_run())?;
    let dir = Path::new(requested)
        .canonicalize()
        .map_err(|_| format!("The supervisor run folder '{requested}' no longer exists."))?;
    if dir.parent() != Some(root.as_path()) || !dir.is_dir() {
        return Err(not_a_run());
    }
    Ok(dir)
}

/// The files of one run, newest first, for the browser's tree.
pub fn run_files(root: &Path, run: &str) -> Result<Vec<SupervisorRunFile>, String> {
    let dir = resolve_run_dir(root, run)?;
    let (mut files, _) = walk_files(&dir, MAX_FILES_PER_RUN);
    files.sort_by(|a, b| {
        b.modified_at_ms
            .cmp(&a.modified_at_ms)
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });
    Ok(files)
}

fn runs_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("The home directory is unavailable: {e}"))?;
    Ok(super::supervisor_runs_root(&home))
}

#[tauri::command(async)]
pub fn supervisor_runs_list(app: tauri::AppHandle) -> Result<Vec<SupervisorRun>, String> {
    Ok(list_runs(&runs_root(&app)?))
}

#[tauri::command(async)]
pub fn supervisor_run_files(
    app: tauri::AppHandle,
    run: String,
) -> Result<Vec<SupervisorRunFile>, String> {
    run_files(&runs_root(&app)?, &run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn touch(path: &Path, seconds_ago: u64) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(seconds_ago))
            .unwrap();
    }

    #[test]
    fn runs_are_listed_by_their_newest_change_not_their_name() {
        let root = tempfile::tempdir().unwrap();
        touch(&root.path().join("2026-10-01_090000/notes.md"), 60);
        touch(&root.path().join("2026-10-02_090000/notes.md"), 3600);
        touch(&root.path().join("2026-10-02_090000/frames/a.png"), 7200);
        std::fs::write(root.path().join("stray.txt"), b"x").unwrap();

        let runs = list_runs(root.path());
        let names: Vec<_> = runs.iter().map(|run| run.name.as_str()).collect();
        assert_eq!(names, ["2026-10-01_090000", "2026-10-02_090000"]);
        assert_eq!(runs[1].file_count, 2);
        assert!(!runs[1].truncated);
    }

    #[test]
    fn a_missing_root_lists_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert!(list_runs(&home.path().join("nope")).is_empty());
    }

    #[test]
    fn a_runs_files_come_newest_first_with_paths_relative_to_the_run() {
        let root = tempfile::tempdir().unwrap();
        let run = root.path().join("2026-10-01_090000");
        touch(&run.join("old.md"), 3600);
        touch(&run.join("frames/new.png"), 5);

        let files = run_files(root.path(), &run.to_string_lossy()).unwrap();
        let relative: Vec<_> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert_eq!(relative, ["frames/new.png", "old.md"]);
    }

    #[test]
    fn only_a_direct_run_folder_resolves() {
        let root = tempfile::tempdir().unwrap();
        let run = root.path().join("2026-10-01_090000");
        std::fs::create_dir_all(run.join("frames")).unwrap();
        let elsewhere = tempfile::tempdir().unwrap();

        let resolved = resolve_run_dir(root.path(), &run.to_string_lossy()).unwrap();
        assert_eq!(resolved, run.canonicalize().unwrap());

        for bad in [
            root.path().to_path_buf(),
            run.join("frames"),
            run.join(".."),
            elsewhere.path().to_path_buf(),
            root.path().join("missing"),
        ] {
            assert!(
                resolve_run_dir(root.path(), &bad.to_string_lossy()).is_err(),
                "{bad:?} must not resolve"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_the_runs_root_does_not_lead_out_of_it() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let link = root.path().join("2026-10-01_090000");
        std::os::unix::fs::symlink(elsewhere.path(), &link).unwrap();
        assert!(resolve_run_dir(root.path(), &link.to_string_lossy()).is_err());
        assert!(
            list_runs(root.path()).is_empty(),
            "a linked folder is not a run"
        );
    }
}
