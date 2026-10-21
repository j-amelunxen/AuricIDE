//! The graph walk, the ref listing and commit detail, against real
//! repositories. Where git semantics matter the real `git` is the oracle.

use super::*;
use crate::git::diff::git_diff_commit_parent_impl;
use crate::git::graph::*;
use std::collections::HashSet;
use std::process::Output;
use tempfile::TempDir;

pub(super) fn git(dir: &Path, args: &[&str]) -> Output {
    git_command(dir).args(args).output().unwrap()
}

pub(super) fn git_ok(dir: &Path, args: &[&str]) -> String {
    let out = git(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

pub(super) fn p(dir: &TempDir) -> &str {
    dir.path().to_str().unwrap()
}

/// A repo whose first branch is `main`, with one commit "base" on a.txt.
pub(super) fn main_repo() -> TempDir {
    let dir = init_test_repo();
    git_ok(dir.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);
    commit_file(&dir, "a.txt", "base\n", "base");
    dir
}

pub(super) fn rev(dir: &TempDir, spec: &str) -> String {
    git_ok(dir.path(), &["rev-parse", spec])
}

/// base ── main1 ───────── merge   (main)
///    └─── feature1 ───────┘       (feature)
pub(super) struct Forked {
    pub dir: TempDir,
    pub base: String,
    pub main1: String,
    pub feature1: String,
    pub merge: String,
}

pub(super) fn forked_repo() -> Forked {
    let dir = main_repo();
    let base = rev(&dir, "HEAD");
    git_ok(dir.path(), &["checkout", "-qb", "feature"]);
    commit_file(&dir, "feature.txt", "f\n", "feature1");
    let feature1 = rev(&dir, "HEAD");
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    commit_file(&dir, "main.txt", "m\n", "main1");
    let main1 = rev(&dir, "HEAD");
    git_ok(
        dir.path(),
        &["merge", "--no-ff", "-qm", "merge feature", "feature"],
    );
    let merge = rev(&dir, "HEAD");
    Forked {
        dir,
        base,
        main1,
        feature1,
        merge,
    }
}

fn oids(page: &GraphPage) -> Vec<String> {
    page.commits.iter().map(|c| c.oid.clone()).collect()
}

fn position(list: &[String], oid: &str) -> usize {
    list.iter().position(|o| o == oid).unwrap()
}

#[test]
fn the_walk_is_topological_across_a_fork_and_a_merge() {
    let f = forked_repo();
    let page = git_graph_log_impl(p(&f.dir), 0, 100).unwrap();
    let order = oids(&page);

    assert_eq!(order.len(), 4);
    assert_eq!(order[0], f.merge);
    for commit in &page.commits {
        for parent in &commit.parents {
            assert!(
                position(&order, &commit.oid) < position(&order, parent),
                "{} must come before its parent {parent}",
                commit.oid
            );
        }
    }
    assert_eq!(order.last().unwrap(), &f.base);
    let merge = &page.commits[0];
    assert_eq!(merge.parents, vec![f.main1.clone(), f.feature1.clone()]);
    assert_eq!(merge.summary, "merge feature");
    assert_eq!(merge.author_name, "Test");
    assert_eq!(merge.author_email, "test@test.com");
}

#[test]
fn the_walk_reaches_branches_remotes_and_tags_that_head_does_not() {
    let dir = main_repo();
    let d = dir.path();
    git_ok(d, &["checkout", "-qb", "side"]);
    commit_file(&dir, "s.txt", "s", "only on side");
    let side = rev(&dir, "HEAD");
    git_ok(d, &["checkout", "-q", "--detach"]);
    commit_file(&dir, "t.txt", "t", "only tagged");
    let tagged = rev(&dir, "HEAD");
    git_ok(d, &["tag", "v1"]);
    commit_file(&dir, "r.txt", "r", "only remote");
    let remote = rev(&dir, "HEAD");
    git_ok(d, &["update-ref", "refs/remotes/origin/work", &remote]);
    git_ok(d, &["checkout", "-q", "main"]);

    let seen: HashSet<String> = oids(&git_graph_log_impl(p(&dir), 0, 100).unwrap())
        .into_iter()
        .collect();

    for (what, oid) in [("branch", side), ("tag", tagged), ("remote", remote)] {
        assert!(
            seen.contains(&oid),
            "the {what} tip is missing from the walk"
        );
    }
}

#[test]
fn an_annotated_tag_adds_its_commit_not_the_tag_object() {
    let dir = main_repo();
    git_ok(dir.path(), &["tag", "-a", "v1", "-m", "release"]);
    let page = git_graph_log_impl(p(&dir), 0, 100).unwrap();
    assert_eq!(oids(&page), vec![rev(&dir, "HEAD")]);
}

#[test]
fn a_tag_on_a_tree_is_skipped_without_failing_the_walk() {
    let dir = main_repo();
    git_ok(dir.path(), &["tag", "tree-tag", "HEAD^{tree}"]);
    let page = git_graph_log_impl(p(&dir), 0, 100).unwrap();
    assert_eq!(page.commits.len(), 1);
    let refs = git_refs_impl(p(&dir)).unwrap();
    assert!(refs.refs.iter().all(|r| r.shorthand != "tree-tag"));
}

#[test]
fn pages_concatenate_to_the_same_sequence_as_one_big_page() {
    let f = forked_repo();
    for n in 0..7 {
        commit_file(&f.dir, "n.txt", &format!("{n}"), &format!("n{n}"));
    }
    let whole = git_graph_log_impl(p(&f.dir), 0, 100).unwrap();
    assert!(!whole.has_more);

    let mut stitched = Vec::new();
    let mut skip = 0;
    loop {
        let page = git_graph_log_impl(p(&f.dir), skip, 3).unwrap();
        skip += page.commits.len();
        stitched.extend(oids(&page));
        if !page.has_more {
            break;
        }
    }
    assert_eq!(stitched, oids(&whole));
    assert_eq!(stitched.len(), 11);
}

#[test]
fn has_more_is_false_when_the_page_ends_exactly_on_the_last_commit() {
    let f = forked_repo();
    assert!(!git_graph_log_impl(p(&f.dir), 0, 4).unwrap().has_more);
    assert!(git_graph_log_impl(p(&f.dir), 0, 3).unwrap().has_more);
    let past_the_end = git_graph_log_impl(p(&f.dir), 4, 3).unwrap();
    assert!(past_the_end.commits.is_empty() && !past_the_end.has_more);
}

#[test]
fn the_limit_is_clamped_to_one_through_five_hundred() {
    let f = forked_repo();
    assert_eq!(
        git_graph_log_impl(p(&f.dir), 0, 0).unwrap().commits.len(),
        1
    );
    assert_eq!(
        git_graph_log_impl(p(&f.dir), 0, usize::MAX)
            .unwrap()
            .commits
            .len(),
        4
    );
}

#[test]
fn an_unborn_repository_is_an_empty_page_not_an_error() {
    let dir = init_test_repo();
    let page = git_graph_log_impl(p(&dir), 0, 50).unwrap();
    assert!(page.commits.is_empty() && !page.has_more);
}

#[test]
fn a_folder_that_is_not_a_repository_is_an_empty_page() {
    let plain = TempDir::new().unwrap();
    let page = git_graph_log_impl(p(&plain), 0, 50).unwrap();
    assert!(page.commits.is_empty() && !page.has_more);
}

#[test]
fn refs_are_ordered_head_current_locals_remotes_tags() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["tag", "v1", &f.base]);
    git_ok(f.dir.path(), &["tag", "-a", "v0", "-m", "zero", &f.base]);
    git_ok(
        f.dir.path(),
        &["update-ref", "refs/remotes/origin/main", &f.main1],
    );
    git_ok(
        f.dir.path(),
        &["update-ref", "refs/remotes/origin/HEAD", &f.main1],
    );

    let refs = git_refs_impl(p(&f.dir)).unwrap();
    let names: Vec<&str> = refs.refs.iter().map(|r| r.name.as_str()).collect();

    assert_eq!(
        names,
        [
            "HEAD",
            "refs/heads/main",
            "refs/heads/feature",
            "refs/remotes/origin/main",
            "refs/tags/v0",
            "refs/tags/v1",
        ]
    );
    assert!(!refs.head_detached);
    assert_eq!(refs.head_oid.as_deref(), Some(f.merge.as_str()));
    assert_eq!(refs.operation, "none");
}

#[test]
fn refs_mark_only_the_checked_out_branch_as_current_and_peel_annotated_tags() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["tag", "-a", "v0", "-m", "zero", &f.base]);
    let refs = git_refs_impl(p(&f.dir)).unwrap();
    let by_name = |n: &str| refs.refs.iter().find(|r| r.name == n).unwrap();

    assert!(by_name("refs/heads/main").is_current);
    assert!(!by_name("refs/heads/feature").is_current);
    assert!(!by_name("HEAD").is_current);
    assert_eq!(by_name("HEAD").kind, "head");
    assert_eq!(by_name("refs/heads/feature").kind, "local");
    assert_eq!(by_name("refs/heads/feature").target, f.feature1);
    let tag = by_name("refs/tags/v0");
    assert_eq!((tag.kind.as_str(), tag.shorthand.as_str()), ("tag", "v0"));
    assert_eq!(tag.target, f.base);
}

/// `origin` as a name only: libgit2 resolves an upstream through the remote's refspec.
fn track_origin(dir: &TempDir, branch: &str, remote_tip: &str) {
    let d = dir.path();
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
            &format!("refs/remotes/origin/{branch}"),
            remote_tip,
        ],
    );
    git_ok(
        d,
        &[
            "branch",
            &format!("--set-upstream-to=origin/{branch}"),
            branch,
        ],
    );
}

fn counts_of(dir: &TempDir, branch: &str) -> (Option<u32>, Option<u32>) {
    let refs = git_refs_impl(p(dir)).unwrap();
    let entry = refs.refs.iter().find(|r| r.shorthand == branch).unwrap();
    (entry.ahead, entry.behind)
}

#[test]
fn a_local_branch_reports_ahead_and_behind_its_upstream() {
    let f = forked_repo();
    track_origin(&f.dir, "main", &f.main1);

    let refs = git_refs_impl(p(&f.dir)).unwrap();
    let main = refs
        .refs
        .iter()
        .find(|r| r.name == "refs/heads/main")
        .unwrap();
    assert_eq!(main.upstream.as_deref(), Some("origin/main"));
    // The merge and feature1 are on main but not on origin/main.
    assert_eq!(counts_of(&f.dir, "main"), (Some(2), Some(0)));

    git_ok(
        f.dir.path(),
        &["update-ref", "refs/remotes/origin/main", &f.base],
    );
    assert_eq!(counts_of(&f.dir, "main"), (Some(3), Some(0)));
}

#[test]
fn a_branch_without_upstream_has_no_ahead_or_behind() {
    let f = forked_repo();
    let refs = git_refs_impl(p(&f.dir)).unwrap();
    let feature = refs
        .refs
        .iter()
        .find(|r| r.name == "refs/heads/feature")
        .unwrap();
    assert_eq!(
        (&feature.upstream, feature.ahead, feature.behind),
        (&None, None, None)
    );
}

#[test]
fn ahead_and_behind_match_the_real_git() {
    let f = forked_repo();
    track_origin(&f.dir, "feature", &f.main1);

    let counts = git_ok(
        f.dir.path(),
        &[
            "rev-list",
            "--left-right",
            "--count",
            "feature...origin/feature",
        ],
    );
    let (ahead, behind) = counts.split_once('\t').unwrap();
    assert_eq!(
        counts_of(&f.dir, "feature"),
        (Some(ahead.parse().unwrap()), Some(behind.parse().unwrap()))
    );
    assert_eq!(counts_of(&f.dir, "feature"), (Some(1), Some(1)));
}

#[test]
fn a_detached_head_has_no_current_branch() {
    let f = forked_repo();
    git_ok(f.dir.path(), &["checkout", "-q", "--detach", &f.main1]);
    let refs = git_refs_impl(p(&f.dir)).unwrap();
    assert!(refs.head_detached);
    assert_eq!(refs.head_oid.as_deref(), Some(f.main1.as_str()));
    assert!(refs.refs.iter().all(|r| !r.is_current));
    assert_eq!(refs.refs[0].name, "HEAD");
    assert_eq!(refs.refs[0].target, f.main1);
}

#[test]
fn an_unborn_repository_has_no_head_ref() {
    let dir = init_test_repo();
    let refs = git_refs_impl(p(&dir)).unwrap();
    assert!(refs.refs.is_empty());
    assert_eq!(refs.head_oid, None);
    assert!(!refs.head_detached);
}

#[test]
fn the_operation_is_named_while_a_cherry_pick_is_conflicted() {
    let dir = main_repo();
    let d = dir.path();
    git_ok(d, &["checkout", "-qb", "other"]);
    commit_file(&dir, "a.txt", "other\n", "other change");
    let other = rev(&dir, "HEAD");
    git_ok(d, &["checkout", "-q", "main"]);
    commit_file(&dir, "a.txt", "main\n", "main change");
    assert!(!git(d, &["cherry-pick", &other]).status.success());

    assert_eq!(git_refs_impl(p(&dir)).unwrap().operation, "cherry-pick");
}

#[test]
fn detail_of_a_root_commit_lists_everything_as_added() {
    let dir = main_repo();
    let detail = git_commit_detail_impl(p(&dir), &rev(&dir, "HEAD"), 0).unwrap();
    assert!(detail.parents.is_empty());
    assert_eq!(detail.message, "base");
    assert_eq!(
        detail
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.status.as_str()))
            .collect::<Vec<_>>(),
        [("a.txt", "added")]
    );
}

#[test]
fn detail_of_a_merge_depends_on_the_chosen_parent() {
    let f = forked_repo();
    let files = |index| {
        let detail = git_commit_detail_impl(p(&f.dir), &f.merge, index).unwrap();
        detail
            .files
            .iter()
            .map(|x| x.path.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(files(0), ["feature.txt"]);
    assert_eq!(files(1), ["main.txt"]);
    let first = git_ok(
        f.dir.path(),
        &["diff", "--name-only", &format!("{}^1", f.merge), &f.merge],
    );
    assert_eq!(files(0), [first]);
}

#[test]
fn detail_carries_author_committer_times_and_a_trimmed_message() {
    let dir = main_repo();
    commit_file(&dir, "b.txt", "b", "subject\n\nbody line\n\n");
    let detail = git_commit_detail_impl(p(&dir), &rev(&dir, "HEAD"), 0).unwrap();
    assert_eq!(detail.message, "subject\n\nbody line");
    assert_eq!(detail.author_name, "Test");
    assert_eq!(detail.committer_email, "test@test.com");
    let real = git_ok(dir.path(), &["log", "-1", "--format=%at %ct"]);
    assert_eq!(
        real,
        format!("{} {}", detail.author_time, detail.committer_time)
    );
    assert_eq!(detail.files[0].status, "added");
}

#[test]
fn detail_marks_modified_and_deleted_files() {
    let dir = main_repo();
    commit_file(&dir, "b.txt", "b", "add b");
    std::fs::write(dir.path().join("a.txt"), "changed\n").unwrap();
    git_ok(dir.path(), &["rm", "-q", "b.txt"]);
    commit_all(dir.path(), "edit a, drop b");
    let detail = git_commit_detail_impl(p(&dir), &rev(&dir, "HEAD"), 0).unwrap();
    let status = |path: &str| {
        detail
            .files
            .iter()
            .find(|f| f.path == path)
            .unwrap()
            .status
            .clone()
    };
    assert_eq!(
        (status("a.txt").as_str(), status("b.txt").as_str()),
        ("modified", "deleted")
    );
}

#[test]
fn detail_of_an_unknown_commit_or_parent_is_not_found() {
    let f = forked_repo();
    let unknown = git_commit_detail_impl(p(&f.dir), &"0".repeat(40), 0).unwrap_err();
    assert!(unknown.starts_with("not_found: "), "{unknown}");
    let garbage = git_commit_detail_impl(p(&f.dir), "not-an-oid", 0).unwrap_err();
    assert!(garbage.starts_with("not_found: "), "{garbage}");
    let no_such_parent = git_commit_detail_impl(p(&f.dir), &f.main1, 1).unwrap_err();
    assert!(
        no_such_parent.starts_with("not_found: "),
        "{no_such_parent}"
    );
}

#[test]
fn the_commit_diff_can_be_taken_against_the_second_parent() {
    let f = forked_repo();
    let first = git_diff_commit_parent_impl(p(&f.dir), &f.merge, "feature.txt", 0).unwrap();
    let second = git_diff_commit_parent_impl(p(&f.dir), &f.merge, "feature.txt", 1).unwrap();
    assert!(first.contains("+f"));
    assert_eq!(second, "");
}
