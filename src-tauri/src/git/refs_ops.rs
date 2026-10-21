//! The light write operations of the git graph browser: checkout, branches,
//! tags, cherry-pick and revert. Contract: `docs/design-git-graph.md`.
//!
//! Every refusal is `<code>: <one plain sentence>`; git's own output goes to
//! the log, never into the sentence. Nothing here pushes, fetches or deletes a
//! remote ref, and nothing discards uncommitted work.

use super::merge::{conflicted_paths, operation_name};
use super::operation_step::{run_git, OPERATION_STEP_TIMEOUT};
use super::types::PickResult;
use git2::build::CheckoutBuilder;
use git2::{Branch, BranchType, Commit, ErrorCode, Oid, Reference, Repository};
use std::path::Path;

const HEADS: &str = "refs/heads/";
const REMOTES: &str = "refs/remotes/";
const TAGS: &str = "refs/tags/";

/// An error string the UI can map: the code is the title, the sentence the body.
pub(crate) fn refuse(code: &str, sentence: &str) -> String {
    format!("{code}: {sentence}")
}

fn open_idle(repo_path: &str) -> Result<Repository, String> {
    let repo = Repository::open(repo_path)
        .map_err(|_| refuse("not_found", "This folder is not a git repository."))?;
    match operation_name(repo.state()) {
        "none" => Ok(repo),
        "other" => Err(refuse(
            "operation_in_progress",
            "Another operation is in progress. Finish or abort it first.",
        )),
        operation => Err(refuse(
            "operation_in_progress",
            &format!("A {operation} is in progress. Finish or abort it first."),
        )),
    }
}

fn git_failed(context: &str, error: &git2::Error) -> String {
    eprintln!("git graph: {context}: {error}");
    refuse("git_failed", &format!("Git could not {context}."))
}

pub(crate) fn find_commit<'r>(repo: &'r Repository, oid: &str) -> Result<Commit<'r>, String> {
    Oid::from_str(oid)
        .ok()
        .and_then(|parsed| repo.find_commit(parsed).ok())
        .ok_or_else(|| {
            refuse(
                "not_found",
                "That commit does not exist in this repository.",
            )
        })
}

fn find_local<'r>(repo: &'r Repository, name: &str) -> Result<Branch<'r>, String> {
    repo.find_branch(name, BranchType::Local)
        .map_err(|_| refuse("not_found", &format!("There is no branch named {name}.")))
}

/// libgit2 accepts control characters and a leading dash; git does not.
fn is_plain_ref_name(name: &str) -> bool {
    !name.starts_with('-') && !name.chars().any(char::is_control)
}

fn ensure_valid_branch_name(name: &str) -> Result<(), String> {
    if is_plain_ref_name(name) && Branch::name_is_valid(name).unwrap_or(false) {
        return Ok(());
    }
    Err(refuse(
        "invalid_name",
        &format!("{name} is not a valid branch name."),
    ))
}

/// Whether a ref already sits where `name` would need a file or a folder:
/// the name itself, a ref above it (`feature` for `feature/x`), or refs below
/// it (`feature/x` for `feature`). libgit2 only notices the last two after it
/// has written, and its rename removes the old loose ref first.
fn branch_name_is_taken(repo: &Repository, name: &str, ignoring: Option<&str>) -> bool {
    let is_ignored = |branch: &str| ignoring == Some(branch);
    let exists = |branch: &str| {
        !is_ignored(branch) && repo.find_reference(&format!("{HEADS}{branch}")).is_ok()
    };
    let parent_taken = name
        .match_indices('/')
        .any(|(slash, _)| exists(&name[..slash]));
    let below = || {
        repo.references_glob(&format!("{HEADS}{name}/*"))
            .map(|refs| {
                refs.flatten()
                    .filter_map(|r| r.name().map(str::to_string))
                    .any(|full| !is_ignored(&full[HEADS.len()..]))
            })
            .unwrap_or(false)
    };
    exists(name) || parent_taken || below()
}

fn ensure_branch_free(repo: &Repository, name: &str, ignoring: Option<&str>) -> Result<(), String> {
    if branch_name_is_taken(repo, name, ignoring) {
        return Err(refuse(
            "already_exists",
            &format!("A branch named {name} already exists or clashes with one."),
        ));
    }
    Ok(())
}

/// Updates the work tree to `commit` without overwriting anything that is not
/// committed: modified tracked files and untracked files in the way are both
/// refused.
fn safe_checkout_tree(repo: &Repository, commit: &Commit) -> Result<(), String> {
    let mut options = CheckoutBuilder::new();
    options.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut options))
        .map_err(|e| match e.code() {
            ErrorCode::Conflict => refuse(
                "would_overwrite",
                "Check out would overwrite changes in your working copy. Commit or stash them first.",
            ),
            _ => git_failed("check out", &e),
        })
}

fn set_head_to(repo: &Repository, reference: &str) -> Result<(), String> {
    repo.set_head(reference)
        .map_err(|e| git_failed("move HEAD", &e))
}

fn checkout_local(repo: &Repository, reference: &Reference) -> Result<(), String> {
    let commit = reference
        .peel_to_commit()
        .map_err(|e| git_failed("read the branch", &e))?;
    safe_checkout_tree(repo, &commit)?;
    set_head_to(repo, reference.name().unwrap_or_default())
}

/// A new local branch named like the remote one, tracking it, checked out.
fn checkout_remote(repo: &Repository, full_name: &str) -> Result<(), String> {
    let shorthand = &full_name[REMOTES.len()..];
    let local_name = shorthand
        .split_once('/')
        .map(|(_, branch)| branch)
        .filter(|branch| !branch.is_empty())
        .ok_or_else(|| refuse("not_found", "That remote branch name is not valid."))?;
    ensure_branch_free(repo, local_name, None)?;
    let commit = repo
        .find_reference(full_name)
        .and_then(|r| r.peel_to_commit())
        .map_err(|_| refuse("not_found", "That remote branch does not exist."))?;
    safe_checkout_tree(repo, &commit)?;
    let mut branch = repo
        .branch(local_name, &commit, false)
        .map_err(|e| git_failed("create the branch", &e))?;
    branch
        .set_upstream(Some(shorthand))
        .map_err(|e| git_failed("set the upstream", &e))?;
    set_head_to(repo, &format!("{HEADS}{local_name}"))
}

fn checkout_detached(repo: &Repository, target: &str) -> Result<(), String> {
    let commit = if target.starts_with(TAGS) {
        repo.find_reference(target).and_then(|r| r.peel_to_commit())
    } else {
        Oid::from_str(target).and_then(|oid| repo.find_commit(oid))
    }
    .map_err(|_| refuse("not_found", "That commit or tag does not exist."))?;
    safe_checkout_tree(repo, &commit)?;
    repo.set_head_detached(commit.id())
        .map_err(|e| git_failed("move HEAD", &e))
}

/// `target` is a full ref name or a commit id.
pub fn git_checkout_impl(repo_path: &str, target: &str) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    if target.starts_with(HEADS) {
        let reference = repo
            .find_reference(target)
            .map_err(|_| refuse("not_found", "That branch does not exist."))?;
        checkout_local(&repo, &reference)
    } else if target.starts_with(REMOTES) {
        checkout_remote(&repo, target)
    } else {
        checkout_detached(&repo, target)
    }
}

pub fn git_branch_create_impl(
    repo_path: &str,
    name: &str,
    at_oid: &str,
    checkout: bool,
) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    ensure_valid_branch_name(name)?;
    ensure_branch_free(&repo, name, None)?;
    let commit = find_commit(&repo, at_oid)?;
    let branch = repo
        .branch(name, &commit, false)
        .map_err(|e| git_failed("create the branch", &e))?;
    if !checkout {
        return Ok(());
    }
    // A branch the user asked to switch to but could not is not left behind.
    checkout_local(&repo, branch.get()).inspect_err(|_| {
        if let Ok(mut created) = repo.find_branch(name, BranchType::Local) {
            let _ = created.delete();
        }
    })
}

pub fn git_branch_rename_impl(
    repo_path: &str,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    ensure_valid_branch_name(new_name)?;
    let mut branch = find_local(&repo, old_name)?;
    ensure_branch_free(&repo, new_name, Some(old_name))?;
    branch
        .rename(new_name, false)
        .map(|_| ())
        .map_err(|e| git_failed("rename the branch", &e))
}

/// Whether `tip` is contained in `other` (equal counts).
fn is_reachable_from(repo: &Repository, tip: Oid, other: Option<Oid>) -> bool {
    other.is_some_and(|o| o == tip || repo.graph_descendant_of(o, tip).unwrap_or(false))
}

/// Like `git branch -d`: with an upstream the tip must be on it, without one
/// on HEAD.
fn is_merged(repo: &Repository, branch: &Branch, tip: Oid) -> bool {
    let against = match branch.upstream() {
        Ok(upstream) => upstream.get().target(),
        Err(_) => repo.head().ok().and_then(|h| h.target()),
    };
    is_reachable_from(repo, tip, against)
}

pub fn git_branch_delete_impl(repo_path: &str, name: &str, force: bool) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    let mut branch = find_local(&repo, name)?;
    if branch.is_head() {
        return Err(refuse(
            "current_branch",
            "You are on this branch. Check out another one before deleting it.",
        ));
    }
    let tip = branch
        .get()
        .target()
        .ok_or_else(|| refuse("not_found", "That branch does not point at a commit."))?;
    if !force && !is_merged(&repo, &branch, tip) {
        return Err(refuse(
            "not_merged",
            "This branch has commits that are not merged. Deleting it would lose them.",
        ));
    }
    branch
        .delete()
        .map_err(|e| git_failed("delete the branch", &e))
}

pub fn git_tag_create_impl(
    repo_path: &str,
    name: &str,
    oid: &str,
    message: Option<&str>,
) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    let full_name = format!("{TAGS}{name}");
    if !is_plain_ref_name(name) || !Reference::is_valid_name(&full_name) {
        return Err(refuse(
            "invalid_name",
            &format!("{name} is not a valid tag name."),
        ));
    }
    if repo.find_reference(&full_name).is_ok() {
        return Err(refuse(
            "already_exists",
            &format!("A tag named {name} already exists."),
        ));
    }
    let commit = find_commit(&repo, oid)?;
    let outcome = match message.filter(|m| !m.trim().is_empty()) {
        Some(text) => {
            let signature = repo.signature().map_err(|_| {
                refuse(
                    "git_failed",
                    "Git does not know who you are. Set user.name and user.email first.",
                )
            })?;
            repo.tag(name, commit.as_object(), &signature, text, false)
        }
        None => repo.tag_lightweight(name, commit.as_object(), false),
    };
    outcome
        .map(|_| ())
        .map_err(|e| git_failed("create the tag", &e))
}

pub fn git_tag_delete_impl(repo_path: &str, name: &str) -> Result<(), String> {
    let repo = open_idle(repo_path)?;
    repo.tag_delete(name).map_err(|e| match e.code() {
        ErrorCode::NotFound => refuse("not_found", &format!("There is no tag named {name}.")),
        _ => git_failed("delete the tag", &e),
    })
}

/// Tracked changes in the index or work tree. Untracked files do not count:
/// git itself only objects to them when they are in the way.
fn is_dirty(repo: &Repository) -> Result<bool, String> {
    let mut options = git2::StatusOptions::new();
    options.include_untracked(false).include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut options))
        .map_err(|e| git_failed("read the status", &e))?;
    Ok(!statuses.is_empty())
}

#[derive(Clone, Copy)]
pub enum PickKind {
    CherryPick,
    Revert,
}

impl PickKind {
    fn name(self) -> &'static str {
        match self {
            Self::CherryPick => "cherry-pick",
            Self::Revert => "revert",
        }
    }

    fn args(self, oid: &str, is_merge: bool) -> Vec<String> {
        let mut args = vec![self.name().to_string()];
        if matches!(self, Self::Revert) {
            args.push("--no-edit".to_string());
        }
        if is_merge {
            args.extend(["-m".to_string(), "1".to_string()]);
        }
        args.push(oid.to_string());
        args
    }
}

fn head_oid(repo_path: &str) -> Option<String> {
    let repo = Repository::open(repo_path).ok()?;
    let oid = repo.head().ok()?.target()?;
    Some(oid.to_string())
}

const EMPTY_PICK_MARKERS: &[&str] = &["is now empty", "nothing to commit", "allow-empty"];

const PICK_FAILURES: &[(&[&str], &str)] = &[
    (
        &["untracked working tree files would be overwritten"],
        "An untracked file is in the way. Move it away and try again.",
    ),
    (
        &[
            "would be overwritten",
            "unstaged changes",
            "commit or stash",
        ],
        "Changes in your working copy are in the way. Commit or stash them and try again.",
    ),
    (
        &["please tell me who you are", "user.email"],
        "Git does not know who you are. Set user.name and user.email, then try again.",
    ),
    (&["hook"], "A git hook refused the commit."),
];

/// One sentence for a pick that failed without conflicts and left nothing
/// open. It must hold for the repository as it is after the call.
fn describe_pick_failure(kind: PickKind, raw: &str) -> String {
    let haystack = raw.to_lowercase();
    PICK_FAILURES
        .iter()
        .find(|(needles, _)| needles.iter().any(|n| haystack.contains(n)))
        .map(|(_, sentence)| (*sentence).to_string())
        .unwrap_or_else(|| format!("Git could not finish the {}.", kind.name()))
}

fn current_branch_label(repo: &Repository) -> String {
    repo.head()
        .ok()
        .filter(|_| !repo.head_detached().unwrap_or(false))
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_else(|| "the current commit".to_string())
}

fn already_applied_sentence(kind: PickKind, branch: &str) -> String {
    match kind {
        PickKind::CherryPick => format!("This change is already on {branch}. Nothing was picked."),
        PickKind::Revert => {
            format!("This change is already undone on {branch}. Nothing was reverted.")
        }
    }
}

/// What a finished `git cherry-pick|revert` left behind. A conflict is the
/// repository in that operation's state with conflicted paths. A pick with
/// nothing left to commit is aborted again so no operation stays open. Any
/// other failure is a refusal with a sentence, never git's output.
async fn read_pick_outcome(
    repo_path: &str,
    kind: PickKind,
    succeeded: bool,
    raw: &str,
    git: &Path,
    env: &[(String, String)],
) -> Result<PickResult, String> {
    if succeeded {
        return Ok(PickResult {
            clean: true,
            conflicts: Vec::new(),
            new_oid: head_oid(repo_path),
        });
    }
    let repo = Repository::open(repo_path)
        .map_err(|_| refuse("not_found", "This folder is not a git repository."))?;
    let left_open = operation_name(repo.state()) == kind.name();
    let conflicts = if left_open {
        conflicted_paths(&repo)?
    } else {
        Vec::new()
    };
    if !conflicts.is_empty() {
        return Ok(PickResult {
            clean: false,
            conflicts,
            new_oid: None,
        });
    }
    eprintln!("git graph: {} failed: {raw}", kind.name());
    let lowered = raw.to_lowercase();
    if EMPTY_PICK_MARKERS.iter().any(|m| lowered.contains(m)) {
        if left_open {
            abort_pick(repo_path, kind, git, env).await?;
        }
        let branch = current_branch_label(&repo);
        return Err(refuse(
            "already_applied",
            &already_applied_sentence(kind, &branch),
        ));
    }
    if left_open {
        abort_pick(repo_path, kind, git, env).await?;
    }
    Err(refuse("git_failed", &describe_pick_failure(kind, raw)))
}

async fn abort_pick(
    repo_path: &str,
    kind: PickKind,
    git: &Path,
    env: &[(String, String)],
) -> Result<(), String> {
    let (_, raw) = run_git(
        git,
        repo_path,
        &[kind.name(), "--abort"],
        env,
        OPERATION_STEP_TIMEOUT,
    )
    .await
    .map_err(|e| {
        eprintln!("git graph: {e}");
        refuse("git_failed", "Git could not be run.")
    })?;
    let still_open = Repository::open(repo_path)
        .map(|repo| operation_name(repo.state()) != "none")
        .unwrap_or(false);
    if still_open {
        eprintln!("git graph: abort failed: {raw}");
        return Err(refuse(
            "git_failed",
            &format!(
                "Git could not undo the unfinished {}. Abort it from the merge panel.",
                kind.name()
            ),
        ));
    }
    Ok(())
}

/// Runs the real git, so the sequencer state is the one `git_operation_step`
/// understands. Refuses before running when anything is in progress or the
/// tracked files have uncommitted changes.
pub async fn git_pick_impl(
    repo_path: &str,
    oid: &str,
    kind: PickKind,
    git: &Path,
    env: &[(String, String)],
) -> Result<PickResult, String> {
    let is_merge = {
        let repo = open_idle(repo_path)?;
        if is_dirty(&repo)? {
            return Err(refuse(
                "dirty_worktree",
                "You have uncommitted changes. Commit or stash them first.",
            ));
        }
        let is_merge = find_commit(&repo, oid)?.parent_count() > 1;
        is_merge
    };
    let args = kind.args(oid, is_merge);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let (succeeded, raw) = run_git(git, repo_path, &args, env, OPERATION_STEP_TIMEOUT)
        .await
        .map_err(|e| {
            eprintln!("git graph: {e}");
            refuse("git_failed", "Git could not be run.")
        })?;
    read_pick_outcome(repo_path, kind, succeeded, &raw, git, env).await
}
