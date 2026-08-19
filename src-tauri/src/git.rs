use git2::{
    build::CheckoutBuilder, BranchType, Repository, StatusOptions, WorktreeAddOptions,
    WorktreePruneOptions,
};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: Option<String>,
    pub unstaged: Option<String>,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub kind: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitNameStatus {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    pub oid: String,
    pub author: String,
    pub timestamp: String,
    pub summary: String,
    pub start_line: u32,
    pub line_count: u32,
}

/// Whether a project folder (or a git repo inside it) has uncommitted work.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirty {
    pub path: String,
    pub dirty: bool,
}

/// A git work-tree root found under a project's root path.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoRef {
    /// Absolute work-tree path.
    pub path: String,
    /// Relative to the project root, "" when the root itself is the repo. `/`-separated.
    pub relative_path: String,
    /// Basename of the work tree (the project folder's name for the root repo).
    pub name: String,
    /// "root" | "nested" | "submodule"
    pub kind: String,
}

/// One linked worktree belonging to a repository. Auric-managed ones live in a
/// sibling `*.auric-wt` folder on a branch named `auric/…`.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub source_repo: String,
    pub is_auric: bool,
    pub dirty: bool,
    /// True when the worktree branch has commits the source HEAD does not.
    pub branch_ahead: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMergeResult {
    pub default_branch: String,
    pub merged: bool,
    pub fast_forward: bool,
    pub cleaned_up: bool,
    pub oid: Option<String>,
}

const AURIC_WORKTREE_DIR_SUFFIX: &str = ".auric-wt";
const AURIC_WORKTREE_BRANCH_PREFIX: &str = "auric/";
const DEFAULT_BRANCH_CANDIDATES: [&str; 2] = ["main", "master"];

/// How far below the project root discovery looks for a `.git`. Bounded so
/// opening a huge unrelated folder as a project never turns into a full-disk
/// walk.
const GIT_DISCOVERY_MAX_DEPTH: usize = 4;

#[tauri::command]
pub fn git_status(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    git_status_impl(repo_path)
}

// `async` so Tauri runs this off the IPC thread: a walk of the project tree
// (even pruned and depth-capped) should never block the window.
#[tauri::command(async)]
pub fn git_discover_repos(root_path: String) -> Result<Vec<GitRepoRef>, String> {
    git_discover_repos_impl(Path::new(&root_path))
}

// Same reason as discover: N project trees plus a status walk each. Splash
// paints first; the dots arrive when this finishes.
#[tauri::command(async)]
pub fn git_projects_dirty(paths: Vec<String>) -> Vec<ProjectDirty> {
    git_projects_dirty_impl(&paths)
}

#[tauri::command]
pub fn git_branch_info(repo_path: &str) -> Result<BranchInfo, String> {
    git_branch_info_impl(repo_path)
}

#[tauri::command]
pub fn git_diff(repo_path: &str, file_path: &str, side: Option<String>) -> Result<String, String> {
    git_diff_impl(repo_path, file_path, side.as_deref())
}

#[tauri::command]
pub fn git_stage(repo_path: &str, paths: Vec<String>) -> Result<(), String> {
    git_stage_impl(repo_path, &paths)
}

#[tauri::command]
pub fn git_unstage(repo_path: &str, paths: Vec<String>) -> Result<(), String> {
    git_unstage_impl(repo_path, &paths)
}

#[tauri::command]
pub fn git_commit(repo_path: &str, message: &str) -> Result<String, String> {
    git_commit_impl(repo_path, message)
}

#[tauri::command]
pub fn git_discard(repo_path: &str, file_path: &str) -> Result<(), String> {
    git_discard_impl(repo_path, file_path)
}

#[tauri::command]
pub fn git_push(repo_path: &str) -> Result<(), String> {
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
pub fn git_log_since(
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

#[tauri::command]
pub fn git_list_branches(repo_path: &str) -> Result<Vec<GitBranch>, String> {
    git_list_branches_impl(repo_path)
}

#[tauri::command(async)]
pub fn git_blame(repo_path: String, file_path: String) -> Result<Vec<BlameHunk>, String> {
    git_blame_impl(&repo_path, &file_path)
}

#[tauri::command(async)]
pub fn git_diff_commit(
    repo_path: String,
    oid: String,
    file_path: String,
) -> Result<String, String> {
    git_diff_commit_impl(&repo_path, &oid, &file_path)
}

#[tauri::command(async)]
pub fn git_diff_ref_files(
    repo_path: String,
    ref_name: String,
) -> Result<Vec<GitNameStatus>, String> {
    git_diff_ref_files_impl(&repo_path, &ref_name)
}

#[tauri::command(async)]
pub fn git_diff_file_ref(
    repo_path: String,
    ref_name: String,
    file_path: String,
) -> Result<String, String> {
    git_diff_file_ref_impl(&repo_path, &ref_name, &file_path)
}

/// Checkout a new linked worktree on a fresh `auric/…` branch. The agent
/// then runs with that path as its cwd so it cannot dirty the user's checkout.
#[tauri::command(async)]
pub fn git_worktree_add(repo_path: String, name: String) -> Result<GitWorktree, String> {
    git_worktree_add_impl(&repo_path, &name)
}

#[tauri::command(async)]
pub fn git_worktree_list(repo_path: String) -> Result<Vec<GitWorktree>, String> {
    git_worktree_list_impl(&repo_path)
}

/// Removes an Auric-managed worktree. Refuses a dirty checkout unless `force`.
#[tauri::command(async)]
pub fn git_worktree_remove(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    git_worktree_remove_impl(&repo_path, &worktree_path, force)
}

/// `main` or `master` — whichever this repository actually uses.
#[tauri::command(async)]
pub fn git_default_branch(repo_path: String) -> Result<String, String> {
    git_default_branch_impl(&repo_path)
}

/// Commit leftover worktree changes if needed, merge into main/master, then
/// remove the worktree.
#[tauri::command(async)]
pub fn git_worktree_merge_into_default(
    repo_path: String,
    worktree_path: String,
    commit_message: Option<String>,
) -> Result<WorktreeMergeResult, String> {
    git_worktree_merge_into_default_impl(&repo_path, &worktree_path, commit_message.as_deref())
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

        if status.is_ignored() {
            result.push(GitFileStatus {
                path,
                status: "ignored".to_string(),
                staged: None,
                unstaged: None,
            });
            continue;
        }

        let staged = if status.is_index_new() {
            Some("added".to_string())
        } else if status.is_index_deleted() {
            Some("deleted".to_string())
        } else if status.is_index_modified() || status.is_index_typechange() {
            Some("modified".to_string())
        } else {
            None
        };

        let unstaged = if status.is_wt_new() {
            Some("untracked".to_string())
        } else if status.is_wt_deleted() {
            Some("deleted".to_string())
        } else if status.is_wt_modified() || status.is_wt_typechange() {
            Some("modified".to_string())
        } else {
            None
        };

        let label = if status.is_index_new() {
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
            staged,
            unstaged,
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

    let workdir = repo
        .workdir()
        .ok_or_else(|| "Cannot stage in a bare repository".to_string())?;

    for path in paths {
        if workdir.join(path).exists() {
            index
                .add_path(Path::new(path))
                .map_err(|e| format!("Failed to stage {}: {}", path, e))?;
        } else {
            index
                .remove_path(Path::new(path))
                .map_err(|e| format!("Failed to stage {}: {}", path, e))?;
        }
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

    if let Some(head_tree) = repo.head().ok().and_then(|h| h.peel_to_tree().ok()) {
        if head_tree.id() == tree_oid {
            return Err("Nothing to commit".to_string());
        }
    }

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

fn print_diff(diff: &git2::Diff) -> Result<String, String> {
    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            '+' | '-' | ' ' => {
                diff_text.push(line.origin());
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            'F' => {
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            'H' => {
                diff_text.push_str(&String::from_utf8_lossy(line.content()));
            }
            _ => {}
        }
        true
    })
    .map_err(|e| format!("Failed to print diff: {}", e))?;
    Ok(diff_text)
}

fn synthetic_added_patch(file_path: &str, content: &str) -> String {
    let mut diff_text = format!("--- /dev/null\n+++ b/{}\n", file_path);
    let lines: Vec<&str> = content.lines().collect();
    diff_text.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
    for line in &lines {
        diff_text.push('+');
        diff_text.push_str(line);
        diff_text.push('\n');
    }
    diff_text
}

fn synthetic_deleted_patch(file_path: &str, content: &str) -> String {
    let mut diff_text = format!("--- a/{}\n+++ /dev/null\n", file_path);
    let lines: Vec<&str> = content.lines().collect();
    diff_text.push_str(&format!("@@ -1,{} +0,0 @@\n", lines.len()));
    for line in &lines {
        diff_text.push('-');
        diff_text.push_str(line);
        diff_text.push('\n');
    }
    diff_text
}

fn blob_text_at(repo: &Repository, tree: &git2::Tree, file_path: &str) -> Option<String> {
    let entry = tree.get_path(Path::new(file_path)).ok()?;
    let obj = entry.to_object(repo).ok()?;
    obj.as_blob()
        .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
}

fn blob_text_in_index(repo: &Repository, file_path: &str) -> Option<String> {
    let index = repo.index().ok()?;
    let entry = index.get_path(Path::new(file_path), 0)?;
    let blob = repo.find_blob(entry.id).ok()?;
    Some(String::from_utf8_lossy(blob.content()).into_owned())
}

pub fn git_diff_impl(
    repo_path: &str,
    file_path: &str,
    side: Option<&str>,
) -> Result<String, String> {
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

    if status.is_wt_new() {
        if side == Some("staged") {
            return Ok(String::new());
        }
        let full_path = Path::new(repo_path).join(file_path);
        let content =
            fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
        return Ok(synthetic_added_patch(file_path, &content));
    }

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    match side {
        Some("staged") => {
            if status.is_index_deleted() {
                if let Some(content) = head_tree
                    .as_ref()
                    .and_then(|tree| blob_text_at(&repo, tree, file_path))
                {
                    return Ok(synthetic_deleted_patch(file_path, &content));
                }
                return Ok(String::new());
            }
            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.pathspec(file_path);
            let diff = repo
                .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))
                .map_err(|e| format!("Failed to generate diff: {}", e))?;
            print_diff(&diff)
        }
        Some("unstaged") => {
            if status.is_wt_deleted() {
                let content = blob_text_in_index(&repo, file_path).or_else(|| {
                    head_tree
                        .as_ref()
                        .and_then(|tree| blob_text_at(&repo, tree, file_path))
                });
                if let Some(content) = content {
                    return Ok(synthetic_deleted_patch(file_path, &content));
                }
                return Ok(String::new());
            }
            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.pathspec(file_path);
            let diff = repo
                .diff_index_to_workdir(None, Some(&mut diff_opts))
                .map_err(|e| format!("Failed to generate diff: {}", e))?;
            print_diff(&diff)
        }
        _ => {
            if status.is_wt_deleted() || status.is_index_deleted() {
                if let Some(content) = head_tree
                    .as_ref()
                    .and_then(|tree| blob_text_at(&repo, tree, file_path))
                {
                    return Ok(synthetic_deleted_patch(file_path, &content));
                }
                return Ok(String::new());
            }
            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.pathspec(file_path);
            let diff = repo
                .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
                .map_err(|e| format!("Failed to generate diff: {}", e))?;
            print_diff(&diff)
        }
    }
}

pub fn git_list_branches_impl(repo_path: &str) -> Result<Vec<GitBranch>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let current = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let iter = match repo.branches(None) {
        Ok(i) => i,
        Err(_) => return Ok(Vec::new()),
    };

    let mut branches = Vec::new();
    for item in iter {
        let (branch, branch_type) = match item {
            Ok(v) => v,
            Err(_) => continue,
        };
        if branch.get().kind() == Some(git2::ReferenceType::Symbolic) {
            continue;
        }
        let name = match branch.name() {
            Ok(Some(n)) => n.to_string(),
            _ => continue,
        };
        if name == "HEAD" || name.ends_with("/HEAD") {
            continue;
        }
        let kind = match branch_type {
            git2::BranchType::Local => "local",
            git2::BranchType::Remote => "remote",
        };
        let is_current = current.as_deref() == Some(name.as_str());
        branches.push(GitBranch {
            name,
            kind: kind.to_string(),
            is_current,
        });
    }

    branches.sort_by(|a, b| match (a.is_current, b.is_current) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => match (a.kind.as_str(), b.kind.as_str()) {
            ("local", "remote") => Ordering::Less,
            ("remote", "local") => Ordering::Greater,
            _ => a.name.cmp(&b.name),
        },
    });
    Ok(branches)
}

pub fn git_blame_impl(repo_path: &str, file_path: &str) -> Result<Vec<BlameHunk>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };

    let full_path = Path::new(repo_path).join(file_path);
    if !full_path.is_file() {
        return Err(format!("File not found: {file_path}"));
    }
    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read {file_path}: {e}"))?;
    if bytes.contains(&0) {
        return Err(format!("Cannot blame binary file: {file_path}"));
    }

    let blame = repo
        .blame_file(Path::new(file_path), None)
        .map_err(|e| format!("Failed to blame {file_path}: {e}"))?;

    let mut cache: HashMap<git2::Oid, (String, String, String)> = HashMap::new();
    let mut hunks = Vec::new();
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        let (author, timestamp, summary) = if let Some(cached) = cache.get(&oid) {
            cached.clone()
        } else {
            let commit = repo
                .find_commit(oid)
                .map_err(|e| format!("Failed to read blame commit: {e}"))?;
            let author = commit.author().name().unwrap_or("").to_string();
            let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_default();
            let summary = commit.summary().unwrap_or("").to_string();
            cache.insert(oid, (author.clone(), timestamp.clone(), summary.clone()));
            (author, timestamp, summary)
        };
        hunks.push(BlameHunk {
            oid: oid.to_string(),
            author,
            timestamp,
            summary,
            start_line: hunk.final_start_line() as u32,
            line_count: hunk.lines_in_hunk() as u32,
        });
    }
    Ok(merge_consecutive_blame_hunks(hunks))
}

fn merge_consecutive_blame_hunks(hunks: Vec<BlameHunk>) -> Vec<BlameHunk> {
    let mut merged: Vec<BlameHunk> = Vec::new();
    for hunk in hunks {
        if let Some(last) = merged.last_mut() {
            if last.oid == hunk.oid && last.start_line + last.line_count == hunk.start_line {
                last.line_count += hunk.line_count;
                continue;
            }
        }
        merged.push(hunk);
    }
    merged
}

pub fn git_diff_commit_impl(repo_path: &str, oid: &str, file_path: &str) -> Result<String, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(String::new()),
    };

    let parsed = git2::Oid::from_str(oid).map_err(|e| format!("Unknown ref: {e}"))?;
    let commit = repo
        .find_commit(parsed)
        .map_err(|e| format!("Unknown ref: {e}"))?;
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to read commit tree: {e}"))?;
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut opts = git2::DiffOptions::new();
    opts.pathspec(file_path);
    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| format!("Failed to diff commit: {e}"))?;
    print_diff(&diff)
}

fn peel_ref_to_tree<'a>(repo: &'a Repository, ref_name: &str) -> Result<git2::Tree<'a>, String> {
    let obj = repo
        .revparse_single(ref_name)
        .map_err(|e| format!("Unknown ref '{ref_name}': {e}"))?;
    obj.peel_to_tree()
        .map_err(|e| format!("Failed to peel '{ref_name}' to a tree: {e}"))
}

fn diff_ref_to_workdir<'a>(
    repo: &'a Repository,
    ref_name: &str,
    pathspec: Option<&str>,
) -> Result<git2::Diff<'a>, String> {
    let tree = peel_ref_to_tree(repo, ref_name)?;
    let mut opts = git2::DiffOptions::new();
    if let Some(path) = pathspec {
        opts.pathspec(path);
    }
    repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))
        .map_err(|e| format!("Failed to diff against '{ref_name}': {e}"))
}

fn name_status_from_delta(delta: git2::DiffDelta<'_>) -> Option<GitNameStatus> {
    let status = match delta.status() {
        git2::Delta::Added | git2::Delta::Untracked => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified
        | git2::Delta::Typechange
        | git2::Delta::Renamed
        | git2::Delta::Copied => "modified",
        _ => return None,
    };
    let path = if delta.status() == git2::Delta::Deleted {
        delta.old_file().path()
    } else {
        delta.new_file().path().or_else(|| delta.old_file().path())
    }?;
    Some(GitNameStatus {
        path: path.to_str()?.to_string(),
        status: status.to_string(),
    })
}

pub fn git_diff_ref_files_impl(
    repo_path: &str,
    ref_name: &str,
) -> Result<Vec<GitNameStatus>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()),
    };
    let diff = diff_ref_to_workdir(&repo, ref_name, None)?;
    Ok(diff.deltas().filter_map(name_status_from_delta).collect())
}

pub fn git_diff_file_ref_impl(
    repo_path: &str,
    ref_name: &str,
    file_path: &str,
) -> Result<String, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(String::new()),
    };
    let diff = diff_ref_to_workdir(&repo, ref_name, Some(file_path))?;
    print_diff(&diff)
}

/// A directory is a repo root when it carries a `.git` — worktree checkouts
/// and submodules keep a `.git` file, an ordinary clone a `.git` directory.
fn is_git_repo_dir(dir: &Path) -> bool {
    let git_marker = dir.join(".git");
    git_marker.is_dir() || git_marker.is_file()
}

/// `path` relative to `root`, `/`-separated regardless of platform, empty
/// when `path` is `root` itself.
fn relative_to_root(root: &Path, path: &Path) -> String {
    if path == root {
        return String::new();
    }
    path.strip_prefix(root)
        .map(|rel| {
            rel.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// `submodule` iff the nearest enclosing discovered repo declares `path` at
/// that relative location; `nested` otherwise (including a `path` with no
/// enclosing discovered repo at all, and an enclosing repo that fails to open
/// or has no submodules).
fn classify_kind(path: &Path, discovered: &[PathBuf]) -> String {
    let enclosing = discovered
        .iter()
        .filter(|candidate| candidate.as_path() != path && path.starts_with(candidate))
        .max_by_key(|candidate| candidate.components().count());

    let Some(enclosing) = enclosing else {
        return "nested".to_string();
    };
    let Ok(repo) = Repository::open(enclosing) else {
        return "nested".to_string();
    };
    let Ok(submodules) = repo.submodules() else {
        return "nested".to_string();
    };
    let Ok(relative_to_enclosing) = path.strip_prefix(enclosing) else {
        return "nested".to_string();
    };
    let relative_to_enclosing = relative_to_enclosing.to_string_lossy().replace('\\', "/");

    let is_declared_submodule = submodules
        .iter()
        .any(|sm| sm.path().to_string_lossy().replace('\\', "/") == relative_to_enclosing);

    if is_declared_submodule {
        "submodule".to_string()
    } else {
        "nested".to_string()
    }
}

pub fn git_discover_repos_impl(root_path: &Path) -> Result<Vec<GitRepoRef>, String> {
    if !root_path.is_dir() {
        return Err(format!(
            "{} is not a readable directory",
            root_path.display()
        ));
    }

    let repo_dirs: Vec<PathBuf> = WalkDir::new(root_path)
        .max_depth(GIT_DISCOVERY_MAX_DEPTH)
        .into_iter()
        // Depth 0 is the root itself, chosen by the caller — a project
        // legitimately checked out into a folder named `target` or `dist`
        // must still be discovered even though that name is pruned below it.
        .filter_entry(|e| e.depth() == 0 || !crate::skip_recent_walk_dir(e))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
        .map(|e| e.path().to_path_buf())
        .filter(|dir| is_git_repo_dir(dir))
        .collect();

    let mut repos: Vec<GitRepoRef> = repo_dirs
        .iter()
        .map(|path| {
            let relative_path = relative_to_root(root_path, path);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let kind = if path == root_path {
                "root".to_string()
            } else {
                classify_kind(path, &repo_dirs)
            };
            GitRepoRef {
                path: path.to_string_lossy().into_owned(),
                relative_path,
                name,
                kind,
            }
        })
        .collect();

    // Root first ("" sorts before any non-empty string), then relative path
    // ascending — deterministic regardless of the walk's own visiting order.
    repos.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(repos)
}

/// The primary checkout that owns `path`'s git directory. A linked worktree
/// resolves to the main working tree, so MCP / provider policy still read the
/// project's `.auric` rather than a missing copy under the worktree.
pub fn primary_project_path(path: &Path) -> Option<PathBuf> {
    let repo = Repository::open(path).ok()?;
    let git_dir = repo.path();
    // Linked worktrees live at `<main>/.git/worktrees/<name>`. git2 0.19 has
    // no `commondir()`, so walk that known layout.
    if git_dir
        .parent()
        .and_then(|p| p.file_name())
        .is_some_and(|name| name == "worktrees")
    {
        return git_dir
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| trim_trailing_slash(p.to_path_buf()));
    }
    repo.workdir()
        .map(|dir| trim_trailing_slash(dir.to_path_buf()))
}

fn trim_trailing_slash(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    let Some(stripped) = raw.strip_suffix('/') else {
        return path;
    };
    if stripped.is_empty() {
        path
    } else {
        PathBuf::from(stripped)
    }
}

fn slugify_worktree_name(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.len() > 32 {
        slug.truncate(32);
        while slug.ends_with('-') {
            slug.pop();
        }
    }
    if slug.is_empty() {
        "agent".to_string()
    } else {
        slug
    }
}

fn unique_worktree_id(base: &str, parent: &Path) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    for i in 0..32 {
        let suffix = format!("{:x}", (nanos.wrapping_add(i as u128) % 0xFFFF_FFFF) as u32);
        let id = format!("{base}-{suffix}");
        if !parent.join(&id).exists() {
            return id;
        }
    }
    format!("{base}-{}", nanos)
}

fn auric_worktree_parent(workdir: &Path) -> Result<PathBuf, String> {
    let parent = workdir
        .parent()
        .ok_or_else(|| "repository has no parent directory for a worktree".to_string())?;
    let repo_name = workdir
        .file_name()
        .ok_or_else(|| "repository path has no folder name".to_string())?;
    Ok(parent.join(format!(
        "{}{AURIC_WORKTREE_DIR_SUFFIX}",
        repo_name.to_string_lossy()
    )))
}

fn path_is_auric_worktree(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_string_lossy()
            .ends_with(AURIC_WORKTREE_DIR_SUFFIX)
    })
}

fn branch_is_auric(branch: Option<&str>) -> bool {
    branch.is_some_and(|b| b.starts_with(AURIC_WORKTREE_BRANCH_PREFIX))
}

fn open_main_repo(repo_path: &str) -> Result<(Repository, PathBuf), String> {
    let opened = Repository::open(repo_path).map_err(|e| format!("not a git repository: {e}"))?;
    let source = primary_project_path(Path::new(repo_path))
        .ok_or_else(|| "could not resolve the repository's main working tree".to_string())?;
    if source.as_os_str() == Path::new(repo_path).as_os_str() {
        return Ok((opened, source));
    }
    let main = Repository::open(&source).map_err(|e| e.to_string())?;
    Ok((main, source))
}

fn worktree_branch_name(path: &Path) -> Option<String> {
    let repo = Repository::open(path).ok()?;
    let head = repo.head().ok()?;
    head.shorthand().map(|s| s.to_string())
}

fn describe_worktree(source_repo: &Path, name: &str, path: &Path) -> GitWorktree {
    let path_str = path.to_string_lossy().into_owned();
    let branch = worktree_branch_name(path);
    let dirty = repo_is_dirty(path);
    let branch_ahead = worktree_branch_is_ahead(source_repo, path);
    GitWorktree {
        path: path_str,
        name: name.to_string(),
        is_auric: path_is_auric_worktree(path) || branch_is_auric(branch.as_deref()),
        branch,
        source_repo: source_repo.to_string_lossy().into_owned(),
        dirty,
        branch_ahead,
    }
}

fn worktree_branch_is_ahead(source_repo: &Path, worktree_path: &Path) -> bool {
    let Ok(main) = Repository::open(source_repo) else {
        return false;
    };
    let Ok(wt) = Repository::open(worktree_path) else {
        return false;
    };
    let Ok(main_oid) = main.head().and_then(|h| h.peel_to_commit()).map(|c| c.id()) else {
        return false;
    };
    let Ok(wt_oid) = wt.head().and_then(|h| h.peel_to_commit()).map(|c| c.id()) else {
        return false;
    };
    if main_oid == wt_oid {
        return false;
    }
    // Unique work if main is not a descendant of the worktree commit — i.e. the
    // worktree introduced commits main does not have.
    !main.graph_descendant_of(main_oid, wt_oid).unwrap_or(false)
}

pub fn git_worktree_add_impl(repo_path: &str, name: &str) -> Result<GitWorktree, String> {
    let (repo, source) = open_main_repo(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "repository has no working tree".to_string())?
        .to_path_buf();
    let parent = auric_worktree_parent(&workdir)?;
    fs::create_dir_all(&parent).map_err(|e| format!("could not create worktree folder: {e}"))?;

    let slug = slugify_worktree_name(name);
    let id = unique_worktree_id(&slug, &parent);
    let dest = parent.join(&id);
    let branch_name = format!("{AURIC_WORKTREE_BRANCH_PREFIX}{id}");

    let commit = repo
        .head()
        .map_err(|e| format!("repository has no HEAD: {e}"))?
        .peel_to_commit()
        .map_err(|e| format!("HEAD is not a commit: {e}"))?;
    let branch = repo
        .branch(&branch_name, &commit, false)
        .map_err(|e| format!("could not create branch {branch_name}: {e}"))?;
    let reference = branch.into_reference();

    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(&reference));
    repo.worktree(&id, &dest, Some(&opts))
        .map_err(|e| format!("could not add worktree: {e}"))?;

    Ok(describe_worktree(&source, &id, &dest))
}

pub fn git_worktree_list_impl(repo_path: &str) -> Result<Vec<GitWorktree>, String> {
    let (repo, source) = open_main_repo(repo_path)?;
    let names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut trees: Vec<GitWorktree> = names
        .iter()
        .flatten()
        .filter_map(|name| {
            let wt = repo.find_worktree(name).ok()?;
            Some(describe_worktree(&source, name, wt.path()))
        })
        .filter(|wt| wt.is_auric)
        .collect();
    trees.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(trees)
}

pub fn git_worktree_remove_impl(
    repo_path: &str,
    worktree_path: &str,
    force: bool,
) -> Result<(), String> {
    let (repo, source) = open_main_repo(repo_path)?;
    let target = Path::new(worktree_path);
    if !path_is_auric_worktree(target) {
        return Err("only Auric-managed worktrees can be removed here".to_string());
    }

    let names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut found = None;
    for name in names.iter().flatten() {
        if let Ok(wt) = repo.find_worktree(name) {
            if same_path(wt.path(), target) {
                found = Some((name.to_string(), wt));
                break;
            }
        }
    }
    let (name, wt) = found.ok_or_else(|| "worktree not found".to_string())?;

    let described = describe_worktree(&source, &name, wt.path());
    if described.dirty && !force {
        return Err("worktree has uncommitted changes".to_string());
    }

    let branch = described.branch.clone();

    let mut prune = WorktreePruneOptions::new();
    prune.valid(true).working_tree(true).locked(true);
    wt.prune(Some(&mut prune))
        .map_err(|e| format!("could not remove worktree: {e}"))?;

    if let Some(branch_name) = branch.filter(|b| branch_is_auric(Some(b))) {
        if let Ok(mut b) = repo.find_branch(&branch_name, git2::BranchType::Local) {
            let _ = b.delete();
        }
    }

    Ok(())
}

pub fn git_default_branch_impl(repo_path: &str) -> Result<String, String> {
    let (repo, _) = open_main_repo(repo_path)?;
    resolve_default_branch(&repo)
}

fn origin_head_branch(repo: &Repository) -> Option<String> {
    let reference = repo.find_reference("refs/remotes/origin/HEAD").ok()?;
    let target = reference.symbolic_target()?;
    target
        .strip_prefix("refs/remotes/origin/")
        .map(|s| s.to_string())
}

fn local_branch_exists(repo: &Repository, name: &str) -> bool {
    repo.find_branch(name, BranchType::Local).is_ok()
}

fn resolve_default_branch(repo: &Repository) -> Result<String, String> {
    if let Some(origin) = origin_head_branch(repo) {
        if DEFAULT_BRANCH_CANDIDATES.contains(&origin.as_str())
            && local_branch_exists(repo, &origin)
        {
            return Ok(origin);
        }
    }
    for name in DEFAULT_BRANCH_CANDIDATES {
        if local_branch_exists(repo, name) {
            return Ok(name.to_string());
        }
    }
    Err("could not determine default branch (main or master)".to_string())
}

fn commit_worktree_if_dirty(worktree_path: &str, message: &str) -> Result<Option<String>, String> {
    let paths: Vec<String> = git_status_impl(worktree_path)?
        .into_iter()
        .filter(|s| s.status != "ignored")
        .map(|s| s.path)
        .collect();
    if paths.is_empty() {
        return Ok(None);
    }
    git_stage_impl(worktree_path, &paths)?;
    match git_commit_impl(worktree_path, message) {
        Ok(oid) => Ok(Some(oid)),
        Err(e) if e.contains("Nothing to commit") => Ok(None),
        Err(e) => Err(e),
    }
}

fn head_is_branch(repo: &Repository, name: &str) -> bool {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s == name))
        .unwrap_or(false)
}

fn branch_commit_id(repo: &Repository, name: &str) -> Result<git2::Oid, String> {
    let branch = repo
        .find_branch(name, BranchType::Local)
        .map_err(|e| format!("branch {name} not found: {e}"))?;
    branch
        .get()
        .peel_to_commit()
        .map(|c| c.id())
        .map_err(|e| format!("branch {name} is not a commit: {e}"))
}

fn fast_forward_branch(
    repo: &Repository,
    branch_name: &str,
    oid: git2::Oid,
    checkout: bool,
) -> Result<(), String> {
    let mut reference = repo
        .find_reference(&format!("refs/heads/{branch_name}"))
        .map_err(|e| format!("could not open {branch_name}: {e}"))?;
    reference
        .set_target(oid, "fast-forward merge of agent worktree")
        .map_err(|e| format!("could not fast-forward {branch_name}: {e}"))?;
    if checkout {
        repo.set_head(&format!("refs/heads/{branch_name}"))
            .map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| format!("could not update working tree: {e}"))?;
    }
    Ok(())
}

fn merge_commits_onto_branch(
    repo: &Repository,
    default_branch: &str,
    theirs_branch: &str,
    ours_id: git2::Oid,
    theirs_id: git2::Oid,
    checkout: bool,
) -> Result<git2::Oid, String> {
    let ours = repo
        .find_commit(ours_id)
        .map_err(|e| format!("could not read {default_branch}: {e}"))?;
    let theirs = repo
        .find_commit(theirs_id)
        .map_err(|e| format!("could not read {theirs_branch}: {e}"))?;
    let mut index = repo
        .merge_commits(&ours, &theirs, None)
        .map_err(|e| format!("could not merge: {e}"))?;
    if index.has_conflicts() {
        return Err(
            "merge conflict — the worktree was left in place so you can resolve it".to_string(),
        );
    }
    let tree_oid = index
        .write_tree_to(repo)
        .map_err(|e| format!("could not write merge tree: {e}"))?;
    let tree = repo
        .find_tree(tree_oid)
        .map_err(|e| format!("could not read merge tree: {e}"))?;
    let sig = repo.signature().map_err(|e| {
        format!(
            "Failed to get git signature: {}. Please configure git user.name and user.email.",
            e
        )
    })?;
    let msg = format!("Merge branch '{theirs_branch}' into {default_branch}");
    let refname = if checkout {
        "HEAD".to_string()
    } else {
        format!("refs/heads/{default_branch}")
    };
    let oid = repo
        .commit(Some(&refname), &sig, &sig, &msg, &tree, &[&ours, &theirs])
        .map_err(|e| format!("could not create merge commit: {e}"))?;
    if checkout {
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| format!("could not update working tree: {e}"))?;
    }
    Ok(oid)
}

pub fn git_worktree_merge_into_default_impl(
    repo_path: &str,
    worktree_path: &str,
    commit_message: Option<&str>,
) -> Result<WorktreeMergeResult, String> {
    let target = Path::new(worktree_path);
    if !path_is_auric_worktree(target) {
        return Err("only Auric-managed worktrees can be merged here".to_string());
    }

    let message = commit_message.unwrap_or("Auric worktree");
    commit_worktree_if_dirty(worktree_path, message)?;

    let theirs_branch = worktree_branch_name(target)
        .filter(|b| branch_is_auric(Some(b)))
        .ok_or_else(|| "worktree is not on an auric/ branch".to_string())?;

    let (repo, _) = open_main_repo(repo_path)?;
    let default_branch = resolve_default_branch(&repo)?;
    let ours_id = branch_commit_id(&repo, &default_branch)?;
    let theirs_id = branch_commit_id(&repo, &theirs_branch)?;
    let on_default = head_is_branch(&repo, &default_branch);

    let already_contains = ours_id == theirs_id
        || repo
            .graph_descendant_of(ours_id, theirs_id)
            .unwrap_or(false);
    if already_contains {
        git_worktree_remove_impl(repo_path, worktree_path, true)?;
        return Ok(WorktreeMergeResult {
            default_branch,
            merged: false,
            fast_forward: false,
            cleaned_up: true,
            oid: Some(ours_id.to_string()),
        });
    }

    if on_default {
        if let Some(dir) = repo.workdir() {
            if repo_is_dirty(dir) {
                return Err(format!(
                    "{default_branch} has uncommitted changes — commit or stash them before merging"
                ));
            }
        }
    }

    let can_ff = repo
        .graph_descendant_of(theirs_id, ours_id)
        .unwrap_or(false);
    let oid = if can_ff {
        fast_forward_branch(&repo, &default_branch, theirs_id, on_default)?;
        theirs_id
    } else {
        merge_commits_onto_branch(
            &repo,
            &default_branch,
            &theirs_branch,
            ours_id,
            theirs_id,
            on_default,
        )?
    };

    let cleaned_up = git_worktree_remove_impl(repo_path, worktree_path, true).is_ok();
    Ok(WorktreeMergeResult {
        default_branch,
        merged: true,
        fast_forward: can_ff,
        cleaned_up,
        oid: Some(oid.to_string()),
    })
}

fn same_path(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(aa), Ok(bb)) => aa == bb,
        _ => a.to_string_lossy() == b.to_string_lossy(),
    }
}

/// One row per input path, in the same order, echoing the path the caller
/// sent. Canonicalising would break the match against starred-project keys.
pub fn git_projects_dirty_impl(paths: &[String]) -> Vec<ProjectDirty> {
    paths
        .iter()
        .map(|path| ProjectDirty {
            path: path.clone(),
            dirty: project_is_dirty(Path::new(path)),
        })
        .collect()
}

fn project_is_dirty(root: &Path) -> bool {
    let repos = match git_discover_repos_impl(root) {
        Ok(repos) => repos,
        Err(_) => return false,
    };
    repos
        .iter()
        .any(|repo| repo_is_dirty(Path::new(&repo.path)))
}

/// Uncommitted work only: staged, unstaged, or untracked. Ignored files do
/// not count — a `node_modules` sitting on disk is not "you have a commit
/// waiting".
fn repo_is_dirty(repo_path: &Path) -> bool {
    let repo = match Repository::open(repo_path) {
        Ok(repo) => repo,
        Err(_) => return false,
    };
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = match repo.statuses(Some(&mut opts)) {
        Ok(statuses) => statuses,
        Err(_) => return false,
    };
    statuses.iter().any(|entry| {
        let status = entry.status();
        !status.is_ignored()
            && (status.is_index_new()
                || status.is_index_modified()
                || status.is_index_deleted()
                || status.is_index_typechange()
                || status.is_index_renamed()
                || status.is_wt_new()
                || status.is_wt_modified()
                || status.is_wt_deleted()
                || status.is_wt_typechange()
                || status.is_wt_renamed()
                || status.is_conflicted())
    })
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

    /// `git`, detached from any git environment the caller happens to be in.
    ///
    /// A git hook exports `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_WORK_TREE`, and
    /// those beat `current_dir` — so under `pre-commit` these helpers operated
    /// on the real repository instead of the temporary one, and the tests that
    /// depend on their own history failed there while passing everywhere else.
    /// `git commit` also hands its hooks `GIT_AUTHOR_*` / `GIT_COMMITTER_*`,
    /// which beat the `user.name` these repos configure — so a blame test
    /// read the committing person's name instead of "Test".
    fn git_command(dir: &std::path::Path) -> StdCommand {
        let mut command = StdCommand::new("git");
        command
            .current_dir(dir)
            .env_remove("GIT_DIR")
            .env_remove("GIT_INDEX_FILE")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_OBJECT_DIRECTORY")
            .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
            .env_remove("GIT_AUTHOR_NAME")
            .env_remove("GIT_AUTHOR_EMAIL")
            .env_remove("GIT_AUTHOR_DATE")
            .env_remove("GIT_COMMITTER_NAME")
            .env_remove("GIT_COMMITTER_EMAIL")
            .env_remove("GIT_COMMITTER_DATE");
        command
    }

    fn init_test_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path();
        git_command(path).args(["init"]).output().unwrap();
        git_command(path)
            .args(["config", "user.email", "test@test.com"])
            .output()
            .unwrap();
        git_command(path)
            .args(["config", "user.name", "Test"])
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
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", message])
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
    fn test_git_diff_untracked_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("hello.txt"), "line1\nline2\n").unwrap();

        let diff = git_diff_impl(repo_path, "hello.txt", None).unwrap();
        assert!(diff.contains("+++ b/hello.txt"));
        assert!(diff.contains("+line1"));
        assert!(diff.contains("+line2"));
    }

    #[test]
    fn test_git_diff_modified_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();

        fs::write(dir.path().join("file.txt"), "modified\n").unwrap();

        let diff = git_diff_impl(repo_path, "file.txt", None).unwrap();
        assert!(diff.contains("-original"));
        assert!(diff.contains("+modified"));
    }

    #[test]
    fn test_git_diff_deleted_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("gone.txt"), "bye\n").unwrap();
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();

        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        let diff = git_diff_impl(repo_path, "gone.txt", None).unwrap();
        assert!(diff.contains("--- a/gone.txt"));
        assert!(diff.contains("-bye"));
    }

    #[test]
    fn test_git_diff_no_changes() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("clean.txt"), "hello\n").unwrap();
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();

        let diff = git_diff_impl(repo_path, "clean.txt", None).unwrap();
        assert!(diff.is_empty());
    }

    #[test]
    fn test_git_discard_modified_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        fs::write(dir.path().join("file.txt"), "original\n").unwrap();
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
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
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
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
        git_command(dir.path()).args(["add", "."]).output().unwrap();
        git_command(dir.path())
            .args(["commit", "-m", "init"])
            .output()
            .unwrap();

        // Stage a brand-new file
        fs::write(dir.path().join("added.txt"), "added\n").unwrap();
        git_command(dir.path())
            .args(["add", "added.txt"])
            .output()
            .unwrap();
        assert!(dir.path().join("added.txt").exists());

        git_discard_impl(repo_path, "added.txt").unwrap();
        assert!(!dir.path().join("added.txt").exists());
    }

    #[test]
    fn git_status_reports_an_ignored_directory_itself() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        fs::write(dir.path().join(".gitignore"), "build/\nsecret.txt\n").unwrap();
        fs::create_dir(dir.path().join("build")).unwrap();
        fs::write(dir.path().join("build").join("out.js"), "x").unwrap();
        fs::write(dir.path().join("secret.txt"), "s").unwrap();

        let statuses = git_status_impl(&path).unwrap();
        let ignored: Vec<&str> = statuses
            .iter()
            .filter(|s| s.status == "ignored")
            .map(|s| s.path.as_str())
            .collect();

        assert!(
            ignored.iter().any(|p| *p == "secret.txt"),
            "ignored files must appear, got {ignored:?}"
        );
        // libgit2 reports ignored directories with a trailing slash. The
        // explorer's relative paths do not — resolveGitStatus strips it.
        assert!(
            ignored.contains(&"build/"),
            "ignored directories must appear as themselves, got {ignored:?}"
        );
        for path in ["secret.txt", "build/"] {
            let row = statuses.iter().find(|s| s.path == path).unwrap();
            assert_eq!(row.status, "ignored");
            assert_eq!(row.staged, None);
            assert_eq!(row.unstaged, None);
        }
    }

    fn find_status<'a>(rows: &'a [GitFileStatus], path: &str) -> &'a GitFileStatus {
        rows.iter()
            .find(|s| s.path == path)
            .unwrap_or_else(|| panic!("missing status for {path}"))
    }

    #[test]
    fn git_status_reports_both_sides_as_modified_on_each_axis() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "file.txt", "v1\n", "init");
        fs::write(dir.path().join("file.txt"), "v2\n").unwrap();
        git_stage_impl(repo_path, &["file.txt".to_string()]).unwrap();
        fs::write(dir.path().join("file.txt"), "v3\n").unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "file.txt");
        assert_eq!(row.staged.as_deref(), Some("modified"));
        assert_eq!(row.unstaged.as_deref(), Some("modified"));
        assert_eq!(row.status, "modified");
    }

    #[test]
    fn git_status_reports_untracked() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        fs::write(dir.path().join("new.txt"), "hi\n").unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "new.txt");
        assert_eq!(row.status, "untracked");
        assert_eq!(row.staged, None);
        assert_eq!(row.unstaged.as_deref(), Some("untracked"));
    }

    #[test]
    fn git_status_reports_staged_new() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        fs::write(dir.path().join("new.txt"), "hi\n").unwrap();
        git_stage_impl(repo_path, &["new.txt".to_string()]).unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "new.txt");
        assert_eq!(row.status, "added");
        assert_eq!(row.staged.as_deref(), Some("added"));
        assert_eq!(row.unstaged, None);
    }

    #[test]
    fn git_status_reports_unstaged_delete() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "gone.txt", "bye\n", "init");
        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "gone.txt");
        assert_eq!(row.status, "deleted");
        assert_eq!(row.staged, None);
        assert_eq!(row.unstaged.as_deref(), Some("deleted"));
    }

    #[test]
    fn git_status_reports_staged_delete() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "gone.txt", "bye\n", "init");
        fs::remove_file(dir.path().join("gone.txt")).unwrap();
        git_stage_impl(repo_path, &["gone.txt".to_string()]).unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "gone.txt");
        assert_eq!(row.status, "deleted");
        assert_eq!(row.staged.as_deref(), Some("deleted"));
        assert_eq!(row.unstaged, None);
    }

    #[test]
    fn git_stage_impl_stages_a_deleted_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "gone.txt", "bye\n", "init");
        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        git_stage_impl(repo_path, &["gone.txt".to_string()]).unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        let row = find_status(&rows, "gone.txt");
        assert_eq!(row.staged.as_deref(), Some("deleted"));
    }

    #[test]
    fn git_stage_impl_includes_deletion_in_a_multi_path_call() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "keep.txt", "a\n", "one");
        commit_file(&dir, "gone.txt", "b\n", "two");
        fs::write(dir.path().join("keep.txt"), "aa\n").unwrap();
        fs::remove_file(dir.path().join("gone.txt")).unwrap();

        git_stage_impl(repo_path, &["keep.txt".to_string(), "gone.txt".to_string()]).unwrap();

        let rows = git_status_impl(repo_path).unwrap();
        assert_eq!(
            find_status(&rows, "keep.txt").staged.as_deref(),
            Some("modified")
        );
        assert_eq!(
            find_status(&rows, "gone.txt").staged.as_deref(),
            Some("deleted")
        );
    }

    #[test]
    fn git_commit_impl_refuses_a_clean_index() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let err = git_commit_impl(&path, "empty").unwrap_err();
        assert_eq!(err, "Nothing to commit");
    }

    #[test]
    fn git_diff_impl_side_splits_a_both_sides_file() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "file.txt", "v1\n", "init");
        fs::write(dir.path().join("file.txt"), "v2\n").unwrap();
        git_stage_impl(repo_path, &["file.txt".to_string()]).unwrap();
        fs::write(dir.path().join("file.txt"), "v3\n").unwrap();

        let staged = git_diff_impl(repo_path, "file.txt", Some("staged")).unwrap();
        let unstaged = git_diff_impl(repo_path, "file.txt", Some("unstaged")).unwrap();
        let combined = git_diff_impl(repo_path, "file.txt", None).unwrap();

        assert_ne!(staged, unstaged);
        assert!(staged.contains("-v1"), "staged={staged}");
        assert!(staged.contains("+v2"), "staged={staged}");
        assert!(!staged.contains("v3"), "staged={staged}");
        assert!(unstaged.contains("-v2"), "unstaged={unstaged}");
        assert!(unstaged.contains("+v3"), "unstaged={unstaged}");
        assert!(combined.contains("-v1"), "combined={combined}");
        assert!(combined.contains("+v3"), "combined={combined}");
    }

    #[test]
    fn git_diff_impl_untracked_staged_is_empty() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        fs::write(dir.path().join("new.txt"), "hi\n").unwrap();

        let staged = git_diff_impl(repo_path, "new.txt", Some("staged")).unwrap();
        let unstaged = git_diff_impl(repo_path, "new.txt", Some("unstaged")).unwrap();
        assert!(
            staged.is_empty(),
            "staged untracked should be empty, got {staged}"
        );
        assert!(unstaged.contains("+hi"), "unstaged={unstaged}");
    }

    fn current_branch_name(repo_path: &str) -> String {
        Repository::open(repo_path)
            .unwrap()
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_string()
    }

    fn add_remote_tracking(repo_path: &str, name: &str) {
        let repo = Repository::open(repo_path).unwrap();
        let oid = repo.head().unwrap().target().unwrap();
        repo.reference(&format!("refs/remotes/{name}"), oid, true, "test")
            .unwrap();
    }

    #[test]
    fn git_list_branches_lists_local_remote_and_marks_current() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let current = current_branch_name(&path);
        {
            let repo = Repository::open(&path).unwrap();
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.branch("develop", &head, false).unwrap();
        }
        add_remote_tracking(&path, &format!("origin/{current}"));
        add_remote_tracking(&path, "origin/zzz");
        {
            let repo = Repository::open(&path).unwrap();
            repo.reference_symbolic(
                "refs/remotes/origin/HEAD",
                &format!("refs/remotes/origin/{current}"),
                true,
                "test",
            )
            .unwrap();
        }

        let branches = git_list_branches_impl(&path).unwrap();
        let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
        assert!(
            !names.iter().any(|n| n.ends_with("/HEAD") || *n == "HEAD"),
            "symbolic HEAD must be skipped, got {names:?}"
        );

        let current_row = branches.iter().find(|b| b.is_current).unwrap();
        assert_eq!(current_row.name, current);
        assert_eq!(current_row.kind, "local");
        assert_eq!(branches[0].name, current, "current branch sorts first");

        let develop = branches.iter().find(|b| b.name == "develop").unwrap();
        assert_eq!(develop.kind, "local");
        assert!(!develop.is_current);

        let remote_main = branches
            .iter()
            .find(|b| b.name == format!("origin/{current}"))
            .unwrap();
        assert_eq!(remote_main.kind, "remote");
        assert!(!remote_main.is_current);

        let remote_zzz = branches.iter().find(|b| b.name == "origin/zzz").unwrap();
        assert_eq!(remote_zzz.kind, "remote");

        let first_remote = branches.iter().position(|b| b.kind == "remote").unwrap();
        assert!(
            branches[..first_remote].iter().all(|b| b.kind == "local"),
            "locals must sort before remotes: {names:?}"
        );
        let local_names: Vec<&str> = branches
            .iter()
            .filter(|b| b.kind == "local" && !b.is_current)
            .map(|b| b.name.as_str())
            .collect();
        let mut sorted_locals = local_names.clone();
        sorted_locals.sort();
        assert_eq!(local_names, sorted_locals);
        let remote_names: Vec<&str> = branches
            .iter()
            .filter(|b| b.kind == "remote")
            .map(|b| b.name.as_str())
            .collect();
        let mut sorted_remotes = remote_names.clone();
        sorted_remotes.sort();
        assert_eq!(remote_names, sorted_remotes);
    }

    #[test]
    fn git_list_branches_is_empty_for_non_repo() {
        let plain = TempDir::new().unwrap();
        assert!(git_list_branches_impl(plain.path().to_str().unwrap())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn git_diff_commit_shows_change_versus_parent() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "v1\n", "first");
        commit_file(&dir, "a.txt", "v2\n", "second");
        let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();
        assert_eq!(log[0].summary, "second");

        let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
        assert!(patch.contains("-v1"), "patch={patch}");
        assert!(patch.contains("+v2"), "patch={patch}");
    }

    #[test]
    fn git_diff_commit_root_is_versus_empty_tree() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "v1\n", "first");
        let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();

        let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
        assert!(patch.contains("+v1"), "root patch={patch}");
        assert!(
            !patch.contains("-v1"),
            "root should not delete, patch={patch}"
        );
    }

    #[test]
    fn git_diff_commit_missing_path_is_empty() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "v1\n", "first");
        let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();

        let patch = git_diff_commit_impl(repo_path, &log[0].oid, "nope.txt").unwrap();
        assert!(patch.is_empty());
    }

    #[test]
    fn git_diff_commit_is_empty_for_non_repo() {
        let plain = TempDir::new().unwrap();
        assert!(
            git_diff_commit_impl(plain.path().to_str().unwrap(), "abc", "a.txt")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn git_diff_commit_unknown_oid_errors() {
        let dir = init_test_repo();
        commit_file(&dir, "a.txt", "v1\n", "first");
        let err = git_diff_commit_impl(
            dir.path().to_str().unwrap(),
            "0000000000000000000000000000000000000000",
            "a.txt",
        )
        .unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn git_diff_ref_files_name_status_versus_other_branch() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "hello\n", "init");
        {
            let repo = Repository::open(repo_path).unwrap();
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.branch("other", &head, false).unwrap();
        }
        fs::write(dir.path().join("a.txt"), "world\n").unwrap();
        commit_file(&dir, "b.txt", "new\n", "add b");

        let files = git_diff_ref_files_impl(repo_path, "other").unwrap();
        let a = files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!(a.status, "modified");
        let b = files.iter().find(|f| f.path == "b.txt").unwrap();
        assert_eq!(b.status, "added");
    }

    #[test]
    fn git_diff_file_ref_returns_patch_versus_other_branch() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "hello\n", "init");
        {
            let repo = Repository::open(repo_path).unwrap();
            let head = repo.head().unwrap().peel_to_commit().unwrap();
            repo.branch("other", &head, false).unwrap();
        }
        fs::write(dir.path().join("a.txt"), "world\n").unwrap();

        let patch = git_diff_file_ref_impl(repo_path, "other", "a.txt").unwrap();
        assert!(patch.contains("-hello"), "patch={patch}");
        assert!(patch.contains("+world"), "patch={patch}");
    }

    #[test]
    fn git_diff_ref_unknown_ref_errors() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "hello\n", "init");

        assert!(git_diff_ref_files_impl(repo_path, "does-not-exist").is_err());
        assert!(git_diff_file_ref_impl(repo_path, "does-not-exist", "a.txt").is_err());
    }

    #[test]
    fn git_diff_ref_files_is_empty_for_non_repo() {
        let plain = TempDir::new().unwrap();
        assert!(
            git_diff_ref_files_impl(plain.path().to_str().unwrap(), "main")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn git_blame_groups_consecutive_lines_from_the_same_commit() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "file.txt", "aaa\nbbb\nccc\n", "first");
        commit_file(&dir, "file.txt", "aaa\nBBB\nCCC\n", "second");

        let hunks = git_blame_impl(repo_path, "file.txt").unwrap();
        assert_eq!(hunks.len(), 2, "expected two hunks, got {hunks:?}");

        assert_eq!(hunks[0].start_line, 1);
        assert_eq!(hunks[0].line_count, 1);
        assert_eq!(hunks[0].summary, "first");
        assert_eq!(hunks[0].author, "Test");
        assert!(!hunks[0].oid.is_empty());
        assert!(!hunks[0].timestamp.is_empty());

        assert_eq!(hunks[1].start_line, 2);
        assert_eq!(hunks[1].line_count, 2);
        assert_eq!(hunks[1].summary, "second");
        assert_ne!(hunks[0].oid, hunks[1].oid);
    }

    #[test]
    fn git_blame_is_empty_for_non_repo() {
        let plain = TempDir::new().unwrap();
        fs::write(plain.path().join("file.txt"), "x\n").unwrap();
        assert!(git_blame_impl(plain.path().to_str().unwrap(), "file.txt")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn git_blame_errors_on_missing_and_binary_files() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "file.txt", "hi\n", "init");

        assert!(git_blame_impl(repo_path, "missing.txt").is_err());

        fs::write(dir.path().join("bin.dat"), [0u8, 1, 2, 0, 3]).unwrap();
        assert!(git_blame_impl(repo_path, "bin.dat").is_err());
    }

    #[test]
    fn git_list_branches_is_empty_for_empty_repo() {
        let empty = init_test_repo();
        assert!(git_list_branches_impl(empty.path().to_str().unwrap())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn git_list_branches_marks_none_current_on_detached_head() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        {
            let repo = Repository::open(&path).unwrap();
            let oid = repo.head().unwrap().target().unwrap();
            repo.set_head_detached(oid).unwrap();
        }

        let branches = git_list_branches_impl(&path).unwrap();
        assert!(
            branches.iter().any(|b| b.kind == "local"),
            "detached HEAD still lists the local branch"
        );
        assert!(
            branches.iter().all(|b| !b.is_current),
            "no branch is current when HEAD is detached"
        );
    }

    #[test]
    fn git_blame_errors_in_empty_repo() {
        let empty = init_test_repo();
        fs::write(empty.path().join("file.txt"), "hi\n").unwrap();
        assert!(git_blame_impl(empty.path().to_str().unwrap(), "file.txt").is_err());
    }

    #[test]
    fn git_diff_commit_works_on_detached_head() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        commit_file(&dir, "a.txt", "v1\n", "first");
        commit_file(&dir, "a.txt", "v2\n", "second");
        let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();
        {
            let repo = Repository::open(repo_path).unwrap();
            let oid = git2::Oid::from_str(&log[0].oid).unwrap();
            repo.set_head_detached(oid).unwrap();
        }

        let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
        assert!(patch.contains("-v1"), "patch={patch}");
        assert!(patch.contains("+v2"), "patch={patch}");
    }

    /// `git init` at `path`, creating the directory first — `git_command`
    /// requires it to already exist as a `current_dir`.
    fn init_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        git_command(path).args(["init"]).output().unwrap();
    }

    fn configure_repo_identity(path: &Path) {
        git_command(path)
            .args(["config", "user.email", "test@test.com"])
            .output()
            .unwrap();
        git_command(path)
            .args(["config", "user.name", "Test"])
            .output()
            .unwrap();
    }

    fn commit_all(path: &Path, message: &str) {
        git_command(path).args(["add", "."]).output().unwrap();
        git_command(path)
            .args(["commit", "-m", message])
            .output()
            .unwrap();
    }

    #[test]
    fn root_repo_reports_one_entry_with_empty_relative_path() {
        let dir = TempDir::new().unwrap();
        init_repo(dir.path());

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].kind, "root");
        assert_eq!(repos[0].relative_path, "");
        assert_eq!(repos[0].path, dir.path().to_str().unwrap());
        assert_eq!(
            repos[0].name,
            dir.path().file_name().unwrap().to_str().unwrap()
        );
    }

    #[test]
    fn two_nested_repos_under_a_non_repo_root_are_sorted_and_root_is_absent() {
        let dir = TempDir::new().unwrap();
        init_repo(&dir.path().join("web"));
        init_repo(&dir.path().join("api"));

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
        assert_eq!(relative_paths, vec!["api", "web"]);
        assert!(repos.iter().all(|r| r.kind == "nested"));
    }

    #[test]
    fn a_repo_below_a_root_repo_lists_root_first_then_the_nested_repo() {
        let dir = TempDir::new().unwrap();
        init_repo(dir.path());
        init_repo(&dir.path().join("service"));

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].kind, "root");
        assert_eq!(repos[0].relative_path, "");
        assert_eq!(repos[1].kind, "nested");
        assert_eq!(repos[1].relative_path, "service");
    }

    #[test]
    fn discovery_prunes_node_modules_and_stops_past_the_max_depth() {
        let dir = TempDir::new().unwrap();
        init_repo(&dir.path().join("node_modules/some-package"));
        init_repo(&dir.path().join("a/b/c/service-a")); // depth 4 — included
        init_repo(&dir.path().join("a/b/c/d/service-b")); // depth 5 — excluded

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
        assert_eq!(relative_paths, vec!["a/b/c/service-a"]);
    }

    #[test]
    fn a_dot_git_file_counts_as_a_repo() {
        let dir = TempDir::new().unwrap();
        let checkout = dir.path().join("worktree-checkout");
        fs::create_dir_all(&checkout).unwrap();
        fs::write(checkout.join(".git"), "gitdir: ../actual/.git\n").unwrap();

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].relative_path, "worktree-checkout");
    }

    #[test]
    fn a_declared_submodule_is_kind_submodule_a_plain_checkout_is_kind_nested() {
        let root = TempDir::new().unwrap();
        let source = TempDir::new().unwrap();

        init_repo(source.path());
        configure_repo_identity(source.path());
        fs::write(source.path().join("readme.md"), "hi").unwrap();
        commit_all(source.path(), "init");

        init_repo(root.path());
        configure_repo_identity(root.path());
        fs::write(root.path().join("readme.md"), "hi").unwrap();
        commit_all(root.path(), "init");

        let submodule_add = git_command(root.path())
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source.path().to_str().unwrap(),
                "lib/nested",
            ])
            .output()
            .unwrap();
        assert!(
            submodule_add.status.success(),
            "git submodule add failed: {}",
            String::from_utf8_lossy(&submodule_add.stderr)
        );

        // A plain, unrelated checkout sitting next to the submodule — same
        // depth, same parent, not declared in .gitmodules.
        init_repo(&root.path().join("lib/plain-checkout"));

        let repos = git_discover_repos_impl(root.path()).unwrap();

        let submodule = repos
            .iter()
            .find(|r| r.relative_path == "lib/nested")
            .expect("submodule not discovered");
        assert_eq!(submodule.kind, "submodule");

        let plain = repos
            .iter()
            .find(|r| r.relative_path == "lib/plain-checkout")
            .expect("plain nested checkout not discovered");
        assert_eq!(plain.kind, "nested");
    }

    #[test]
    fn a_missing_or_non_directory_root_is_an_error() {
        let dir = TempDir::new().unwrap();

        let missing = dir.path().join("does-not-exist");
        assert!(git_discover_repos_impl(&missing).is_err());

        let file_root = dir.path().join("just-a-file");
        fs::write(&file_root, "hi").unwrap();
        assert!(git_discover_repos_impl(&file_root).is_err());
    }

    #[test]
    fn a_root_with_no_repos_anywhere_returns_an_empty_ok() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("just-a-folder")).unwrap();

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert!(repos.is_empty());
    }

    #[test]
    fn a_root_directory_named_like_a_pruned_dir_is_still_discovered() {
        // The prune list is about what NOT to descend into below the root —
        // it must never veto the root itself just because a project happens
        // to be checked out into a folder named "target".
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("target");
        init_repo(&root);

        let repos = git_discover_repos_impl(&root).unwrap();

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].kind, "root");
        assert_eq!(repos[0].relative_path, "");
    }

    #[test]
    fn a_repo_inside_a_pruned_directory_below_the_root_is_not_reported() {
        let dir = TempDir::new().unwrap();
        init_repo(&dir.path().join("target/nested-build-artifact"));

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert!(repos.is_empty());
    }

    #[test]
    fn discovery_skips_auric_worktree_sibling_folders() {
        let dir = TempDir::new().unwrap();
        init_repo(dir.path());
        init_repo(&dir.path().join("project.auric-wt/fix-ab12"));

        let repos = git_discover_repos_impl(dir.path()).unwrap();

        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].kind, "root");
    }

    /// `classify_kind` must resolve through the NEAREST enclosing discovered
    /// repo, not any ancestor that happens to declare a matching submodule
    /// path. Two independent trees, one per direction of the bug:
    ///
    /// - `nearest_declares_it`: the nearest repo (`mid`) declares `leaf` as
    ///   its submodule → "submodule".
    /// - `only_a_grandparent_declares_it`: the root declares `mid/leaf` as
    ///   its submodule, but `mid` sits between them as its own discovered
    ///   repo and does NOT declare `leaf` → "nested", because `mid` — not
    ///   the root — is nearest.
    #[test]
    fn classify_kind_resolves_through_the_nearest_enclosing_repo_not_any_ancestor() {
        let source = TempDir::new().unwrap();
        init_repo(source.path());
        configure_repo_identity(source.path());
        fs::write(source.path().join("readme.md"), "hi").unwrap();
        commit_all(source.path(), "init");
        let source_path = source.path().to_str().unwrap();

        // --- nearest repo declares it: "submodule" ---
        let nearest_declares_it = TempDir::new().unwrap();
        let root_a = nearest_declares_it.path().join("root");
        init_repo(&root_a);
        configure_repo_identity(&root_a);
        fs::write(root_a.join("readme.md"), "hi").unwrap();
        commit_all(&root_a, "init");

        let mid_a = root_a.join("mid");
        init_repo(&mid_a);
        configure_repo_identity(&mid_a);
        fs::write(mid_a.join("readme.md"), "hi").unwrap();
        commit_all(&mid_a, "init");
        let add_leaf_to_mid = git_command(&mid_a)
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source_path,
                "leaf",
            ])
            .output()
            .unwrap();
        assert!(
            add_leaf_to_mid.status.success(),
            "git submodule add (mid) failed: {}",
            String::from_utf8_lossy(&add_leaf_to_mid.stderr)
        );

        let repos_a = git_discover_repos_impl(&root_a).unwrap();
        let leaf_a = repos_a
            .iter()
            .find(|r| r.relative_path == "mid/leaf")
            .expect("mid/leaf not discovered");
        assert_eq!(leaf_a.kind, "submodule");

        // --- only a grandparent declares it, an intervening repo does not: "nested" ---
        let only_a_grandparent_declares_it = TempDir::new().unwrap();
        let root_b = only_a_grandparent_declares_it.path().join("root");
        init_repo(&root_b);
        configure_repo_identity(&root_b);
        fs::write(root_b.join("readme.md"), "hi").unwrap();
        commit_all(&root_b, "init");

        let add_leaf_to_root = git_command(&root_b)
            .args([
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source_path,
                "mid/leaf",
            ])
            .output()
            .unwrap();
        assert!(
            add_leaf_to_root.status.success(),
            "git submodule add (root) failed: {}",
            String::from_utf8_lossy(&add_leaf_to_root.stderr)
        );
        // `mid` becomes its own discovered repo too — an ordinary nested
        // checkout that happens to hold the root's submodule as an untracked
        // child. It does not declare `leaf`, so it must win over the root as
        // the nearest enclosing repo.
        init_repo(&root_b.join("mid"));

        let repos_b = git_discover_repos_impl(&root_b).unwrap();
        let leaf_b = repos_b
            .iter()
            .find(|r| r.relative_path == "mid/leaf")
            .expect("mid/leaf not discovered");
        assert_eq!(leaf_b.kind, "nested");
    }

    fn dirty_for(path: &str) -> bool {
        git_projects_dirty_impl(&[path.to_string()])
            .into_iter()
            .find(|row| row.path == path)
            .expect("batch must echo every input path")
            .dirty
    }

    #[test]
    fn git_projects_dirty_is_false_for_a_clean_committed_repo() {
        let dir = TempDir::new().unwrap();
        committed_repo(&dir);
        assert!(!dirty_for(dir.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_is_true_for_an_unstaged_edit() {
        let dir = TempDir::new().unwrap();
        committed_repo(&dir);
        fs::write(dir.path().join("a.txt"), "changed").unwrap();
        assert!(dirty_for(dir.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_is_true_for_a_staged_new_file() {
        let dir = init_test_repo();
        let path = dir.path().to_str().unwrap();
        commit_file(&dir, "kept.txt", "ok\n", "init");
        fs::write(dir.path().join("new.txt"), "hi\n").unwrap();
        git_stage_impl(path, &["new.txt".to_string()]).unwrap();
        assert!(dirty_for(path));
    }

    #[test]
    fn git_projects_dirty_is_true_for_an_untracked_file() {
        let dir = TempDir::new().unwrap();
        committed_repo(&dir);
        fs::write(dir.path().join("scratch.txt"), "wip").unwrap();
        assert!(dirty_for(dir.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_ignores_gitignored_files() {
        let dir = TempDir::new().unwrap();
        committed_repo(&dir);
        fs::write(dir.path().join(".gitignore"), "secret.txt\n").unwrap();
        git_stage_impl(dir.path().to_str().unwrap(), &[".gitignore".to_string()]).unwrap();
        git_commit_impl(dir.path().to_str().unwrap(), "ignore secret").unwrap();
        fs::write(dir.path().join("secret.txt"), "s").unwrap();
        assert!(!dirty_for(dir.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_is_false_when_the_path_is_not_a_repo() {
        let plain = TempDir::new().unwrap();
        assert!(!dirty_for(plain.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_is_false_when_the_path_does_not_exist() {
        assert!(!dirty_for("/definitely/not/a/real/project/path"));
    }

    #[test]
    fn git_projects_dirty_sees_a_dirty_repo_nested_under_the_project() {
        let root = TempDir::new().unwrap();
        let nested = root.path().join("pkg");
        fs::create_dir(&nested).unwrap();
        let repo = Repository::init(&nested).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@example.com").unwrap();
        fs::write(nested.join("a.txt"), "hi").unwrap();
        git_stage_impl(nested.to_str().unwrap(), &["a.txt".to_string()]).unwrap();
        git_commit_impl(nested.to_str().unwrap(), "init").unwrap();
        fs::write(nested.join("a.txt"), "dirty").unwrap();

        assert!(dirty_for(root.path().to_str().unwrap()));
    }

    #[test]
    fn git_projects_dirty_returns_one_row_per_input_in_order() {
        let clean = TempDir::new().unwrap();
        committed_repo(&clean);
        let dirty = TempDir::new().unwrap();
        committed_repo(&dirty);
        fs::write(dirty.path().join("a.txt"), "changed").unwrap();
        let missing = "/no/such/project".to_string();

        let clean_path = clean.path().to_str().unwrap().to_string();
        let dirty_path = dirty.path().to_str().unwrap().to_string();
        let rows =
            git_projects_dirty_impl(&[clean_path.clone(), missing.clone(), dirty_path.clone()]);

        assert_eq!(
            rows,
            vec![
                ProjectDirty {
                    path: clean_path,
                    dirty: false,
                },
                ProjectDirty {
                    path: missing,
                    dirty: false,
                },
                ProjectDirty {
                    path: dirty_path,
                    dirty: true,
                },
            ]
        );
    }

    #[test]
    fn worktree_add_checks_out_a_sibling_auric_branch() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let wt = git_worktree_add_impl(&path, "Fix login!!!").unwrap();

        assert!(wt.is_auric);
        assert!(!wt.dirty);
        assert!(!wt.branch_ahead);
        assert!(wt.path.contains(".auric-wt"));
        assert!(wt
            .branch
            .as_deref()
            .unwrap()
            .starts_with("auric/fix-login-"));
        assert!(Path::new(&wt.path).join("a.txt").is_file());
        assert_eq!(
            fs::canonicalize(&wt.source_repo).unwrap(),
            fs::canonicalize(&path).unwrap()
        );

        let listed = git_worktree_list_impl(&path).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, wt.path);
    }

    #[test]
    fn worktree_list_hides_foreign_worktrees() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let repo = Repository::open(&path).unwrap();
        let foreign = dir.path().join("foreign-wt");
        repo.worktree("foreign", &foreign, None).unwrap();

        assert!(git_worktree_list_impl(&path).unwrap().is_empty());
    }

    #[test]
    fn worktree_remove_refuses_a_dirty_checkout_until_forced() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let wt = git_worktree_add_impl(&path, "edit").unwrap();
        fs::write(Path::new(&wt.path).join("a.txt"), "dirty").unwrap();

        let err = git_worktree_remove_impl(&path, &wt.path, false).unwrap_err();
        assert!(err.contains("uncommitted"), "{err}");
        assert!(Path::new(&wt.path).exists());

        git_worktree_remove_impl(&path, &wt.path, true).unwrap();
        assert!(!Path::new(&wt.path).exists());
        assert!(git_worktree_list_impl(&path).unwrap().is_empty());
    }

    #[test]
    fn worktree_remove_rejects_a_path_we_did_not_create() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let err = git_worktree_remove_impl(&path, &path, true).unwrap_err();
        assert!(err.contains("Auric-managed"), "{err}");
    }

    #[test]
    fn worktree_add_needs_a_commit() {
        let dir = TempDir::new().unwrap();
        Repository::init(dir.path()).unwrap();
        let err = git_worktree_add_impl(dir.path().to_str().unwrap(), "x").unwrap_err();
        assert!(err.contains("HEAD"), "{err}");
    }

    #[test]
    fn primary_project_path_resolves_a_worktree_to_the_main_checkout() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let wt = git_worktree_add_impl(&path, "policy").unwrap();
        let resolved = primary_project_path(Path::new(&wt.path)).unwrap();
        assert_eq!(
            fs::canonicalize(&resolved).unwrap(),
            fs::canonicalize(&path).unwrap()
        );
    }

    fn rename_head_branch(path: &str, new_name: &str) {
        let repo = Repository::open(path).unwrap();
        let current = repo.head().unwrap().shorthand().unwrap().to_string();
        if current == new_name {
            return;
        }
        {
            let mut branch = repo.find_branch(&current, BranchType::Local).unwrap();
            branch.rename(new_name, true).unwrap();
        }
        repo.set_head(&format!("refs/heads/{new_name}")).unwrap();
    }

    fn delete_local_branch(path: &str, name: &str) {
        let repo = Repository::open(path).unwrap();
        if let Ok(mut b) = repo.find_branch(name, BranchType::Local) {
            b.delete().unwrap();
        };
    }

    fn force_default_branch(path: &str, name: &str) {
        rename_head_branch(path, name);
        for other in ["main", "master"] {
            if other != name {
                delete_local_branch(path, other);
            }
        }
    }

    fn commit_in(repo_path: &str, file: &str, contents: &str, message: &str) {
        fs::write(Path::new(repo_path).join(file), contents).unwrap();
        git_stage_impl(repo_path, &[file.to_string()]).unwrap();
        git_commit_impl(repo_path, message).unwrap();
    }

    #[test]
    fn default_branch_is_main_or_master_from_the_repo() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        assert_eq!(git_default_branch_impl(&path).unwrap(), "main");

        force_default_branch(&path, "master");
        assert_eq!(git_default_branch_impl(&path).unwrap(), "master");
    }

    #[test]
    fn default_branch_prefers_main_when_both_exist() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        let repo = Repository::open(&path).unwrap();
        let commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("master", &commit, false).unwrap();
        assert_eq!(git_default_branch_impl(&path).unwrap(), "main");
    }

    #[test]
    fn worktree_merge_fast_forwards_main_and_removes_the_checkout() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        let wt = git_worktree_add_impl(&path, "feat").unwrap();
        commit_in(&wt.path, "b.txt", "from agent", "agent work");

        let result = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap();
        assert_eq!(result.default_branch, "main");
        assert!(result.merged);
        assert!(result.fast_forward);
        assert!(result.cleaned_up);
        assert!(!Path::new(&wt.path).exists());
        assert_eq!(
            fs::read_to_string(Path::new(&path).join("b.txt")).unwrap(),
            "from agent"
        );
        assert!(git_worktree_list_impl(&path).unwrap().is_empty());
    }

    #[test]
    fn worktree_merge_commits_dirty_files_first() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "master");
        let wt = git_worktree_add_impl(&path, "dirty").unwrap();
        fs::write(Path::new(&wt.path).join("c.txt"), "leftover").unwrap();

        let result =
            git_worktree_merge_into_default_impl(&path, &wt.path, Some("Agent work: Writer"))
                .unwrap();
        assert_eq!(result.default_branch, "master");
        assert!(result.merged);
        assert!(result.cleaned_up);
        assert_eq!(
            fs::read_to_string(Path::new(&path).join("c.txt")).unwrap(),
            "leftover"
        );
    }

    #[test]
    fn worktree_merge_refuses_a_conflict_and_keeps_the_worktree() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        let wt = git_worktree_add_impl(&path, "clash").unwrap();
        commit_in(&path, "a.txt", "on main", "main edit");
        commit_in(&wt.path, "a.txt", "on worktree", "wt edit");

        let err = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap_err();
        assert!(err.contains("conflict"), "{err}");
        assert!(Path::new(&wt.path).exists());
    }

    #[test]
    fn worktree_merge_rejects_a_path_we_did_not_create() {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        let err = git_worktree_merge_into_default_impl(&path, &path, None).unwrap_err();
        assert!(err.contains("Auric-managed"), "{err}");
    }
}
