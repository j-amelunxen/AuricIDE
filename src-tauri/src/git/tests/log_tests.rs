use super::*;
use crate::git::log::*;
use tempfile::TempDir;

#[test]
fn test_git_log_since_lists_commits_newest_first_with_touched_paths() {
    let dir = init_test_repo();
    commit_file(&dir, "src/a.rs", "a", "first");
    commit_file(&dir, "docs/readme.md", "d", "second");

    let log =
        git_log_since_impl(dir.path().to_str().unwrap(), None, None, 200, usize::MAX).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "second");
    assert_eq!(log[0].author, "Test");
    assert_eq!(log[0].touched, vec!["docs/readme.md"]);
    assert_eq!(log[1].summary, "first");
    assert_eq!(log[1].touched, vec!["src/a.rs"]);
}

#[test]
fn test_git_log_since_filters_by_path_prefix() {
    let dir = init_test_repo();
    commit_file(&dir, "src/a.rs", "a", "first");
    commit_file(&dir, "docs/readme.md", "d", "second");
    commit_file(&dir, "src/b.rs", "b", "third");

    let log = git_log_since_impl(
        dir.path().to_str().unwrap(),
        None,
        Some("src/"),
        200,
        usize::MAX,
    )
    .unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "third");
    assert_eq!(log[1].summary, "first");
}

#[test]
fn test_git_log_since_respects_the_cutoff() {
    let dir = init_test_repo();
    commit_file(&dir, "src/a.rs", "a", "old");
    // A cutoff far in the future excludes everything.
    let log = git_log_since_impl(
        dir.path().to_str().unwrap(),
        Some("2099-01-01 00:00:00"),
        None,
        200,
        usize::MAX,
    )
    .unwrap();
    assert!(log.is_empty());
    // A cutoff far in the past includes it.
    let log = git_log_since_impl(
        dir.path().to_str().unwrap(),
        Some("2000-01-01"),
        None,
        200,
        usize::MAX,
    )
    .unwrap();
    assert_eq!(log.len(), 1);
}

#[test]
fn test_git_log_since_caps_at_limit() {
    let dir = init_test_repo();
    for i in 0..5 {
        commit_file(&dir, &format!("{i}.txt"), "x", &format!("c{i}"));
    }
    let log = git_log_since_impl(dir.path().to_str().unwrap(), None, None, 3, usize::MAX).unwrap();
    assert_eq!(log.len(), 3);
    assert_eq!(log[0].summary, "c4");
}

#[test]
fn test_git_log_since_caps_work_at_max_scan() {
    let dir = init_test_repo();
    for i in 0..5 {
        commit_file(&dir, &format!("{i}.txt"), "x", &format!("c{i}"));
    }
    // Prefix matches nothing; without `max_scan` it would visit all 5. With
    // `max_scan = 2` it gives up after inspecting the two newest commits.
    let log = git_log_since_impl(
        dir.path().to_str().unwrap(),
        None,
        Some("nonexistent/"),
        100,
        2,
    )
    .unwrap();
    assert_eq!(log.len(), 0);
}

#[test]
fn test_git_log_since_is_empty_for_non_repo_and_empty_repo() {
    let plain = TempDir::new().unwrap();
    let log =
        git_log_since_impl(plain.path().to_str().unwrap(), None, None, 200, usize::MAX).unwrap();
    assert!(log.is_empty());

    let empty = init_test_repo();
    let log =
        git_log_since_impl(empty.path().to_str().unwrap(), None, None, 200, usize::MAX).unwrap();
    assert!(log.is_empty());
}

#[test]
fn test_git_log_since_rejects_garbage_cutoff() {
    let dir = init_test_repo();
    commit_file(&dir, "a.txt", "1", "first");
    let err = git_log_since_impl(
        dir.path().to_str().unwrap(),
        Some("not a date"),
        None,
        200,
        usize::MAX,
    )
    .unwrap_err();
    assert!(err.contains("Invalid since_iso"));
}

#[test]
fn git_list_branches_lists_local_remote_and_marks_current() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let current = current_branch_name(&path);
    {
        let repo = Repository::open(&path).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("develop", &head, false).unwrap();
    }
    add_remote_tracking(&path, &format!("origin/{current}"));
    add_remote_tracking(&path, "origin/zzz");
    {
        let repo = Repository::open(&path).unwrap();
        repo.reference_symbolic(
            "refs/remotes/origin/HEAD",
            &format!("refs/remotes/origin/{current}"),
            true,
            "test",
        )
        .unwrap();
    }

    let branches = git_list_branches_impl(&path).unwrap();
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(
        !names.iter().any(|n| n.ends_with("/HEAD") || *n == "HEAD"),
        "symbolic HEAD must be skipped, got {names:?}"
    );

    let current_row = branches.iter().find(|b| b.is_current).unwrap();
    assert_eq!(current_row.name, current);
    assert_eq!(current_row.kind, "local");
    assert_eq!(branches[0].name, current, "current branch sorts first");

    let develop = branches.iter().find(|b| b.name == "develop").unwrap();
    assert_eq!(develop.kind, "local");
    assert!(!develop.is_current);

    let remote_main = branches
        .iter()
        .find(|b| b.name == format!("origin/{current}"))
        .unwrap();
    assert_eq!(remote_main.kind, "remote");
    assert!(!remote_main.is_current);

    let remote_zzz = branches.iter().find(|b| b.name == "origin/zzz").unwrap();
    assert_eq!(remote_zzz.kind, "remote");

    let first_remote = branches.iter().position(|b| b.kind == "remote").unwrap();
    assert!(
        branches[..first_remote].iter().all(|b| b.kind == "local"),
        "locals must sort before remotes: {names:?}"
    );
    let local_names: Vec<&str> = branches
        .iter()
        .filter(|b| b.kind == "local" && !b.is_current)
        .map(|b| b.name.as_str())
        .collect();
    let mut sorted_locals = local_names.clone();
    sorted_locals.sort();
    assert_eq!(local_names, sorted_locals);
    let remote_names: Vec<&str> = branches
        .iter()
        .filter(|b| b.kind == "remote")
        .map(|b| b.name.as_str())
        .collect();
    let mut sorted_remotes = remote_names.clone();
    sorted_remotes.sort();
    assert_eq!(remote_names, sorted_remotes);
}

#[test]
fn git_list_branches_is_empty_for_non_repo() {
    let plain = TempDir::new().unwrap();
    assert!(git_list_branches_impl(plain.path().to_str().unwrap())
        .unwrap()
        .is_empty());
}

#[test]
fn git_list_branches_is_empty_for_empty_repo() {
    let empty = init_test_repo();
    assert!(git_list_branches_impl(empty.path().to_str().unwrap())
        .unwrap()
        .is_empty());
}

#[test]
fn git_list_branches_marks_none_current_on_detached_head() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    {
        let repo = Repository::open(&path).unwrap();
        let oid = repo.head().unwrap().target().unwrap();
        repo.set_head_detached(oid).unwrap();
    }

    let branches = git_list_branches_impl(&path).unwrap();
    assert!(
        branches.iter().any(|b| b.kind == "local"),
        "detached HEAD still lists the local branch"
    );
    assert!(
        branches.iter().all(|b| !b.is_current),
        "no branch is current when HEAD is detached"
    );
}
