use super::*;
use crate::git::blame::git_blame_impl;
use crate::git::diff::*;
use crate::git::log::git_log_since_impl;
use tempfile::TempDir;

#[test]
fn test_git_diff_untracked_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "tracked.txt", "hello", "init");
    fs::write(dir.path().join("untracked.txt"), "new file content\n").unwrap();

    let diff = git_diff_impl(repo_path, "untracked.txt", None).unwrap();
    assert!(diff.contains("--- /dev/null"));
    assert!(diff.contains("+++ b/untracked.txt"));
    assert!(diff.contains("+new file content"));
}

#[test]
fn test_git_diff_modified_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "line 1\nline 2\n", "init");
    fs::write(dir.path().join("file.txt"), "line 1\nline 2 modified\n").unwrap();

    let diff = git_diff_impl(repo_path, "file.txt", None).unwrap();
    assert!(diff.contains("-line 2"));
    assert!(diff.contains("+line 2 modified"));
}

#[test]
fn test_git_diff_deleted_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "delete_me.txt", "bye\n", "init");
    fs::remove_file(dir.path().join("delete_me.txt")).unwrap();

    let diff = git_diff_impl(repo_path, "delete_me.txt", None).unwrap();
    assert!(diff.contains("--- a/delete_me.txt"));
    assert!(diff.contains("+++ /dev/null"));
    assert!(diff.contains("-bye"));
}

#[test]
fn test_git_diff_no_changes() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "clean.txt", "unchanged\n", "init");

    let diff = git_diff_impl(repo_path, "clean.txt", None).unwrap();
    assert!(diff.is_empty());
}

#[test]
fn git_diff_impl_side_splits_a_both_sides_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "v1\n", "init");
    fs::write(dir.path().join("file.txt"), "v2\n").unwrap();
    git_stage_impl(repo_path, &["file.txt".to_string()]).unwrap();
    fs::write(dir.path().join("file.txt"), "v3\n").unwrap();

    let staged = git_diff_impl(repo_path, "file.txt", Some("staged")).unwrap();
    let unstaged = git_diff_impl(repo_path, "file.txt", Some("unstaged")).unwrap();
    let combined = git_diff_impl(repo_path, "file.txt", None).unwrap();

    assert_ne!(staged, unstaged);
    assert!(staged.contains("-v1"), "staged={staged}");
    assert!(staged.contains("+v2"), "staged={staged}");
    assert!(!staged.contains("v3"), "staged={staged}");
    assert!(unstaged.contains("-v2"), "unstaged={unstaged}");
    assert!(unstaged.contains("+v3"), "unstaged={unstaged}");
    assert!(combined.contains("-v1"), "combined={combined}");
    assert!(combined.contains("+v3"), "combined={combined}");
}

#[test]
fn git_diff_impl_untracked_staged_is_empty() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    fs::write(dir.path().join("new.txt"), "hi\n").unwrap();

    let staged = git_diff_impl(repo_path, "new.txt", Some("staged")).unwrap();
    let unstaged = git_diff_impl(repo_path, "new.txt", Some("unstaged")).unwrap();
    assert!(
        staged.is_empty(),
        "staged untracked should be empty, got {staged}"
    );
    assert!(unstaged.contains("+hi"), "unstaged={unstaged}");
}

#[test]
fn git_diff_commit_shows_change_versus_parent() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "v1\n", "first");
    commit_file(&dir, "a.txt", "v2\n", "second");
    let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();
    assert_eq!(log[0].summary, "second");

    let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
    assert!(patch.contains("-v1"), "patch={patch}");
    assert!(patch.contains("+v2"), "patch={patch}");
}

#[test]
fn git_diff_commit_root_is_versus_empty_tree() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "v1\n", "first");
    let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();

    let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
    assert!(patch.contains("+v1"), "root patch={patch}");
    assert!(
        !patch.contains("-v1"),
        "root should not delete, patch={patch}"
    );
}

#[test]
fn git_diff_commit_missing_path_is_empty() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "v1\n", "first");
    let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();

    let patch = git_diff_commit_impl(repo_path, &log[0].oid, "nope.txt").unwrap();
    assert!(patch.is_empty());
}

#[test]
fn git_diff_commit_is_empty_for_non_repo() {
    let plain = TempDir::new().unwrap();
    assert!(
        git_diff_commit_impl(plain.path().to_str().unwrap(), "abc", "a.txt")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn git_diff_commit_unknown_oid_errors() {
    let dir = init_test_repo();
    commit_file(&dir, "a.txt", "v1\n", "first");
    let err = git_diff_commit_impl(
        dir.path().to_str().unwrap(),
        "0000000000000000000000000000000000000000",
        "a.txt",
    )
    .unwrap_err();
    assert!(!err.is_empty());
}

#[test]
fn git_diff_ref_files_name_status_versus_other_branch() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "hello\n", "init");
    {
        let repo = Repository::open(repo_path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("other", &head, false).unwrap();
    }
    fs::write(dir.path().join("a.txt"), "world\n").unwrap();
    commit_file(&dir, "b.txt", "new\n", "add b");

    let files = git_diff_ref_files_impl(repo_path, "other").unwrap();
    let a = files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!(a.status, "modified");
    let b = files.iter().find(|f| f.path == "b.txt").unwrap();
    assert_eq!(b.status, "added");
}

#[test]
fn git_diff_file_ref_returns_patch_versus_other_branch() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "hello\n", "init");
    {
        let repo = Repository::open(repo_path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("other", &head, false).unwrap();
    }
    fs::write(dir.path().join("a.txt"), "world\n").unwrap();

    let patch = git_diff_file_ref_impl(repo_path, "other", "a.txt").unwrap();
    assert!(patch.contains("-hello"), "patch={patch}");
    assert!(patch.contains("+world"), "patch={patch}");
}

#[test]
fn git_diff_ref_unknown_ref_errors() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "hello\n", "init");

    assert!(git_diff_ref_files_impl(repo_path, "does-not-exist").is_err());
    assert!(git_diff_file_ref_impl(repo_path, "does-not-exist", "a.txt").is_err());
}

#[test]
fn git_diff_ref_files_is_empty_for_non_repo() {
    let plain = TempDir::new().unwrap();
    assert!(
        git_diff_ref_files_impl(plain.path().to_str().unwrap(), "main")
            .unwrap()
            .is_empty()
    );
}

#[test]
fn git_diff_commit_works_on_detached_head() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "a.txt", "v1\n", "first");
    commit_file(&dir, "a.txt", "v2\n", "second");
    let log = git_log_since_impl(repo_path, None, None, 200, usize::MAX).unwrap();
    {
        let repo = Repository::open(repo_path).unwrap();
        let oid = git2::Oid::from_str(&log[0].oid).unwrap();
        repo.set_head_detached(oid).unwrap();
    }

    let patch = git_diff_commit_impl(repo_path, &log[0].oid, "a.txt").unwrap();
    assert!(patch.contains("-v1"), "patch={patch}");
    assert!(patch.contains("+v2"), "patch={patch}");
}

#[test]
fn git_blame_groups_consecutive_lines_from_the_same_commit() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "aaa\nbbb\nccc\n", "first");
    commit_file(&dir, "file.txt", "aaa\nBBB\nCCC\n", "second");

    let hunks = git_blame_impl(repo_path, "file.txt").unwrap();
    assert_eq!(hunks.len(), 2, "expected two hunks, got {hunks:?}");

    assert_eq!(hunks[0].start_line, 1);
    assert_eq!(hunks[0].line_count, 1);
    assert_eq!(hunks[0].summary, "first");
    assert_eq!(hunks[0].author, "Test");
    assert!(!hunks[0].oid.is_empty());
    assert!(!hunks[0].timestamp.is_empty());

    assert_eq!(hunks[1].start_line, 2);
    assert_eq!(hunks[1].line_count, 2);
    assert_eq!(hunks[1].summary, "second");
    assert_ne!(hunks[0].oid, hunks[1].oid);
}

#[test]
fn git_blame_is_empty_for_non_repo() {
    let plain = TempDir::new().unwrap();
    fs::write(plain.path().join("file.txt"), "x\n").unwrap();
    assert!(git_blame_impl(plain.path().to_str().unwrap(), "file.txt")
        .unwrap()
        .is_empty());
}

#[test]
fn git_blame_errors_on_missing_and_binary_files() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "hi\n", "init");

    assert!(git_blame_impl(repo_path, "missing.txt").is_err());

    fs::write(dir.path().join("bin.dat"), [0u8, 1, 2, 0, 3]).unwrap();
    assert!(git_blame_impl(repo_path, "bin.dat").is_err());
}

#[test]
fn git_blame_errors_in_empty_repo() {
    let empty = init_test_repo();
    fs::write(empty.path().join("file.txt"), "hi\n").unwrap();
    assert!(git_blame_impl(empty.path().to_str().unwrap(), "file.txt").is_err());
}
