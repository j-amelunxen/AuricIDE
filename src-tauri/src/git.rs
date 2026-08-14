use git2::{Repository, StatusOptions};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

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

#[tauri::command]
pub fn git_status(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    git_status_impl(repo_path)
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
    fn git_command(dir: &std::path::Path) -> StdCommand {
        let mut command = StdCommand::new("git");
        command
            .current_dir(dir)
            .env_remove("GIT_DIR")
            .env_remove("GIT_INDEX_FILE")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_OBJECT_DIRECTORY")
            .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES");
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
}
