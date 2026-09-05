use super::types::*;
use git2::Repository;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

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

    let ignored = crate::ignored_repos::ignored_repos_for_project(root_path);

    let repo_dirs: Vec<PathBuf> = WalkDir::new(root_path)
        .max_depth(GIT_DISCOVERY_MAX_DEPTH)
        .into_iter()
        // Depth 0 is the root itself, chosen by the caller — a project
        // legitimately checked out into a folder named `target` or `dist`
        // must still be discovered even though that name is pruned below it.
        // Ignored relative paths are skipped the same way: we do not walk
        // into a folder the project asked us not to treat as a repo.
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if crate::skip_recent_walk_dir(e) {
                return false;
            }
            if e.file_type().is_dir() {
                let relative = relative_to_root(root_path, e.path());
                if crate::ignored_repos::is_ignored_repo_path(&relative, &ignored) {
                    return false;
                }
            }
            true
        })
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
