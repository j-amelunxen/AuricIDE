//! Finishing a rebase, cherry-pick or revert from the merge panel. Contract
//! and reasoning: `docs/design-merge-panel.md`.
//!
//! This is the one place the git backend shells out. libgit2 has no
//! sequencer: it can replay a single commit, but not continue git's own
//! todo list in `.git/rebase-merge` or `.git/sequencer`, and a half-done
//! rebase is exactly that list. Running the real `git` is the only way the
//! result is git's result. The executable is resolved by absolute path, every
//! editor git might open is `true`, and git's output is never the message.

use super::merge::{conflicted_paths, operation_name};
use super::types::*;
use crate::video_import::failure::readable_details;
use git2::{Repository, RepositoryState};
use std::fs;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// Long enough for a commit hook that runs a test suite, short enough that a
/// git waiting on something it will never get does not hang the panel.
pub const OPERATION_STEP_TIMEOUT: Duration = Duration::from_secs(300);

/// Which commit a rebase is replaying, from git's progress files. The merge
/// backend (`rebase-merge`) names the commit; the am backend (`rebase-apply`)
/// only counts.
pub(crate) fn rebase_step(repo: &Repository) -> Option<GitOperationStep> {
    if operation_name(repo.state()) != "rebase" {
        return None;
    }
    let read = |dir: &str, name: &str| fs::read_to_string(repo.path().join(dir).join(name)).ok();
    let number = |dir: &str, name: &str| read(dir, name)?.trim().parse::<u32>().ok();
    let (dir, current, total) = [
        ("rebase-merge", "msgnum", "end"),
        ("rebase-apply", "next", "last"),
    ]
    .into_iter()
    .find_map(|(dir, cur, end)| Some((dir, number(dir, cur)?, number(dir, end)?)))?;
    if current == 0 || current > total {
        return None;
    }
    let subject = (dir == "rebase-merge")
        .then(|| read(dir, "message"))
        .flatten()
        .and_then(|msg| {
            msg.lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(str::to_string)
        });
    let branch = read(dir, "head-name")
        .and_then(|name| name.trim().strip_prefix("refs/heads/").map(str::to_string));
    Some(GitOperationStep {
        current,
        total,
        subject,
        branch,
    })
}

/// The commit being applied, from the pseudo-ref git writes for the
/// operation in progress. None for a merge and when nothing is in progress.
pub(crate) fn applying_oid(repo: &Repository) -> Option<String> {
    let name = match operation_name(repo.state()) {
        "rebase" => "REBASE_HEAD",
        "cherry-pick" => "CHERRY_PICK_HEAD",
        "revert" => "REVERT_HEAD",
        _ => return None,
    };
    let raw = fs::read_to_string(repo.path().join(name)).ok()?;
    git2::Oid::from_str(raw.trim()).ok().map(|o| o.to_string())
}

fn step_flag(action: &str) -> Result<&'static str, String> {
    match action {
        "continue" => Ok("--continue"),
        "skip" => Ok("--skip"),
        "abort" => Ok("--abort"),
        other => Err(format!(
            "unknown action {other}: use continue, skip or abort"
        )),
    }
}

/// The operation a step may run on, or why it may not. Nothing is run when
/// this refuses.
fn check_step(repo_path: &str, action: &str) -> Result<&'static str, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("not a git repository: {e}"))?;
    let operation = match repo.state() {
        RepositoryState::Merge => {
            return Err(
                "a merge is finished with Commit merge or Abort merge, not stepped".to_string(),
            )
        }
        state => operation_name(state),
    };
    match operation {
        "rebase" | "cherry-pick" | "revert" => {}
        "none" => {
            return Err(
                "nothing to continue: no rebase, cherry-pick or revert is in progress".to_string(),
            )
        }
        _ => return Err("git is in the middle of something the panel cannot finish".to_string()),
    }
    if action == "continue" {
        let left = conflicted_paths(&repo)?.len();
        if left > 0 {
            let noun = if left == 1 { "conflict" } else { "conflicts" };
            return Err(format!("{left} {noun} left to resolve"));
        }
    }
    Ok(operation)
}

/// `git <operation> <flag>` in the repo, with no editor and no prompt.
/// Returns whether it exited 0 and its stdout and stderr together.
async fn run_git(
    git: &Path,
    repo_path: &str,
    args: &[&str],
    env: &[(String, String)],
    timeout: Duration,
) -> Result<(bool, String), String> {
    let mut command = Command::new(git);
    command.args(args).current_dir(repo_path);
    for (key, value) in env {
        command.env(key, value);
    }
    command
        // The repo is the cwd; an inherited GIT_DIR would point git elsewhere.
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| {
            format!(
                "git did not finish within {} seconds; check the repository in a terminal",
                timeout.as_secs()
            )
        })?
        .map_err(|e| format!("could not run git: {e}"))?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.success(), text))
}

const STOP_RULES: &[(&[&str], &str)] = &[
    (
        &["is now empty", "nothing to commit", "allow-empty"],
        "This commit has no changes left after resolving. Skip it, or abort.",
    ),
    (
        &["untracked working tree files would be overwritten"],
        "An untracked file is in the way of the next commit. Move it away, then continue.",
    ),
    (
        &[
            "would be overwritten",
            "unstaged changes",
            "commit or stash",
            "you must edit all merge conflicts",
        ],
        "Some changes are not staged. Stage or undo them, then continue.",
    ),
    (
        &["please tell me who you are", "user.email"],
        "Git does not know who you are. Set user.name and user.email, then continue.",
    ),
    (
        &["hook"],
        "A git hook refused the commit. The details say why.",
    ),
    (
        &["you can amend the commit now", "stopped at"],
        "The rebase stopped so this commit can be edited. Continue when ready.",
    ),
];

/// One plain sentence for why git stopped without conflicts. git's output
/// goes to `details`, never here.
pub fn describe_stop(operation: &str, raw: &str) -> String {
    let haystack = raw.to_lowercase();
    STOP_RULES
        .iter()
        .find(|(needles, _)| needles.iter().any(|n| haystack.contains(n)))
        .map(|(_, sentence)| (*sentence).to_string())
        .unwrap_or_else(|| {
            format!(
                "Git stopped before finishing the {operation}. The details say what it reported."
            )
        })
}

/// Re-reads the repository after the step: finished, stopped on a conflict,
/// or stopped for another reason.
fn read_outcome(
    repo_path: &str,
    operation: &str,
    raw: &str,
) -> Result<GitOperationStepResult, String> {
    let repo = Repository::open(repo_path).map_err(|e| format!("not a git repository: {e}"))?;
    let result = |outcome: &str, conflicts, message, details| GitOperationStepResult {
        outcome: outcome.to_string(),
        operation: operation.to_string(),
        conflicts,
        message,
        details,
    };
    if operation_name(repo.state()) == "none" {
        return Ok(result("done", Vec::new(), None, None));
    }
    let conflicts = conflicted_paths(&repo)?;
    if !conflicts.is_empty() {
        let files = if conflicts.len() == 1 {
            "1 file".to_string()
        } else {
            format!("{} files", conflicts.len())
        };
        let message = format!("Stopped on the next commit: {files} to resolve.");
        return Ok(result("conflicts", conflicts, Some(message), None));
    }
    let details = readable_details(raw);
    Ok(result(
        "stopped",
        Vec::new(),
        Some(describe_stop(operation, raw)),
        (!details.is_empty()).then_some(details),
    ))
}

/// `git rebase|cherry-pick|revert --continue|--skip|--abort` with the real
/// git at `git`. Refuses while conflicts are left (continue), while a merge
/// is in progress, and when nothing is.
pub async fn git_operation_step_impl(
    repo_path: &str,
    action: &str,
    git: &Path,
    env: &[(String, String)],
    timeout: Duration,
) -> Result<GitOperationStepResult, String> {
    let flag = step_flag(action)?;
    let operation = check_step(repo_path, action)?;
    let (_, raw) = run_git(git, repo_path, &[operation, flag], env, timeout).await?;
    read_outcome(repo_path, operation, &raw)
}
