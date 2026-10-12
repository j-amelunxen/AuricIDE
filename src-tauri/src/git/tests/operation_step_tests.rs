//! Finishing a rebase, cherry-pick or revert, and the merge preview, against
//! real repositories and the real git CLI.

use super::*;
use crate::git::merge::*;
use crate::git::operation_step::*;
use std::path::PathBuf;
use std::process::Output;
use std::time::Duration;
use tempfile::TempDir;

const BASE: &str = "line1\nbase\nline3\n";
const TIMEOUT: Duration = Duration::from_secs(60);

fn git(dir: &Path, args: &[&str]) -> Output {
    git_command(dir).args(args).output().unwrap()
}

fn git_ok(dir: &Path, args: &[&str]) -> String {
    let out = git(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn p(dir: &TempDir) -> &str {
    dir.path().to_str().unwrap()
}

/// The git the IDE would run: resolved through the login shell's PATH.
async fn git_bin() -> PathBuf {
    crate::video_import::preflight::resolve_executable("git")
        .await
        .expect("git must be installed to run these tests")
}

async fn step(dir: &TempDir, action: &str) -> Result<GitOperationStepResult, String> {
    git_operation_step_impl(p(dir), action, &git_bin().await, &[], TIMEOUT).await
}

/// `main` with `a.txt` changed to "ours"; `feature` forked before that with
/// two commits that each change the same line differently.
fn diverged_repo() -> TempDir {
    let dir = init_test_repo();
    let d = dir.path();
    git_ok(d, &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::write(d.join("a.txt"), BASE).unwrap();
    git_ok(d, &["add", "."]);
    git_ok(d, &["commit", "-qm", "base"]);
    git_ok(d, &["branch", "feature"]);
    fs::write(d.join("a.txt"), "line1\nours\nline3\n").unwrap();
    git_ok(d, &["commit", "-qam", "main change"]);
    git_ok(d, &["checkout", "-q", "feature"]);
    fs::write(d.join("a.txt"), "line1\nfirst\nline3\n").unwrap();
    git_ok(d, &["commit", "-qam", "first change"]);
    fs::write(d.join("a.txt"), "line1\nsecond\nline3\n").unwrap();
    git_ok(d, &["commit", "-qam", "second change"]);
    dir
}

/// `feature` checked out and `git rebase main` stopped on its first commit.
fn rebase_in_progress() -> TempDir {
    let dir = diverged_repo();
    let out = git(dir.path(), &["rebase", "main"]);
    assert!(!out.status.success(), "the fixture must stop on a conflict");
    dir
}

/// On `main`, `git cherry-pick <first feature commit>` stopped on a conflict.
fn cherry_pick_in_progress() -> TempDir {
    let dir = diverged_repo();
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    let out = git(dir.path(), &["cherry-pick", "feature~1"]);
    assert!(!out.status.success(), "the fixture must stop on a conflict");
    dir
}

fn resolve(dir: &TempDir, content: &str) {
    git_resolve_conflict_impl(p(dir), "a.txt", Some(content)).unwrap();
}

fn read(dir: &TempDir, name: &str) -> String {
    fs::read_to_string(dir.path().join(name)).unwrap()
}

// ---------- step on GitMergeState ----------

#[test]
fn merge_state_reports_which_commit_a_rebase_is_replaying() {
    let dir = rebase_in_progress();
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(state.operation, "rebase");
    assert_eq!(
        state.step,
        Some(GitOperationStep {
            current: 1,
            total: 2,
            subject: Some("first change".to_string()),
            branch: Some("feature".to_string()),
        })
    );
}

#[test]
fn merge_state_has_no_step_outside_a_rebase() {
    let dir = cherry_pick_in_progress();
    assert_eq!(git_merge_state_impl(p(&dir)).unwrap().step, None);
}

// ---------- continue / skip / abort ----------

#[tokio::test]
async fn continue_replays_a_rebase_commit_by_commit_until_it_finishes() {
    let dir = rebase_in_progress();
    let main_tip = git_ok(dir.path(), &["rev-parse", "main"]);

    resolve(&dir, "line1\nresolved one\nline3\n");
    let first = step(&dir, "continue").await.unwrap();
    assert_eq!(first.outcome, "conflicts");
    assert_eq!(first.operation, "rebase");
    assert_eq!(first.conflicts, vec!["a.txt".to_string()]);
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(state.step.map(|s| (s.current, s.total)), Some((2, 2)));

    resolve(&dir, "line1\nresolved two\nline3\n");
    let done = step(&dir, "continue").await.unwrap();
    assert_eq!(done.outcome, "done");
    assert!(done.conflicts.is_empty());
    assert_eq!(done.message, None);

    assert_eq!(git_merge_state_impl(p(&dir)).unwrap().operation, "none");
    assert_eq!(git_ok(dir.path(), &["branch", "--show-current"]), "feature");
    assert_eq!(
        git_ok(dir.path(), &["log", "--format=%s", "main..HEAD"]),
        "second change\nfirst change"
    );
    assert_eq!(git_ok(dir.path(), &["rev-list", "--merges", "HEAD"]), "");
    assert_eq!(git_ok(dir.path(), &["rev-parse", "HEAD~2"]), main_tip);
    assert_eq!(read(&dir, "a.txt"), "line1\nresolved two\nline3\n");
}

#[tokio::test]
async fn skip_drops_the_commit_being_replayed() {
    let dir = rebase_in_progress();

    let skipped = step(&dir, "skip").await.unwrap();
    // The second commit now conflicts with main's version instead.
    assert_eq!(skipped.outcome, "conflicts");
    resolve(&dir, "line1\nsecond\nline3\n");
    assert_eq!(step(&dir, "continue").await.unwrap().outcome, "done");
    assert_eq!(
        git_ok(dir.path(), &["log", "--format=%s", "main..HEAD"]),
        "second change"
    );
}

#[tokio::test]
async fn abort_puts_the_branch_back_where_the_rebase_started() {
    let dir = diverged_repo();
    let before = git_ok(dir.path(), &["rev-parse", "HEAD"]);
    assert!(!git(dir.path(), &["rebase", "main"]).status.success());
    resolve(&dir, "line1\nhalf done\nline3\n");

    let aborted = step(&dir, "abort").await.unwrap();
    assert_eq!(aborted.outcome, "done");
    assert_eq!(git_ok(dir.path(), &["rev-parse", "HEAD"]), before);
    assert_eq!(git_ok(dir.path(), &["branch", "--show-current"]), "feature");
    assert_eq!(read(&dir, "a.txt"), "line1\nsecond\nline3\n");
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "");
}

#[tokio::test]
async fn continue_finishes_a_cherry_pick_with_the_picked_message() {
    let dir = cherry_pick_in_progress();
    let before = git_ok(dir.path(), &["rev-parse", "HEAD"]);
    resolve(&dir, "line1\npicked\nline3\n");

    let done = step(&dir, "continue").await.unwrap();
    assert_eq!(done.outcome, "done");
    assert_eq!(done.operation, "cherry-pick");
    assert_eq!(git_ok(dir.path(), &["rev-parse", "HEAD~1"]), before);
    assert_eq!(
        git_ok(dir.path(), &["log", "-1", "--format=%s"]),
        "first change"
    );
    assert_eq!(read(&dir, "a.txt"), "line1\npicked\nline3\n");
}

#[tokio::test]
async fn an_empty_cherry_pick_stops_with_a_sentence_not_git_output() {
    let dir = cherry_pick_in_progress();
    // Resolving to HEAD's own text leaves the pick with nothing to commit.
    resolve(&dir, "line1\nours\nline3\n");

    let stopped = step(&dir, "continue").await.unwrap();
    assert_eq!(stopped.outcome, "stopped");
    assert!(stopped.conflicts.is_empty());
    let message = stopped.message.expect("a stop explains itself");
    assert!(message.contains("no changes left"), "{message}");
    assert!(!message.contains("git commit --allow-empty"), "{message}");
    assert!(!message.contains('\n'), "{message}");
    assert!(stopped
        .details
        .expect("git's own words go to details")
        .contains("allow-empty"));
    assert_eq!(
        git_merge_state_impl(p(&dir)).unwrap().operation,
        "cherry-pick"
    );

    assert_eq!(step(&dir, "skip").await.unwrap().outcome, "done");
    assert_eq!(git_merge_state_impl(p(&dir)).unwrap().operation, "none");
}

#[tokio::test]
async fn step_refuses_what_it_cannot_finish() {
    let clean = diverged_repo();
    let err = step(&clean, "continue").await.unwrap_err();
    assert!(err.contains("nothing to continue"), "{err}");

    let rebasing = rebase_in_progress();
    let err = step(&rebasing, "continue").await.unwrap_err();
    assert!(err.contains("1 conflict left"), "{err}");
    let err = step(&rebasing, "squash").await.unwrap_err();
    assert!(err.contains("unknown action"), "{err}");
    // Refusing ran nothing: still stopped on the same commit.
    let state = git_merge_state_impl(p(&rebasing)).unwrap();
    assert_eq!(state.step.map(|s| s.current), Some(1));

    let merging = diverged_repo();
    git_ok(merging.path(), &["checkout", "-q", "main"]);
    assert!(!git(merging.path(), &["merge", "feature"]).status.success());
    let err = step(&merging, "continue").await.unwrap_err();
    assert!(err.contains("Commit merge"), "{err}");
    let err = step(&merging, "abort").await.unwrap_err();
    assert!(err.contains("Abort merge"), "{err}");
}

#[test]
fn a_stop_is_described_in_one_sentence_per_cause() {
    let cases = [
        ("The previous cherry-pick is now empty", "no changes left"),
        (
            "error: Your local changes to the following files would be overwritten",
            "not staged",
        ),
        (
            "error: The following untracked working tree files would be overwritten",
            "untracked file",
        ),
        ("husky - pre-commit hook exited with code 1", "hook"),
        ("*** Please tell me who you are.", "user.name"),
        (
            "Stopped at 1234567... wip\nYou can amend the commit now",
            "edited",
        ),
        (
            "something nobody planned for",
            "Git stopped before finishing the rebase",
        ),
    ];
    for (raw, expected) in cases {
        let sentence = describe_stop("rebase", raw);
        assert!(sentence.contains(expected), "{raw:?} -> {sentence}");
        assert!(!sentence.contains('\n'));
    }
}

// ---------- git_merge_preview ----------

fn snapshot(dir: &TempDir) -> (String, String, Vec<u8>, String) {
    (
        git_ok(dir.path(), &["rev-parse", "HEAD"]),
        git_ok(
            dir.path(),
            &["status", "--porcelain", "--untracked-files=all"],
        ),
        fs::read(dir.path().join(".git").join("index")).unwrap(),
        read(dir, "a.txt"),
    )
}

#[test]
fn preview_names_the_conflicts_without_touching_the_repo() {
    let dir = diverged_repo();
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    fs::write(dir.path().join("note.txt"), "untracked\n").unwrap();
    let before = snapshot(&dir);

    let preview = git_merge_preview_impl(p(&dir), "feature").unwrap();
    assert_eq!(preview.outcome, "conflicts");
    assert_eq!(preview.conflicts, vec!["a.txt".to_string()]);
    assert_eq!(preview.commits, 2);

    assert_eq!(snapshot(&dir), before);
    assert_eq!(git_merge_state_impl(p(&dir)).unwrap().operation, "none");
}

#[test]
fn preview_tells_clean_fast_forward_and_up_to_date_apart() {
    let dir = diverged_repo();
    let d = dir.path();
    git_ok(d, &["checkout", "-q", "main"]);
    git_ok(d, &["checkout", "-qb", "side", "main~1"]);
    fs::write(d.join("b.txt"), "new\n").unwrap();
    git_ok(d, &["add", "."]);
    git_ok(d, &["commit", "-qm", "side file"]);
    git_ok(d, &["checkout", "-q", "main"]);
    git_ok(d, &["branch", "ahead", "main"]);
    git_ok(d, &["checkout", "-q", "ahead"]);
    fs::write(d.join("c.txt"), "c\n").unwrap();
    git_ok(d, &["add", "."]);
    git_ok(d, &["commit", "-qm", "ahead"]);
    git_ok(d, &["checkout", "-q", "main"]);

    let clean = git_merge_preview_impl(p(&dir), "side").unwrap();
    assert_eq!((clean.outcome.as_str(), clean.commits), ("clean", 1));
    assert!(clean.conflicts.is_empty());

    let ff = git_merge_preview_impl(p(&dir), "ahead").unwrap();
    assert_eq!((ff.outcome.as_str(), ff.commits), ("fast-forward", 1));

    git_ok(d, &["branch", "old", "main~1"]);
    let none = git_merge_preview_impl(p(&dir), "old").unwrap();
    assert_eq!((none.outcome.as_str(), none.commits), ("up-to-date", 0));

    let err = git_merge_preview_impl(p(&dir), "nope").unwrap_err();
    assert!(err.contains("nope"), "{err}");
    assert!(!d.join("b.txt").exists(), "a preview writes nothing");
}

// ---------- which commit the stop belongs to ----------

#[test]
fn merge_state_names_head_and_the_commit_being_applied() {
    let dir = rebase_in_progress();
    let first = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(
        first.head_oid.as_deref(),
        Some(git_ok(dir.path(), &["rev-parse", "HEAD"]).as_str())
    );
    assert_eq!(
        first.applying_oid.as_deref(),
        Some(git_ok(dir.path(), &["rev-parse", "feature~1"]).as_str())
    );

    // Skipped in a terminal: HEAD stays, the commit being applied moves on.
    assert!(!git(dir.path(), &["rebase", "--skip"]).status.success());
    let second = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(second.head_oid, first.head_oid);
    assert_eq!(
        second.applying_oid.as_deref(),
        Some(git_ok(dir.path(), &["rev-parse", "feature"]).as_str())
    );

    let picking = cherry_pick_in_progress();
    let state = git_merge_state_impl(p(&picking)).unwrap();
    assert_eq!(
        state.applying_oid.as_deref(),
        Some(git_ok(picking.path(), &["rev-parse", "feature~1"]).as_str())
    );
    let clean = diverged_repo();
    assert_eq!(git_merge_state_impl(p(&clean)).unwrap().applying_oid, None);
}
