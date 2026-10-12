//! The merge panel's backend: what the repository is merging, each conflict's
//! three sides as git sees them, and the few writes a resolution needs.
//! Contract and reasoning: `docs/design-merge-panel.md`.
//!
//! Nothing here runs its own three-way merge. The markered text comes from
//! libgit2's file merge (via a checkout of the conflicted index entry into a
//! scratch folder, the one route git2 0.19 exposes), so what the panel shows is
//! what `git checkout --conflict=diff3` would write.

use super::types::*;
use git2::{
    build::CheckoutBuilder, ApplyLocation, BlameOptions, Diff, Index, IndexConflict, IndexEntry,
    MergeOptions, Oid, Repository, RepositoryState, StatusOptions,
};
use std::collections::{hash_map::Entry, HashMap};
use std::fs;
use std::path::{Component, Path};

const SHORT_OID_LEN: usize = 7;
const BASE_LABEL: &str = "base";

fn open(repo_path: &str) -> Result<Repository, String> {
    Repository::open(repo_path).map_err(|e| format!("not a git repository: {e}"))
}

fn short_oid(oid: Oid) -> String {
    oid.to_string()[..SHORT_OID_LEN].to_string()
}

/// What the repository is in the middle of. Bisect is not an operation that
/// ends in a commit, so it reads as "none" like a clean repository.
pub(crate) fn operation_name(state: RepositoryState) -> &'static str {
    match state {
        RepositoryState::Clean | RepositoryState::Bisect => "none",
        RepositoryState::Merge => "merge",
        RepositoryState::Rebase
        | RepositoryState::RebaseInteractive
        | RepositoryState::RebaseMerge
        | RepositoryState::ApplyMailboxOrRebase => "rebase",
        RepositoryState::CherryPick | RepositoryState::CherryPickSequence => "cherry-pick",
        RepositoryState::Revert | RepositoryState::RevertSequence => "revert",
        _ => "other",
    }
}

/// HEAD's branch, a short oid when detached, None when unborn.
fn ours_label(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if repo.head_detached().unwrap_or(false) {
        return head.target().map(short_oid);
    }
    head.shorthand().map(str::to_string)
}

/// The branch git named on the first line of `MERGE_MSG`: `Merge branch 'x'`,
/// `Merge branch 'x' into y`, `Merge remote-tracking branch 'origin/x'`.
pub fn branch_from_merge_msg(msg: &str) -> Option<String> {
    let first = msg.lines().next()?;
    let rest = first
        .strip_prefix("Merge branch '")
        .or_else(|| first.strip_prefix("Merge remote-tracking branch '"))?;
    let end = rest.find('\'')?;
    let name = &rest[..end];
    (!name.is_empty()).then(|| name.to_string())
}

fn merge_heads(repo: &mut Repository) -> Vec<Oid> {
    let mut heads = Vec::new();
    let _ = repo.mergehead_foreach(|oid| {
        heads.push(*oid);
        true
    });
    heads
}

fn read_merge_msg(repo: &Repository) -> Option<String> {
    fs::read_to_string(repo.path().join("MERGE_MSG")).ok()
}

/// `MERGE_MSG` without git's `#` comment lines, trimmed. None when empty.
fn clean_merge_msg(raw: &str) -> Option<String> {
    let kept: Vec<&str> = raw.lines().filter(|l| !l.starts_with('#')).collect();
    let text = kept.join("\n").trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn theirs_label(raw_msg: Option<&str>, theirs: Option<Oid>) -> Option<String> {
    raw_msg
        .and_then(branch_from_merge_msg)
        .or_else(|| theirs.map(short_oid))
}

fn entry_path(entry: &IndexEntry) -> String {
    String::from_utf8_lossy(&entry.path).into_owned()
}

fn conflict_path(conflict: &IndexConflict) -> Option<String> {
    conflict
        .our
        .as_ref()
        .or(conflict.their.as_ref())
        .or(conflict.ancestor.as_ref())
        .map(entry_path)
}

/// The text of one stage, or None when the stage is absent. `Err(())` marks a
/// side that is not text (NUL byte or not UTF-8).
fn stage_text(repo: &Repository, entry: Option<&IndexEntry>) -> Result<Option<String>, ()> {
    let Some(entry) = entry else {
        return Ok(None);
    };
    let blob = repo.find_blob(entry.id).map_err(|_| ())?;
    if blob.content().contains(&0) {
        return Err(());
    }
    String::from_utf8(blob.content().to_vec())
        .map(Some)
        .map_err(|_| ())
}

struct Sides {
    kind: &'static str,
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
}

const MODE_SYMLINK: u32 = 0o120000;
const MODE_EXECUTABLE: u32 = 0o100755;

/// Any stage is a link. Its "content" is a target path, never text to merge,
/// so it resolves only by taking a side whole.
fn is_symlink_conflict(conflict: &IndexConflict) -> bool {
    [&conflict.ancestor, &conflict.our, &conflict.their]
        .into_iter()
        .flatten()
        .any(|entry| entry.mode == MODE_SYMLINK)
}

/// Refuses a work-tree path that runs through a symbolic link inside the
/// repository: writing there would land wherever the link points. With
/// `include_leaf`, the file itself must not be a link either.
fn refuse_symlinks_on_path(
    workdir: &Path,
    relative: &Path,
    file_path: &str,
    include_leaf: bool,
) -> Result<(), String> {
    let components: Vec<Component> = relative.components().collect();
    let checked = if include_leaf {
        components.len()
    } else {
        components.len().saturating_sub(1)
    };
    let mut prefix = workdir.to_path_buf();
    for (i, component) in components.iter().take(checked).enumerate() {
        prefix.push(component);
        let is_link = fs::symlink_metadata(&prefix).is_ok_and(|m| m.file_type().is_symlink());
        if !is_link {
            continue;
        }
        return Err(if i + 1 == components.len() {
            format!("{file_path} is a symbolic link; resolve it by picking a side")
        } else {
            format!("{file_path} lies behind a symbolic link; resolve it in a terminal")
        });
    }
    Ok(())
}

fn read_sides(repo: &Repository, conflict: &IndexConflict) -> Sides {
    let texts = (
        stage_text(repo, conflict.ancestor.as_ref()),
        stage_text(repo, conflict.our.as_ref()),
        stage_text(repo, conflict.their.as_ref()),
    );
    let kind = if is_symlink_conflict(conflict) {
        "symlink"
    } else if conflict.our.is_none() {
        "deleted-by-us"
    } else if conflict.their.is_none() {
        "deleted-by-them"
    } else if texts.0.is_err() || texts.1.is_err() || texts.2.is_err() {
        "binary"
    } else if conflict.ancestor.is_none() {
        "both-added"
    } else {
        "content"
    };
    Sides {
        kind,
        base: texts.0.ok().flatten(),
        ours: texts.1.ok().flatten(),
        theirs: texts.2.ok().flatten(),
    }
}

fn index_conflicts(index: &Index) -> Result<Vec<IndexConflict>, String> {
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let conflicts = index
        .conflicts()
        .map_err(|e| format!("could not read the index conflicts: {e}"))?;
    conflicts
        .map(|c| c.map_err(|e| format!("could not read a conflict: {e}")))
        .collect()
}

fn fresh_index(repo: &Repository) -> Result<Index, String> {
    let mut index = repo
        .index()
        .map_err(|e| format!("could not open the index: {e}"))?;
    index
        .read(true)
        .map_err(|e| format!("could not read the index: {e}"))?;
    Ok(index)
}

fn conflict_entries(repo: &Repository, index: &Index) -> Result<Vec<GitConflictEntry>, String> {
    let mut entries: Vec<GitConflictEntry> = index_conflicts(index)?
        .iter()
        .filter_map(|c| {
            Some(GitConflictEntry {
                path: conflict_path(c)?,
                kind: read_sides(repo, c).kind.to_string(),
            })
        })
        .collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

pub fn git_merge_state_impl(repo_path: &str) -> Result<GitMergeState, String> {
    let Ok(mut repo) = Repository::open(repo_path) else {
        return Ok(GitMergeState {
            in_progress: false,
            operation: "none".to_string(),
            ours_label: None,
            theirs_label: None,
            theirs_oid: None,
            message: None,
            conflicts: Vec::new(),
            step: None,
            head_oid: None,
            applying_oid: None,
        });
    };
    let state = repo.state();
    let theirs = merge_heads(&mut repo).first().copied();
    let raw_msg = read_merge_msg(&repo);
    let index = fresh_index(&repo)?;
    Ok(GitMergeState {
        in_progress: operation_name(state) != "none",
        operation: operation_name(state).to_string(),
        ours_label: ours_label(&repo),
        theirs_label: theirs_label(raw_msg.as_deref(), theirs),
        theirs_oid: theirs.map(|o| o.to_string()),
        message: raw_msg.as_deref().and_then(clean_merge_msg),
        conflicts: conflict_entries(&repo, &index)?,
        step: super::operation_step::rebase_step(&repo),
        head_oid: repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|o| o.to_string()),
        applying_oid: super::operation_step::applying_oid(&repo),
    })
}

/// Every conflicted path in the index, sorted.
pub(crate) fn conflicted_paths(repo: &Repository) -> Result<Vec<String>, String> {
    let index = fresh_index(repo)?;
    let mut paths: Vec<String> = index_conflicts(&index)?
        .iter()
        .filter_map(conflict_path)
        .collect();
    paths.sort();
    Ok(paths)
}

/// A repo-relative path that cannot leave the work tree or reach into `.git`.
fn checked_relative_path(file_path: &str) -> Result<&Path, String> {
    let path = Path::new(file_path);
    let mut parts = 0;
    for component in path.components() {
        match component {
            Component::Normal(part) if parts == 0 && part == ".git" => {
                return Err(format!("{file_path} is inside .git"));
            }
            Component::Normal(_) => parts += 1,
            Component::CurDir => {}
            _ => return Err(format!("{file_path} is not a path inside the repository")),
        }
    }
    if parts == 0 {
        return Err("no file path given".to_string());
    }
    Ok(path)
}

fn find_conflict(index: &Index, file_path: &str) -> Result<IndexConflict, String> {
    index_conflicts(index)?
        .into_iter()
        .find(|c| conflict_path(c).as_deref() == Some(file_path))
        .ok_or_else(|| format!("{file_path} has no conflict to resolve"))
}

/// libgit2's diff3 merge of one conflicted entry, written into a scratch
/// folder by a checkout that leaves the real work tree and index alone.
fn merged_text(
    repo: &Repository,
    index: &mut Index,
    file_path: &str,
    ours: &str,
    theirs: &str,
) -> Result<String, String> {
    let scratch =
        tempfile::tempdir().map_err(|e| format!("could not create a scratch folder: {e}"))?;
    let mut checkout = CheckoutBuilder::new();
    checkout
        .target_dir(scratch.path())
        .path(file_path)
        .force()
        .allow_conflicts(true)
        .update_index(false)
        .conflict_style_diff3(true)
        .ancestor_label(BASE_LABEL)
        .our_label(ours)
        .their_label(theirs);
    repo.checkout_index(Some(index), Some(&mut checkout))
        .map_err(|e| format!("could not merge {file_path}: {e}"))?;
    let merged = scratch.path().join(file_path);
    refuse_symlinks_on_path(scratch.path(), Path::new(file_path), file_path, true)?;
    fs::read_to_string(merged).map_err(|e| format!("could not read the merged {file_path}: {e}"))
}

pub fn git_conflict_file_impl(repo_path: &str, file_path: &str) -> Result<GitConflictFile, String> {
    checked_relative_path(file_path)?;
    let mut repo = open(repo_path)?;
    let mut index = fresh_index(&repo)?;
    let conflict = find_conflict(&index, file_path)?;
    let sides = read_sides(&repo, &conflict);
    let theirs_oid = merge_heads(&mut repo).first().copied();
    let ours_label = ours_label(&repo).unwrap_or_else(|| "HEAD".to_string());
    let theirs_label = theirs_label(read_merge_msg(&repo).as_deref(), theirs_oid)
        .unwrap_or_else(|| "incoming".to_string());
    let merged = match sides.kind {
        "content" | "both-added" => Some(merged_text(
            &repo,
            &mut index,
            file_path,
            &ours_label,
            &theirs_label,
        )?),
        _ => None,
    };
    Ok(GitConflictFile {
        path: file_path.to_string(),
        kind: sides.kind.to_string(),
        base: sides.base,
        ours: sides.ours,
        theirs: sides.theirs,
        merged,
        ours_label,
        theirs_label,
    })
}

/// Writes the resolution (or deletes the file for `None`) and stages it, which
/// clears the conflict stages. Nothing else: no commit.
pub fn git_resolve_conflict_impl(
    repo_path: &str,
    file_path: &str,
    content: Option<&str>,
) -> Result<(), String> {
    let relative = checked_relative_path(file_path)?;
    let repo = open(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "cannot resolve in a bare repository".to_string())?
        .to_path_buf();
    let mut index = fresh_index(&repo)?;
    if is_symlink_conflict(&find_conflict(&index, file_path)?) {
        return Err(format!(
            "{file_path} is a symbolic link; resolve it by picking a side"
        ));
    }
    refuse_symlinks_on_path(&workdir, relative, file_path, true)?;
    write_resolution(&workdir.join(relative), file_path, content)?;
    // remove_path drops every stage of the path, conflict stages included.
    index
        .remove_path(relative)
        .map_err(|e| format!("could not clear the conflict on {file_path}: {e}"))?;
    if content.is_some() {
        index
            .add_path(relative)
            .map_err(|e| format!("could not stage {file_path}: {e}"))?;
    }
    index
        .write()
        .map_err(|e| format!("could not write the index: {e}"))
}

fn write_resolution(full: &Path, file_path: &str, content: Option<&str>) -> Result<(), String> {
    match content {
        Some(text) => {
            if let Some(parent) = full.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("could not create the folder for {file_path}: {e}"))?;
            }
            fs::write(full, text).map_err(|e| format!("could not write {file_path}: {e}"))
        }
        None if fs::symlink_metadata(full).is_ok() => {
            fs::remove_file(full).map_err(|e| format!("could not delete {file_path}: {e}"))
        }
        None => Ok(()),
    }
}

fn require_merge(repo: &Repository) -> Result<(), String> {
    if repo.state() == RepositoryState::Merge {
        Ok(())
    } else {
        Err("no merge in progress".to_string())
    }
}

/// Paths whose index entry is not HEAD's: the paths the merge touched.
fn paths_touched_by_merge(
    repo: &Repository,
    head_tree: Option<&git2::Tree>,
    index: &Index,
) -> Result<Vec<String>, String> {
    let mut paths: Vec<String> = index_conflicts(index)?
        .iter()
        .filter_map(conflict_path)
        .collect();
    let diff = repo
        .diff_tree_to_index(head_tree, Some(index), None)
        .map_err(|e| format!("could not compare the index with HEAD: {e}"))?;
    for delta in diff.deltas() {
        for file in [delta.old_file(), delta.new_file()] {
            if let Some(path) = file.path() {
                paths.push(path.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// `git reset --merge`: the paths the merge touched go back to HEAD, in the
/// index and the work tree; every other edit in the work tree is left alone.
pub fn git_merge_abort_impl(repo_path: &str) -> Result<(), String> {
    let repo = open(repo_path)?;
    require_merge(&repo)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "cannot abort in a bare repository".to_string())?
        .to_path_buf();
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let mut index = fresh_index(&repo)?;
    let touched = paths_touched_by_merge(&repo, head_tree.as_ref(), &index)?;
    refuse_edits_after_resolution(&repo, &index, &touched)?;

    match &head_tree {
        Some(tree) => index.read_tree(tree),
        None => index.clear(),
    }
    .and_then(|_| index.write())
    .map_err(|e| format!("could not reset the index: {e}"))?;
    restore_from_head(&repo, &workdir, head_tree.as_ref(), &touched)?;
    repo.cleanup_state()
        .map_err(|e| format!("could not clear the merge state: {e}"))
}

/// `git merge --abort` refuses when a path the merge settled has since been
/// edited in the work tree: putting HEAD back would throw that edit away.
/// Conflicted paths are exempt — their work-tree text is the merge's own.
fn refuse_edits_after_resolution(
    repo: &Repository,
    index: &Index,
    touched: &[String],
) -> Result<(), String> {
    let conflicted: Vec<String> = index_conflicts(index)?
        .iter()
        .filter_map(conflict_path)
        .collect();
    let edited = git2::Status::WT_MODIFIED
        | git2::Status::WT_DELETED
        | git2::Status::WT_TYPECHANGE
        | git2::Status::WT_RENAMED;
    for path in touched.iter().filter(|p| !conflicted.contains(p)) {
        // A path status cannot answer (a folder) holds no edit to lose.
        let status = repo
            .status_file(Path::new(path))
            .unwrap_or(git2::Status::CURRENT);
        if status.intersects(edited) {
            return Err(format!(
                "{path} has changes made after it was resolved; commit or undo them first"
            ));
        }
    }
    Ok(())
}

/// Puts HEAD's version of each path back in the work tree and removes the
/// ones HEAD does not have. Expects the index to match HEAD already.
fn restore_from_head(
    repo: &Repository,
    workdir: &Path,
    head_tree: Option<&git2::Tree>,
    paths: &[String],
) -> Result<(), String> {
    let (restore, remove): (Vec<&String>, Vec<&String>) = paths
        .iter()
        .partition(|p| head_tree.is_some_and(|t| t.get_path(Path::new(p.as_str())).is_ok()));
    for path in remove {
        let full = workdir.join(path);
        if full.is_file() || full.is_symlink() {
            fs::remove_file(&full).map_err(|e| format!("could not remove {path}: {e}"))?;
        }
    }
    // An empty path list would mean "every path" to a checkout.
    if restore.is_empty() {
        return Ok(());
    }
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    for path in restore {
        checkout.path(path.as_str());
    }
    repo.checkout_head(Some(&mut checkout))
        .map_err(|e| format!("could not restore the merged files: {e}"))
}

fn signature(repo: &Repository) -> Result<git2::Signature<'static>, String> {
    repo.signature().map_err(|e| {
        format!(
            "Failed to get git signature: {}. Please configure git user.name and user.email.",
            e
        )
    })
}

/// Commits the index with HEAD and every MERGE_HEAD as parents.
pub fn git_merge_conclude_impl(repo_path: &str, message: &str) -> Result<String, String> {
    let mut repo = open(repo_path)?;
    require_merge(&repo)?;
    let heads = merge_heads(&mut repo);
    if heads.is_empty() {
        return Err("no merge in progress".to_string());
    }
    let mut index = fresh_index(&repo)?;
    let left = index_conflicts(&index)?.len();
    if left > 0 {
        let noun = if left == 1 { "conflict" } else { "conflicts" };
        return Err(format!("{left} {noun} left to resolve"));
    }
    let message = conclude_message(&repo, message)?;
    let tree = index
        .write_tree()
        .and_then(|oid| repo.find_tree(oid))
        .map_err(|e| format!("could not write the merge tree: {e}"))?;
    let parents = merge_parents(&repo, &heads)?;
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    let sig = signature(&repo)?;
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
        .map_err(|e| format!("could not create the merge commit: {e}"))?;
    repo.cleanup_state()
        .map_err(|e| format!("could not clear the merge state: {e}"))?;
    Ok(oid.to_string())
}

/// The caller's message, else git's prepared `MERGE_MSG`.
fn conclude_message(repo: &Repository, message: &str) -> Result<String, String> {
    if !message.trim().is_empty() {
        return Ok(message.to_string());
    }
    read_merge_msg(repo)
        .as_deref()
        .and_then(clean_merge_msg)
        .ok_or_else(|| "a merge commit needs a message".to_string())
}

/// HEAD first, then every MERGE_HEAD: the order `git commit` uses.
fn merge_parents<'r>(repo: &'r Repository, heads: &[Oid]) -> Result<Vec<git2::Commit<'r>>, String> {
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|e| format!("HEAD is not a commit: {e}"))?;
    let mut parents = vec![head];
    for oid in heads {
        let commit = repo
            .find_commit(*oid)
            .map_err(|e| format!("could not read {oid}: {e}"))?;
        parents.push(commit);
    }
    Ok(parents)
}

/// Staged or unstaged changes to tracked files. Untracked files do not count —
/// `git merge` only refuses when it would overwrite one, and so does checkout.
fn has_tracked_changes(repo: &Repository) -> Result<bool, String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("could not read the status: {e}"))?;
    Ok(statuses
        .iter()
        .any(|s| s.status() != git2::Status::CURRENT && !s.status().is_ignored()))
}

/// Starts `git merge <reference>` in the work tree: MERGE_HEAD and MERGE_MSG
/// written, diff3 markers on disk. Returns the conflicted paths (empty when
/// the merge went through cleanly and only waits for its commit).
pub(crate) fn start_merge(
    repo: &Repository,
    reference: &git2::Reference,
) -> Result<Vec<String>, String> {
    let annotated = repo
        .reference_to_annotated_commit(reference)
        .map_err(|e| format!("could not read the branch to merge: {e}"))?;
    let theirs = reference.shorthand().unwrap_or("incoming").to_string();
    let ours = ours_label(repo).unwrap_or_else(|| "HEAD".to_string());
    let mut checkout = CheckoutBuilder::new();
    checkout
        .conflict_style_diff3(true)
        .ancestor_label(BASE_LABEL)
        .our_label(&ours)
        .their_label(&theirs);
    repo.merge(
        &[&annotated],
        Some(&mut MergeOptions::new()),
        Some(&mut checkout),
    )
    .map_err(|e| format!("could not merge {theirs}: {e}"))?;
    conflicted_paths(repo)
}

fn find_branch_reference<'r>(
    repo: &'r Repository,
    branch: &str,
) -> Result<git2::Reference<'r>, String> {
    repo.find_branch(branch, git2::BranchType::Local)
        .or_else(|_| repo.find_branch(branch, git2::BranchType::Remote))
        .map(|b| b.into_reference())
        .map_err(|_| format!("branch {branch} not found"))
}

fn merge_start(outcome: &str, oid: Option<Oid>, conflicts: Vec<String>) -> GitMergeStartResult {
    GitMergeStartResult {
        outcome: outcome.to_string(),
        oid: oid.map(|o| o.to_string()),
        conflicts,
    }
}

/// `git merge <branch>`: nothing when up to date, a fast-forward when
/// possible, a merge commit when clean, otherwise a merge left in progress.
// code-gate: complexity-cyclomatic - the four `git merge` outcomes after a linear chain of refusals; each `?` is one refusal
pub fn git_merge_branch_impl(repo_path: &str, branch: &str) -> Result<GitMergeStartResult, String> {
    let repo = open(repo_path)?;
    if repo.state() != RepositoryState::Clean {
        return Err(format!(
            "a {} is already in progress — finish or abort it first",
            operation_name(repo.state())
        ));
    }
    let reference = find_branch_reference(&repo, branch)?;
    if has_tracked_changes(&repo)? {
        return Err("uncommitted changes — commit or stash them before merging".to_string());
    }
    let head_ref = repo
        .head()
        .map_err(|_| "the repository has no commit to merge into".to_string())?;
    let head = head_ref
        .peel_to_commit()
        .map_err(|e| format!("HEAD is not a commit: {e}"))?;
    let theirs = reference
        .peel_to_commit()
        .map_err(|e| format!("branch {branch} is not a commit: {e}"))?;
    let contains = |a: Oid, b: Oid| a == b || repo.graph_descendant_of(a, b).unwrap_or(false);

    if contains(head.id(), theirs.id()) {
        return Ok(merge_start("up-to-date", None, Vec::new()));
    }
    if contains(theirs.id(), head.id()) {
        fast_forward_head(&repo, &head_ref, &theirs, branch)?;
        return Ok(merge_start("fast-forward", Some(theirs.id()), Vec::new()));
    }
    let conflicts = start_merge(&repo, &reference)?;
    if !conflicts.is_empty() {
        return Ok(merge_start("conflicts", None, conflicts));
    }
    let into = ours_label(&repo).unwrap_or_else(|| "HEAD".to_string());
    let oid = git_merge_conclude_impl(repo_path, &format!("Merge branch '{branch}' into {into}"))?;
    Ok(GitMergeStartResult {
        outcome: "merged".to_string(),
        oid: Some(oid),
        conflicts: Vec::new(),
    })
}

/// What `git merge <branch>` would do, without doing it: the merge is built
/// in memory from the two commits, so neither the index nor the work tree
/// changes. Local edits are not considered — `git_merge_branch` refuses those.
pub fn git_merge_preview_impl(repo_path: &str, branch: &str) -> Result<GitMergePreview, String> {
    let repo = open(repo_path)?;
    let reference = find_branch_reference(&repo, branch)?;
    let head = repo
        .head()
        .and_then(|h| h.peel_to_commit())
        .map_err(|_| "the repository has no commit to merge into".to_string())?;
    let theirs = reference
        .peel_to_commit()
        .map_err(|e| format!("branch {branch} is not a commit: {e}"))?;
    let commits = commits_ahead(&repo, theirs.id(), head.id())?;
    let preview = |outcome: &str, conflicts: Vec<String>| GitMergePreview {
        outcome: outcome.to_string(),
        conflicts,
        commits,
    };
    if commits == 0 {
        return Ok(preview("up-to-date", Vec::new()));
    }
    if repo
        .graph_descendant_of(theirs.id(), head.id())
        .unwrap_or(false)
    {
        return Ok(preview("fast-forward", Vec::new()));
    }
    let index = repo
        .merge_commits(&head, &theirs, Some(&MergeOptions::new()))
        .map_err(|e| format!("could not preview the merge of {branch}: {e}"))?;
    let mut conflicts: Vec<String> = index_conflicts(&index)?
        .iter()
        .filter_map(conflict_path)
        .collect();
    conflicts.sort();
    Ok(if conflicts.is_empty() {
        preview("clean", conflicts)
    } else {
        preview("conflicts", conflicts)
    })
}

/// Commits reachable from `tip` but not from `base`.
fn commits_ahead(repo: &Repository, tip: Oid, base: Oid) -> Result<u32, String> {
    let mut walk = repo
        .revwalk()
        .map_err(|e| format!("could not walk the history: {e}"))?;
    walk.push(tip)
        .and_then(|_| walk.hide(base))
        .map_err(|e| format!("could not walk the history: {e}"))?;
    Ok(walk.filter(Result::is_ok).count() as u32)
}

/// Checks out `theirs` (refusing to overwrite local work) and moves the branch
/// HEAD points at, so HEAD stays attached.
fn fast_forward_head(
    repo: &Repository,
    head_ref: &git2::Reference,
    theirs: &git2::Commit,
    branch: &str,
) -> Result<(), String> {
    let tree = theirs
        .tree()
        .map_err(|e| format!("could not read {branch}: {e}"))?;
    repo.checkout_tree(tree.as_object(), Some(CheckoutBuilder::new().safe()))
        .map_err(|e| format!("could not update the working tree: {e}"))?;
    head_ref
        .resolve()
        .and_then(|mut target| {
            target.set_target(theirs.id(), &format!("merge {branch}: Fast-forward"))
        })
        .map(|_| ())
        .map_err(|e| format!("could not fast-forward: {e}"))
}

fn patch_paths(diff: &Diff) -> String {
    let mut paths: Vec<String> = diff
        .deltas()
        .filter_map(|d| d.new_file().path().or_else(|| d.old_file().path()))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    paths.dedup();
    if paths.is_empty() {
        "the patch".to_string()
    } else {
        paths.join(", ")
    }
}

/// Refuses when the diff the viewer showed is no longer what `git_diff`
/// returns for that side: the hunk was cut from something that moved on.
fn check_guard(repo_path: &str, guard: &ApplyPatchGuard) -> Result<(), String> {
    let side = match guard.side.as_str() {
        side @ ("staged" | "unstaged") => side,
        other => return Err(format!("unknown diff side {other}: use staged or unstaged")),
    };
    let current = super::diff::git_diff_impl(repo_path, &guard.file_path, Some(side))?;
    if current == guard.diff {
        Ok(())
    } else {
        Err(format!(
            "{} changed since this diff was shown; it was reloaded",
            guard.file_path
        ))
    }
}

/// Applies git's own patch text to the index or the work tree, exactly or not
/// at all — libgit2 does no fuzzy matching.
pub fn git_apply_patch_impl(
    repo_path: &str,
    patch: &str,
    target: &str,
    guard: Option<&ApplyPatchGuard>,
) -> Result<(), String> {
    let location = match target {
        "index" => ApplyLocation::Index,
        "workdir" => ApplyLocation::WorkDir,
        other => {
            return Err(format!(
                "unknown patch target {other}: use index or workdir"
            ))
        }
    };
    if let Some(guard) = guard {
        check_guard(repo_path, guard)?;
    }
    let repo = open(repo_path)?;
    let diff = Diff::from_buffer(patch.as_bytes())
        .map_err(|e| format!("could not read the patch: {e}"))?;
    repo.apply(&diff, location, None).map_err(|e| {
        format!(
            "{} no longer applies — the file changed since the diff was shown ({})",
            patch_paths(&diff),
            e.message()
        )
    })
}

fn is_ours(side: &str) -> Result<bool, String> {
    match side {
        "ours" => Ok(true),
        "theirs" => Ok(false),
        other => Err(format!("unknown side {other}: use ours or theirs")),
    }
}

/// Resolves a conflict by taking one side whole, blob and file mode as the
/// index stage holds them; a side that deleted the file deletes it. This is
/// the only way out of a binary or delete/modify conflict.
// code-gate: complexity-cyclomatic - a straight chain of refusals (path, side, repo, conflict, links); each `?` is one
pub fn git_resolve_conflict_side_impl(
    repo_path: &str,
    file_path: &str,
    side: &str,
) -> Result<(), String> {
    let relative = checked_relative_path(file_path)?;
    let take_ours = is_ours(side)?;
    let repo = open(repo_path)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "cannot resolve in a bare repository".to_string())?
        .to_path_buf();
    let mut index = fresh_index(&repo)?;
    let conflict = find_conflict(&index, file_path)?;
    refuse_symlinks_on_path(&workdir, relative, file_path, false)?;
    let chosen = if take_ours {
        conflict.our
    } else {
        conflict.their
    };
    let full = workdir.join(relative);
    match &chosen {
        Some(entry) => write_stage(&repo, &full, file_path, entry)?,
        None => write_resolution(&full, file_path, None)?,
    }
    index
        .remove_path(relative)
        .map_err(|e| format!("could not clear the conflict on {file_path}: {e}"))?;
    if chosen.is_some() {
        index
            .add_path(relative)
            .map_err(|e| format!("could not stage {file_path}: {e}"))?;
    }
    index
        .write()
        .map_err(|e| format!("could not write the index: {e}"))
}

/// Writes one index stage to the work tree with its mode, so staging the file
/// afterwards records the same blob and mode the stage had.
fn write_stage(
    repo: &Repository,
    full: &Path,
    file_path: &str,
    entry: &IndexEntry,
) -> Result<(), String> {
    let blob = repo
        .find_blob(entry.id)
        .map_err(|e| format!("could not read {file_path} from the index: {e}"))?;
    if fs::symlink_metadata(full).is_ok_and(|m| m.file_type().is_symlink())
        || (entry.mode == MODE_SYMLINK && fs::symlink_metadata(full).is_ok())
    {
        fs::remove_file(full).map_err(|e| format!("could not replace {file_path}: {e}"))?;
    }
    if entry.mode == MODE_SYMLINK {
        return write_symlink(full, file_path, blob.content());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("could not create the folder for {file_path}: {e}"))?;
    }
    fs::write(full, blob.content()).map_err(|e| format!("could not write {file_path}: {e}"))?;
    set_executable(full, file_path, entry.mode == MODE_EXECUTABLE)
}

#[cfg(unix)]
fn write_symlink(full: &Path, file_path: &str, target: &[u8]) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    std::os::unix::fs::symlink(std::ffi::OsStr::from_bytes(target), full)
        .map_err(|e| format!("could not link {file_path}: {e}"))
}

#[cfg(not(unix))]
fn write_symlink(_full: &Path, file_path: &str, _target: &[u8]) -> Result<(), String> {
    Err(format!(
        "{file_path} is a symlink, which this platform cannot write"
    ))
}

#[cfg(unix)]
fn set_executable(full: &Path, file_path: &str, executable: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(full)
        .map_err(|e| format!("could not read {file_path}: {e}"))?
        .permissions();
    let mode = perms.mode();
    perms.set_mode(if executable {
        mode | 0o111
    } else {
        mode & !0o111
    });
    fs::set_permissions(full, perms)
        .map_err(|e| format!("could not set the mode of {file_path}: {e}"))
}

#[cfg(not(unix))]
fn set_executable(_full: &Path, _file_path: &str, _executable: bool) -> Result<(), String> {
    Ok(())
}

fn commit_id(repo: &Repository, rev: &str) -> Result<Oid, String> {
    repo.revparse_single(rev)
        .and_then(|object| object.peel_to_commit())
        .map(|commit| commit.id())
        .map_err(|_| format!("{rev} does not name a commit"))
}

/// The best common ancestor of two revisions, as a full oid.
pub fn git_merge_base_impl(repo_path: &str, a: &str, b: &str) -> Result<String, String> {
    let repo = open(repo_path)?;
    let (a_id, b_id) = (commit_id(&repo, a)?, commit_id(&repo, b)?);
    repo.merge_base(a_id, b_id)
        .map(|oid| oid.to_string())
        .map_err(|_| format!("{a} and {b} have no common ancestor"))
}

/// Per side, the lines changed since the merge base and the commit that last
/// changed each one, by blaming the path at HEAD and at `MERGE_HEAD` with the
/// base as the oldest commit. A side without the file has no origins.
pub fn git_conflict_origins_impl(
    repo_path: &str,
    file_path: &str,
) -> Result<GitConflictOrigins, String> {
    let mut repo = open(repo_path)?;
    require_merge(&repo)?;
    let path = checked_relative_path(file_path)?;
    let head = commit_id(&repo, "HEAD")?;
    let theirs = *merge_heads(&mut repo)
        .first()
        .ok_or_else(|| "no merge in progress".to_string())?;
    let base = repo.merge_base(head, theirs).ok();

    let mut commits = HashMap::new();
    let ours = side_origins(&repo, path, head, base, &mut commits)?;
    let theirs = side_origins(&repo, path, theirs, base, &mut commits)?;
    let mut commits: Vec<OriginCommit> = commits.into_values().collect();
    commits.sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.oid.cmp(&b.oid)));
    Ok(GitConflictOrigins {
        ours,
        theirs,
        commits,
    })
}

fn side_origins(
    repo: &Repository,
    path: &Path,
    tip: Oid,
    base: Option<Oid>,
    commits: &mut HashMap<Oid, OriginCommit>,
) -> Result<Vec<LineOrigin>, String> {
    let tree = repo
        .find_commit(tip)
        .and_then(|c| c.tree())
        .map_err(|e| format!("could not read {tip}: {e}"))?;
    if tree.get_path(path).is_err() {
        return Ok(Vec::new());
    }
    let mut opts = BlameOptions::new();
    opts.newest_commit(tip);
    if let Some(base) = base {
        opts.oldest_commit(base);
    }
    let blame = repo
        .blame_file(path, Some(&mut opts))
        .map_err(|e| format!("could not blame {}: {e}", path.display()))?;
    let mut origins = Vec::new();
    for hunk in blame.iter() {
        let oid = hunk.final_commit_id();
        // Lines older than the base are pinned to it as a boundary.
        if hunk.is_boundary() || Some(oid) == base {
            continue;
        }
        if let Entry::Vacant(slot) = commits.entry(oid) {
            slot.insert(commit_info(repo, oid)?);
        }
        let start = hunk.final_start_line() as u32;
        for line in start..start + hunk.lines_in_hunk() as u32 {
            origins.push(LineOrigin {
                line,
                oid: oid.to_string(),
            });
        }
    }
    Ok(origins)
}

fn commit_info(repo: &Repository, oid: Oid) -> Result<OriginCommit, String> {
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("could not read commit {oid}: {e}"))?;
    let author = commit.author().name().unwrap_or("").to_string();
    Ok(OriginCommit {
        oid: oid.to_string(),
        short_oid: short_oid(oid),
        summary: commit.summary().unwrap_or("").to_string(),
        author,
        time: commit.time().seconds(),
    })
}
