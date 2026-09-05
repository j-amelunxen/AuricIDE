use super::discovery::primary_project_path;
use super::staging::{git_commit_impl, git_stage_impl};
use super::status::{git_status_impl, repo_is_dirty};
use super::types::*;
use git2::{
    build::CheckoutBuilder, BranchType, Repository, WorktreeAddOptions, WorktreePruneOptions,
};
use std::fs;
use std::path::{Path, PathBuf};

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
