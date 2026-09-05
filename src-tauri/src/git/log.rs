use super::types::*;
use git2::Repository;
use std::cmp::Ordering;

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
