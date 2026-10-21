//! Checkout, branches, tags, cherry-pick and revert against real
//! repositories, with the real `git` as the oracle where semantics matter.

use super::graph_tests::{forked_repo, git, git_ok, main_repo, p, rev};
use super::*;
use crate::git::graph::git_refs_impl;
use crate::git::operation_step::git_operation_step_impl;
use crate::git::refs_ops::*;
use std::path::PathBuf;
use std::time::Duration;
use tempfile::TempDir;

fn assert_refused(result: Result<(), String>, code: &str) {
    let message = result.expect_err("the operation should have been refused");
    assert!(
        message.starts_with(&format!("{code}: ")),
        "expected {code}, got: {message}"
    );
}

fn head_ref(dir: &TempDir) -> String {
    git_ok(dir.path(), &["rev-parse", "--symbolic-full-name", "HEAD"])
}

fn file(dir: &TempDir, name: &str) -> String {
    fs::read_to_string(dir.path().join(name)).unwrap()
}

/// `main` and `other` both change a.txt from the base, so they conflict.
fn conflicting_repo() -> (TempDir, String) {
    let dir = main_repo();
    git_ok(dir.path(), &["checkout", "-qb", "other"]);
    commit_file(&dir, "a.txt", "other\n", "other change");
    let other = rev(&dir, "HEAD");
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    commit_file(&dir, "a.txt", "main\n", "main change");
    (dir, other)
}

async fn git_bin() -> PathBuf {
    crate::video_import::preflight::resolve_executable("git")
        .await
        .expect("git must be installed to run these tests")
}

async fn pick(dir: &TempDir, oid: &str, kind: PickKind) -> Result<crate::git::PickResult, String> {
    git_pick_impl(p(dir), oid, kind, &git_bin().await, &[]).await
}

// ---- checkout -------------------------------------------------------------

#[test]
fn checkout_of_a_local_branch_moves_head_and_the_work_tree() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["checkout", "-q", "--detach", &f.base]);
    git_checkout_impl(p(&f.dir), "refs/heads/feature").unwrap();
    assert_eq!(head_ref(&f.dir), "refs/heads/feature");
    assert_eq!(file(&f.dir, "feature.txt"), "f\n");
    assert!(!f.dir.path().join("main.txt").exists());
}

#[test]
fn checkout_of_a_remote_branch_creates_a_tracking_local_branch() {
    let f = forked_repo();
    let d = f.dir.path();
    git_ok(
        d,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    git_ok(d, &["update-ref", "refs/remotes/origin/work", &f.feature1]);

    git_checkout_impl(p(&f.dir), "refs/remotes/origin/work").unwrap();

    assert_eq!(head_ref(&f.dir), "refs/heads/work");
    assert_eq!(rev(&f.dir, "work"), f.feature1);
    assert_eq!(git_ok(d, &["config", "branch.work.remote"]), "origin");
    assert_eq!(
        git_ok(d, &["config", "branch.work.merge"]),
        "refs/heads/work"
    );
    let refs = git_refs_impl(p(&f.dir)).unwrap();
    let work = refs.refs.iter().find(|r| r.shorthand == "work").unwrap();
    assert_eq!(work.upstream.as_deref(), Some("origin/work"));
}

#[test]
fn checkout_of_a_remote_branch_whose_local_twin_exists_is_already_exists() {
    let f = forked_repo();
    git_ok(
        f.dir.path(),
        &["update-ref", "refs/remotes/origin/feature", &f.feature1],
    );
    assert_refused(
        git_checkout_impl(p(&f.dir), "refs/remotes/origin/feature"),
        "already_exists",
    );
    assert_eq!(head_ref(&f.dir), "refs/heads/main");
}

#[test]
fn checkout_of_an_oid_or_a_tag_detaches_head() {
    let f = forked_repo();
    git_checkout_impl(p(&f.dir), &f.main1).unwrap();
    assert_eq!(head_ref(&f.dir), "HEAD");
    assert_eq!(rev(&f.dir, "HEAD"), f.main1);

    git_ok(f.dir.path(), &["tag", "-a", "v1", "-m", "one", &f.base]);
    git_checkout_impl(p(&f.dir), "refs/tags/v1").unwrap();
    assert_eq!(rev(&f.dir, "HEAD"), f.base);
    assert!(git_refs_impl(p(&f.dir)).unwrap().head_detached);
}

#[test]
fn checkout_of_something_unknown_is_not_found() {
    let f = forked_repo();
    assert_refused(git_checkout_impl(p(&f.dir), "refs/heads/nope"), "not_found");
    assert_refused(git_checkout_impl(p(&f.dir), &"1".repeat(40)), "not_found");
    assert_refused(
        git_checkout_impl(p(&f.dir), "refs/remotes/origin/nope"),
        "not_found",
    );
}

#[test]
fn checkout_refuses_to_overwrite_a_dirty_tracked_file_and_leaves_it_alone() {
    let (dir, _) = conflicting_repo();
    fs::write(dir.path().join("a.txt"), "my unsaved work\n").unwrap();

    assert_refused(
        git_checkout_impl(p(&dir), "refs/heads/other"),
        "would_overwrite",
    );

    assert_eq!(file(&dir, "a.txt"), "my unsaved work\n");
    assert_eq!(head_ref(&dir), "refs/heads/main");
    assert!(
        !git(dir.path(), &["checkout", "other"]).status.success(),
        "real git refuses too"
    );
}

#[test]
fn checkout_refuses_to_overwrite_an_untracked_file_in_the_way() {
    let dir = main_repo();
    git_ok(dir.path(), &["checkout", "-qb", "other"]);
    commit_file(&dir, "new.txt", "from other\n", "add new");
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    fs::write(dir.path().join("new.txt"), "mine, untracked\n").unwrap();

    assert_refused(
        git_checkout_impl(p(&dir), "refs/heads/other"),
        "would_overwrite",
    );

    assert_eq!(file(&dir, "new.txt"), "mine, untracked\n");
    assert_eq!(head_ref(&dir), "refs/heads/main");
    assert!(
        !git(dir.path(), &["checkout", "other"]).status.success(),
        "real git refuses too"
    );
}

#[test]
fn checkout_keeps_uncommitted_changes_the_target_does_not_touch() {
    let f = forked_repo();
    fs::write(f.dir.path().join("a.txt"), "dirty but harmless\n").unwrap();
    git_checkout_impl(p(&f.dir), "refs/heads/feature").unwrap();
    assert_eq!(file(&f.dir, "a.txt"), "dirty but harmless\n");
    assert_eq!(head_ref(&f.dir), "refs/heads/feature");
}

// ---- branches -------------------------------------------------------------

#[test]
fn branch_create_makes_a_branch_at_the_commit_without_moving_head() {
    let f = forked_repo();
    git_branch_create_impl(p(&f.dir), "topic", &f.base, false).unwrap();
    assert_eq!(rev(&f.dir, "topic"), f.base);
    assert_eq!(head_ref(&f.dir), "refs/heads/main");
}

#[test]
fn branch_create_can_check_the_new_branch_out() {
    let f = forked_repo();
    git_branch_create_impl(p(&f.dir), "topic", &f.feature1, true).unwrap();
    assert_eq!(head_ref(&f.dir), "refs/heads/topic");
    assert_eq!(file(&f.dir, "feature.txt"), "f\n");
}

#[test]
fn branch_create_that_cannot_check_out_leaves_no_branch_behind() {
    let (dir, other) = conflicting_repo();
    fs::write(dir.path().join("a.txt"), "unsaved\n").unwrap();
    assert_refused(
        git_branch_create_impl(p(&dir), "topic", &other, true),
        "would_overwrite",
    );
    assert!(!git(dir.path(), &["rev-parse", "--verify", "-q", "topic"])
        .status
        .success());
}

#[test]
fn branch_create_refuses_bad_names_duplicates_and_unknown_commits() {
    let f = forked_repo();
    for bad in ["has space", "a..b", "-dash", "end.lock", ""] {
        assert_refused(
            git_branch_create_impl(p(&f.dir), bad, &f.base, false),
            "invalid_name",
        );
    }
    assert_refused(
        git_branch_create_impl(p(&f.dir), "feature", &f.base, false),
        "already_exists",
    );
    assert_refused(
        git_branch_create_impl(p(&f.dir), "ok", &"2".repeat(40), false),
        "not_found",
    );
}

#[test]
fn renaming_the_current_branch_keeps_its_upstream_and_head() {
    let f = forked_repo();
    let d = f.dir.path();
    git_ok(
        d,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    git_ok(d, &["update-ref", "refs/remotes/origin/main", &f.main1]);
    git_ok(d, &["branch", "--set-upstream-to=origin/main", "main"]);

    git_branch_rename_impl(p(&f.dir), "main", "trunk").unwrap();

    assert_eq!(head_ref(&f.dir), "refs/heads/trunk");
    assert_eq!(git_ok(d, &["config", "branch.trunk.remote"]), "origin");
    assert_eq!(
        git_ok(d, &["config", "branch.trunk.merge"]),
        "refs/heads/main"
    );
    assert!(!git(d, &["rev-parse", "--verify", "-q", "main"])
        .status
        .success());
}

#[test]
fn rename_refuses_unknown_taken_and_invalid_names() {
    let f = forked_repo();
    assert_refused(git_branch_rename_impl(p(&f.dir), "ghost", "x"), "not_found");
    assert_refused(
        git_branch_rename_impl(p(&f.dir), "feature", "main"),
        "already_exists",
    );
    assert_refused(
        git_branch_rename_impl(p(&f.dir), "feature", "bad name"),
        "invalid_name",
    );
    assert_eq!(rev(&f.dir, "feature"), f.feature1);
}

#[test]
fn the_current_branch_cannot_be_deleted_even_when_forced() {
    let f = forked_repo();
    assert_refused(
        git_branch_delete_impl(p(&f.dir), "main", false),
        "current_branch",
    );
    assert_refused(
        git_branch_delete_impl(p(&f.dir), "main", true),
        "current_branch",
    );
    assert_eq!(rev(&f.dir, "main"), f.merge);
}

#[test]
fn deleting_a_merged_branch_needs_no_force() {
    let f = forked_repo();
    git_branch_delete_impl(p(&f.dir), "feature", false).unwrap();
    assert!(
        !git(f.dir.path(), &["rev-parse", "--verify", "-q", "feature"])
            .status
            .success()
    );
}

#[test]
fn deleting_an_unmerged_branch_is_not_merged_until_forced() {
    let dir = main_repo();
    git_ok(dir.path(), &["checkout", "-qb", "wip"]);
    commit_file(&dir, "w.txt", "w", "unmerged work");
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    let tip = rev(&dir, "wip");

    assert_refused(git_branch_delete_impl(p(&dir), "wip", false), "not_merged");
    assert_eq!(rev(&dir, "wip"), tip, "a refused delete changes nothing");

    git_branch_delete_impl(p(&dir), "wip", true).unwrap();
    assert!(!git(dir.path(), &["rev-parse", "--verify", "-q", "wip"])
        .status
        .success());
}

#[test]
fn a_branch_that_is_only_on_its_upstream_counts_as_merged() {
    let dir = main_repo();
    let d = dir.path();
    git_ok(d, &["checkout", "-qb", "wip"]);
    commit_file(&dir, "w.txt", "w", "pushed work");
    let tip = rev(&dir, "wip");
    git_ok(d, &["checkout", "-q", "main"]);
    git_ok(
        d,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    git_ok(d, &["update-ref", "refs/remotes/origin/wip", &tip]);
    git_ok(d, &["branch", "--set-upstream-to=origin/wip", "wip"]);

    git_branch_delete_impl(p(&dir), "wip", false).unwrap();
}

#[test]
fn deleting_an_unknown_branch_is_not_found() {
    let f = forked_repo();
    assert_refused(
        git_branch_delete_impl(p(&f.dir), "ghost", false),
        "not_found",
    );
}

// ---- tags -----------------------------------------------------------------

#[test]
fn a_lightweight_tag_points_straight_at_the_commit() {
    let f = forked_repo();
    git_tag_create_impl(p(&f.dir), "v1", &f.main1, None).unwrap();
    assert_eq!(git_ok(f.dir.path(), &["cat-file", "-t", "v1"]), "commit");
    assert_eq!(rev(&f.dir, "v1^{commit}"), f.main1);
}

#[test]
fn a_tag_with_a_message_is_annotated() {
    let f = forked_repo();
    git_tag_create_impl(p(&f.dir), "v2", &f.base, Some("second release")).unwrap();
    assert_eq!(git_ok(f.dir.path(), &["cat-file", "-t", "v2"]), "tag");
    assert_eq!(rev(&f.dir, "v2^{commit}"), f.base);
    assert!(git_ok(f.dir.path(), &["tag", "-n", "v2"]).contains("second release"));
}

#[test]
fn a_blank_message_makes_a_lightweight_tag() {
    let f = forked_repo();
    git_tag_create_impl(p(&f.dir), "v3", &f.base, Some("   ")).unwrap();
    assert_eq!(git_ok(f.dir.path(), &["cat-file", "-t", "v3"]), "commit");
}

#[test]
fn tag_create_refuses_bad_names_duplicates_and_unknown_commits() {
    let f = forked_repo();
    git_tag_create_impl(p(&f.dir), "v1", &f.base, None).unwrap();
    assert_refused(
        git_tag_create_impl(p(&f.dir), "v1", &f.base, None),
        "already_exists",
    );
    assert_refused(
        git_tag_create_impl(p(&f.dir), "bad name", &f.base, None),
        "invalid_name",
    );
    assert_refused(
        git_tag_create_impl(p(&f.dir), "a..b", &f.base, None),
        "invalid_name",
    );
    assert_refused(
        git_tag_create_impl(p(&f.dir), "ok", &"3".repeat(40), None),
        "not_found",
    );
}

#[test]
fn tag_delete_removes_the_tag_and_refuses_an_unknown_one() {
    let f = forked_repo();
    git_tag_create_impl(p(&f.dir), "v1", &f.base, None).unwrap();
    git_tag_delete_impl(p(&f.dir), "v1").unwrap();
    assert_eq!(git_ok(f.dir.path(), &["tag", "-l"]), "");
    assert_refused(git_tag_delete_impl(p(&f.dir), "v1"), "not_found");
}

// ---- cherry-pick and revert -----------------------------------------------

#[tokio::test]
async fn a_clean_cherry_pick_adds_one_commit_and_reports_it() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["checkout", "-q", "--detach", &f.base]);
    git_ok(f.dir.path(), &["checkout", "-qB", "target"]);

    // Same parent, tree, author and second would hash to the original commit.
    let later = [(
        "GIT_COMMITTER_DATE".to_string(),
        "2031-01-01T00:00:00Z".to_string(),
    )];
    let result = git_pick_impl(
        p(&f.dir),
        &f.main1,
        PickKind::CherryPick,
        &git_bin().await,
        &later,
    )
    .await
    .unwrap();

    assert!(result.clean && result.conflicts.is_empty());
    assert_eq!(result.new_oid, Some(rev(&f.dir, "HEAD")));
    assert_ne!(result.new_oid.as_deref(), Some(f.main1.as_str()));
    assert_eq!(file(&f.dir, "main.txt"), "m\n");
    assert_eq!(git_ok(f.dir.path(), &["log", "-1", "--format=%s"]), "main1");
    assert_eq!(git_ok(f.dir.path(), &["rev-parse", "HEAD~1"]), f.base);
}

#[tokio::test]
async fn a_conflicting_cherry_pick_stops_in_the_state_the_merge_panel_understands() {
    let (dir, other) = conflicting_repo();

    let result = pick(&dir, &other, PickKind::CherryPick).await.unwrap();

    assert!(!result.clean);
    assert_eq!(result.conflicts, vec!["a.txt".to_string()]);
    assert_eq!(result.new_oid, None);
    assert_eq!(git_refs_impl(p(&dir)).unwrap().operation, "cherry-pick");

    let aborted = git_operation_step_impl(
        p(&dir),
        "abort",
        &git_bin().await,
        &[],
        Duration::from_secs(60),
    )
    .await
    .unwrap();
    assert_eq!(aborted.outcome, "done");
    assert_eq!(git_refs_impl(p(&dir)).unwrap().operation, "none");
    assert_eq!(file(&dir, "a.txt"), "main\n");
}

#[tokio::test]
async fn cherry_pick_of_a_merge_commit_uses_the_first_parent_line() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["checkout", "-q", "--detach", &f.base]);
    git_ok(f.dir.path(), &["checkout", "-qB", "target"]);

    let result = pick(&f.dir, &f.merge, PickKind::CherryPick).await.unwrap();

    assert!(result.clean);
    // -m 1 replays what the merge brought in relative to main: feature.txt.
    assert_eq!(file(&f.dir, "feature.txt"), "f\n");
    assert!(!f.dir.path().join("main.txt").exists());
}

#[tokio::test]
async fn cherry_pick_and_revert_refuse_a_dirty_tracked_file_but_not_an_untracked_one() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["checkout", "-q", "--detach", &f.base]);
    fs::write(f.dir.path().join("stray.txt"), "untracked").unwrap();
    let clean_enough = pick(&f.dir, &f.main1, PickKind::CherryPick).await;
    assert!(clean_enough.unwrap().clean);

    fs::write(f.dir.path().join("a.txt"), "dirty").unwrap();
    for kind in [PickKind::CherryPick, PickKind::Revert] {
        let refusal = pick(&f.dir, &f.feature1, kind).await.unwrap_err();
        assert!(refusal.starts_with("dirty_worktree: "), "{refusal}");
    }
    assert_eq!(file(&f.dir, "a.txt"), "dirty");
}

#[tokio::test]
async fn a_staged_change_counts_as_dirty_too() {
    let f = forked_repo();
    fs::write(f.dir.path().join("staged.txt"), "x").unwrap();
    git_ok(f.dir.path(), &["add", "staged.txt"]);
    let refusal = pick(&f.dir, &f.feature1, PickKind::CherryPick)
        .await
        .unwrap_err();
    assert!(refusal.starts_with("dirty_worktree: "), "{refusal}");
}

#[tokio::test]
async fn a_clean_revert_adds_a_commit_that_undoes_the_change() {
    let f = forked_repo();
    let result = pick(&f.dir, &f.main1, PickKind::Revert).await.unwrap();

    assert!(result.clean);
    assert_eq!(result.new_oid, Some(rev(&f.dir, "HEAD")));
    assert!(!f.dir.path().join("main.txt").exists());
    assert_eq!(
        git_ok(f.dir.path(), &["log", "-1", "--format=%s"]),
        "Revert \"main1\""
    );
}

#[tokio::test]
async fn reverting_a_merge_commit_undoes_what_it_brought_in() {
    let f = forked_repo();
    let result = pick(&f.dir, &f.merge, PickKind::Revert).await.unwrap();

    assert!(result.clean);
    assert!(!f.dir.path().join("feature.txt").exists());
    assert_eq!(file(&f.dir, "main.txt"), "m\n");
}

#[tokio::test]
async fn a_conflicting_revert_reports_the_conflicted_files() {
    let (dir, _) = conflicting_repo();
    commit_file(&dir, "a.txt", "later\n", "later change");
    let target = git_ok(dir.path(), &["rev-parse", "HEAD~1"]);

    let result = pick(&dir, &target, PickKind::Revert).await.unwrap();

    assert!(!result.clean);
    assert_eq!(result.conflicts, vec!["a.txt".to_string()]);
    assert_eq!(git_refs_impl(p(&dir)).unwrap().operation, "revert");
}

#[tokio::test]
async fn picking_an_unknown_commit_is_not_found() {
    let f = forked_repo();
    let refusal = pick(&f.dir, &"4".repeat(40), PickKind::CherryPick)
        .await
        .unwrap_err();
    assert!(refusal.starts_with("not_found: "), "{refusal}");
}

#[tokio::test]
async fn an_already_applied_pick_is_aborted_and_answered_already_applied() {
    let f = forked_repo();
    // main1 is already in main's history: git stops with an empty pick.
    let refusal = pick(&f.dir, &f.main1, PickKind::CherryPick)
        .await
        .unwrap_err();

    assert_eq!(
        refusal,
        "already_applied: This change is already on main. Nothing was picked."
    );
    assert_eq!(git_refs_impl(p(&f.dir)).unwrap().operation, "none");
    assert_eq!(rev(&f.dir, "HEAD"), f.merge);
}

#[tokio::test]
async fn reverting_what_is_already_undone_is_answered_already_applied() {
    let f = forked_repo();
    pick(&f.dir, &f.main1, PickKind::Revert).await.unwrap();
    let refusal = pick(&f.dir, &f.main1, PickKind::Revert).await.unwrap_err();

    assert!(refusal.starts_with("already_applied: "), "{refusal}");
    assert!(refusal.contains("already undone on main"), "{refusal}");
    assert_eq!(git_refs_impl(p(&f.dir)).unwrap().operation, "none");
}

#[tokio::test]
async fn a_failure_with_nothing_left_open_does_not_tell_the_user_to_continue() {
    let dir = main_repo();
    git_ok(dir.path(), &["checkout", "-qb", "other"]);
    commit_file(&dir, "new.txt", "from other\n", "add new");
    let other = rev(&dir, "HEAD");
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    fs::write(dir.path().join("new.txt"), "mine\n").unwrap();

    let refusal = pick(&dir, &other, PickKind::CherryPick).await.unwrap_err();

    assert!(refusal.starts_with("git_failed: "), "{refusal}");
    assert!(
        refusal.contains("untracked file is in the way"),
        "{refusal}"
    );
    for stale in ["continue", "abort", "Skip"] {
        assert!(!refusal.contains(stale), "{refusal}");
    }
    assert_eq!(git_refs_impl(p(&dir)).unwrap().operation, "none");
    assert_eq!(file(&dir, "new.txt"), "mine\n");
}

// ---- one operation at a time ----------------------------------------------

#[tokio::test]
async fn every_write_is_refused_while_a_cherry_pick_is_conflicted() {
    let (dir, other) = conflicting_repo();
    assert!(
        !pick(&dir, &other, PickKind::CherryPick)
            .await
            .unwrap()
            .clean
    );
    let before = git_ok(dir.path(), &["for-each-ref"]);

    let writes: Vec<(&str, Result<(), String>)> = vec![
        ("checkout", git_checkout_impl(p(&dir), "refs/heads/other")),
        (
            "branch create",
            git_branch_create_impl(p(&dir), "x", &other, false),
        ),
        (
            "branch rename",
            git_branch_rename_impl(p(&dir), "other", "y"),
        ),
        (
            "branch delete",
            git_branch_delete_impl(p(&dir), "other", true),
        ),
        (
            "tag create",
            git_tag_create_impl(p(&dir), "t", &other, None),
        ),
        ("tag delete", git_tag_delete_impl(p(&dir), "t")),
        (
            "cherry-pick",
            pick(&dir, &other, PickKind::CherryPick).await.map(|_| ()),
        ),
        (
            "revert",
            pick(&dir, &other, PickKind::Revert).await.map(|_| ()),
        ),
    ];

    for (name, result) in writes {
        let refusal = result.expect_err(name);
        assert!(
            refusal.starts_with("operation_in_progress: "),
            "{name}: {refusal}"
        );
    }
    assert_eq!(git_ok(dir.path(), &["for-each-ref"]), before);
}

// ---- names that git itself would refuse -----------------------------------

/// `work` is checked out; `feature/x` and `other/deep/y` exist as loose refs.
fn clash_repo() -> TempDir {
    let dir = main_repo();
    let d = dir.path();
    git_ok(d, &["branch", "feature/x"]);
    git_ok(d, &["branch", "other/deep/y"]);
    git_ok(d, &["checkout", "-qb", "work"]);
    dir
}

fn assert_clash_left_nothing_behind(dir: &TempDir) {
    assert_eq!(head_ref(dir), "refs/heads/work");
    for branch in ["work", "feature/x", "other/deep/y"] {
        assert!(
            git(dir.path(), &["rev-parse", "--verify", "-q", branch])
                .status
                .success(),
            "{branch} must survive"
        );
    }
}

#[test]
fn renaming_onto_a_directory_clash_is_refused_and_loses_nothing() {
    let dir = clash_repo();
    assert_refused(
        git_branch_rename_impl(p(&dir), "work", "feature"),
        "already_exists",
    );
    assert_refused(
        git_branch_rename_impl(p(&dir), "work", "other/deep"),
        "already_exists",
    );
    assert_refused(
        git_branch_rename_impl(p(&dir), "work", "feature/x/z"),
        "already_exists",
    );
    assert_clash_left_nothing_behind(&dir);
}

#[test]
fn creating_a_branch_that_clashes_with_a_directory_or_a_file_is_refused() {
    let dir = clash_repo();
    let head = rev(&dir, "HEAD");
    assert_refused(
        git_branch_create_impl(p(&dir), "feature", &head, false),
        "already_exists",
    );
    assert_refused(
        git_branch_create_impl(p(&dir), "feature/x/z", &head, false),
        "already_exists",
    );
    assert_clash_left_nothing_behind(&dir);
}

#[test]
fn a_remote_checkout_whose_local_name_clashes_is_refused() {
    let dir = clash_repo();
    git_ok(
        dir.path(),
        &[
            "update-ref",
            "refs/remotes/origin/feature",
            &rev(&dir, "HEAD"),
        ],
    );
    assert_refused(
        git_checkout_impl(p(&dir), "refs/remotes/origin/feature"),
        "already_exists",
    );
    assert_clash_left_nothing_behind(&dir);
}

#[test]
fn renaming_a_branch_out_of_its_own_directory_is_allowed() {
    let dir = clash_repo();
    git_branch_rename_impl(p(&dir), "feature/x", "feature").unwrap();
    assert!(git(dir.path(), &["rev-parse", "--verify", "-q", "feature"])
        .status
        .success());
}

#[test]
fn names_with_control_characters_or_a_leading_dash_are_invalid() {
    let f = forked_repo();
    for bad in ["a\u{7f}", "a\tb", "-x", "--force"] {
        assert_refused(
            git_branch_create_impl(p(&f.dir), bad, &f.base, false),
            "invalid_name",
        );
        assert_refused(
            git_tag_create_impl(p(&f.dir), bad, &f.base, None),
            "invalid_name",
        );
        assert_refused(
            git_branch_rename_impl(p(&f.dir), "feature", bad),
            "invalid_name",
        );
    }
    for bad in ["a\u{7f}", "-x"] {
        assert!(
            !git(f.dir.path(), &["check-ref-format", "--branch", bad])
                .status
                .success(),
            "real git agrees {bad:?} is bad"
        );
    }
}

#[test]
fn a_branch_with_an_upstream_is_judged_against_the_upstream_like_git_branch_d() {
    let dir = main_repo();
    let d = dir.path();
    git_ok(d, &["checkout", "-qb", "wip"]);
    commit_file(&dir, "w.txt", "w", "work");
    git_ok(d, &["checkout", "-q", "main"]);
    git_ok(d, &["merge", "-q", "--ff-only", "wip"]);
    git_ok(
        d,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/repo.git",
        ],
    );
    git_ok(
        d,
        &[
            "update-ref",
            "refs/remotes/origin/wip",
            &rev(&dir, "main~1"),
        ],
    );
    git_ok(d, &["branch", "--set-upstream-to=origin/wip", "wip"]);

    // In HEAD, but not on the upstream: `git branch -d` refuses, so do we.
    assert!(!git(d, &["branch", "-d", "wip"]).status.success());
    assert_refused(git_branch_delete_impl(p(&dir), "wip", false), "not_merged");
}

#[tokio::test]
async fn the_in_progress_sentence_names_the_operation() {
    let (dir, other) = conflicting_repo();
    pick(&dir, &other, PickKind::CherryPick).await.unwrap();
    let refusal = git_checkout_impl(p(&dir), "refs/heads/other").unwrap_err();
    assert_eq!(
        refusal,
        "operation_in_progress: A cherry-pick is in progress. Finish or abort it first."
    );
}

#[test]
fn every_inherited_git_variable_is_stripped_before_git_runs() {
    use crate::git::operation_step::inherited_git_vars;
    let vars = [
        "PATH",
        "GIT_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_CONFIG_COUNT",
        "HOME",
    ];
    let stripped = inherited_git_vars(vars.iter().map(|v| v.to_string()));
    assert_eq!(
        stripped,
        ["GIT_DIR", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_COUNT"]
    );
}

#[test]
fn the_login_env_loses_repo_location_vars_but_keeps_identity_and_path() {
    use crate::git::operation_step::without_repo_location_vars;
    let pair = |k: &str| (k.to_string(), "v".to_string());
    let login = [
        "PATH",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_COMMON_DIR",
        "GIT_AUTHOR_NAME",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ]
    .map(pair);
    let kept: Vec<String> = without_repo_location_vars(&login)
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    assert_eq!(kept, ["PATH", "GIT_AUTHOR_NAME"]);
}
