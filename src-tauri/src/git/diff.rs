use super::types::*;
use git2::{Repository, StatusOptions};
use std::fs;
use std::path::Path;

pub(crate) fn print_diff(diff: &git2::Diff) -> Result<String, String> {
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

pub(crate) fn synthetic_added_patch(file_path: &str, content: &str) -> String {
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

pub(crate) fn synthetic_deleted_patch(file_path: &str, content: &str) -> String {
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

pub(crate) fn blob_text_at(
    repo: &Repository,
    tree: &git2::Tree,
    file_path: &str,
) -> Option<String> {
    let entry = tree.get_path(Path::new(file_path)).ok()?;
    let obj = entry.to_object(repo).ok()?;
    obj.as_blob()
        .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
}

pub(crate) fn blob_text_in_index(repo: &Repository, file_path: &str) -> Option<String> {
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
