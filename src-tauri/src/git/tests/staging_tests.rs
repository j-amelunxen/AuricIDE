use super::*;
use crate::git::discard::git_discard_impl;
use crate::git::status::git_status_impl;
use tempfile::TempDir;

#[test]
fn push_without_a_remote_names_the_problem() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_push_impl(&path).unwrap_err();
    assert!(err.contains("origin"), "unhelpful error: {err}");
}

#[test]
fn push_reaches_a_local_bare_remote() {
    let work = TempDir::new().unwrap();
    let bare = TempDir::new().unwrap();
    let path = committed_repo(&work);
    Repository::init_bare(bare.path()).unwrap();
    {
        let repo = Repository::open(&path).unwrap();
        repo.remote("origin", bare.path().to_str().unwrap())
            .unwrap();
    }

    git_push_impl(&path).unwrap();

    let remote = Repository::open_bare(bare.path()).unwrap();
    assert!(remote.head().unwrap().peel_to_commit().is_ok());
}

#[test]
fn push_sets_the_upstream_so_the_next_push_knows_where_home_is() {
    let work = TempDir::new().unwrap();
    let bare = TempDir::new().unwrap();
    let path = committed_repo(&work);
    Repository::init_bare(bare.path()).unwrap();
    {
        let repo = Repository::open(&path).unwrap();
        repo.remote("origin", bare.path().to_str().unwrap())
            .unwrap();
    }

    git_push_impl(&path).unwrap();

    let repo = Repository::open(&path).unwrap();
    let head = repo.head().unwrap();
    let branch = repo
        .find_branch(head.shorthand().unwrap(), git2::BranchType::Local)
        .unwrap();
    assert!(branch.upstream().is_ok());
}

#[test]
fn test_git_discard_modified_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "original\n", "init");

    // Modify file
    fs::write(dir.path().join("file.txt"), "modified\n").unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "modified\n"
    );

    // Discard changes
    git_discard_impl(repo_path, "file.txt").unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "original\n"
    );
}

#[test]
fn test_git_discard_deleted_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "original\n", "init");

    // Delete file
    fs::remove_file(dir.path().join("file.txt")).unwrap();
    assert!(!dir.path().join("file.txt").exists());

    // Discard deletion (should restore file)
    git_discard_impl(repo_path, "file.txt").unwrap();
    assert!(dir.path().join("file.txt").exists());
    assert_eq!(
        fs::read_to_string(dir.path().join("file.txt")).unwrap(),
        "original\n"
    );
}

#[test]
fn test_git_discard_untracked_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "tracked.txt", "tracked\n", "init");

    // Create untracked file
    fs::write(dir.path().join("untracked.txt"), "untracked\n").unwrap();
    assert!(dir.path().join("untracked.txt").exists());

    // Discard untracked file (should delete it)
    git_discard_impl(repo_path, "untracked.txt").unwrap();
    assert!(!dir.path().join("untracked.txt").exists());
}

#[test]
fn test_git_discard_staged_new_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "tracked.txt", "tracked\n", "init");

    // Stage a brand-new file
    fs::write(dir.path().join("added.txt"), "added\n").unwrap();
    git_command(dir.path())
        .args(["add", "added.txt"])
        .output()
        .unwrap();
    assert!(dir.path().join("added.txt").exists());

    git_discard_impl(repo_path, "added.txt").unwrap();
    assert!(!dir.path().join("added.txt").exists());
}

#[test]
fn git_stage_impl_stages_a_deleted_file() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "gone.txt", "bye\n", "init");
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    git_stage_impl(repo_path, &["gone.txt".to_string()]).unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "gone.txt");
    assert_eq!(row.staged.as_deref(), Some("deleted"));
}

#[test]
fn git_stage_impl_includes_deletion_in_a_multi_path_call() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "keep.txt", "a\n", "one");
    commit_file(&dir, "gone.txt", "b\n", "two");
    fs::write(dir.path().join("keep.txt"), "aa\n").unwrap();
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    git_stage_impl(repo_path, &["keep.txt".to_string(), "gone.txt".to_string()]).unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    assert_eq!(
        find_status(&rows, "keep.txt").staged.as_deref(),
        Some("modified")
    );
    assert_eq!(
        find_status(&rows, "gone.txt").staged.as_deref(),
        Some("deleted")
    );
}

#[test]
fn git_commit_impl_refuses_a_clean_index() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_commit_impl(&path, "empty").unwrap_err();
    assert_eq!(err, "Nothing to commit");
}
