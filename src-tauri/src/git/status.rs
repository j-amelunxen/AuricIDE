use super::discovery::git_discover_repos_impl;
use super::types::*;
use git2::{Repository, StatusOptions};
use std::path::Path;

pub fn git_status_impl(repo_path: &str) -> Result<Vec<GitFileStatus>, String> {
    let repo = match Repository::open(repo_path) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()), // Return empty if not a git repo
    };
    let ignored = crate::ignored_repos::ignored_repos_for_project(Path::new(repo_path));
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

        if status.is_ignored() || crate::ignored_repos::is_ignored_repo_path(&path, &ignored) {
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

pub(crate) fn project_is_dirty(root: &Path) -> bool {
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
pub(crate) fn repo_is_dirty(repo_path: &Path) -> bool {
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
    let ignored = crate::ignored_repos::ignored_repos_for_project(repo_path);
    statuses.iter().any(|entry| {
        let path = entry.path().unwrap_or("");
        if crate::ignored_repos::is_ignored_repo_path(path, &ignored) {
            return false;
        }
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
