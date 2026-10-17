use super::*;
use crate::git::discovery::primary_project_path;
use crate::git::worktrees::*;
use git2::Repository;
use tempfile::TempDir;

#[test]
fn worktree_add_checks_out_a_sibling_auric_branch() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "Fix login!!!").unwrap();

    assert!(wt.is_auric);
    assert!(!wt.dirty);
    assert!(!wt.branch_ahead);
    assert!(wt.path.contains(".auric-wt"));
    assert!(wt
        .branch
        .as_deref()
        .unwrap()
        .starts_with("auric/fix-login-"));
    assert!(Path::new(&wt.path).join("a.txt").is_file());
    assert_eq!(
        fs::canonicalize(&wt.source_repo).unwrap(),
        fs::canonicalize(&path).unwrap()
    );

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, wt.path);
}

#[test]
fn worktree_list_hides_foreign_worktrees() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo = Repository::open(&path).unwrap();
    let foreign = dir.path().join("foreign-wt");
    repo.worktree("foreign", &foreign, None).unwrap();

    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_remove_refuses_a_dirty_checkout_until_forced() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "edit").unwrap();
    fs::write(Path::new(&wt.path).join("a.txt"), "dirty").unwrap();

    let err = git_worktree_remove_impl(&path, &wt.path, false).unwrap_err();
    assert!(err.contains("uncommitted"), "{err}");
    assert!(Path::new(&wt.path).exists());

    git_worktree_remove_impl(&path, &wt.path, true).unwrap();
    assert!(!Path::new(&wt.path).exists());
    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_remove_rejects_a_path_we_did_not_create() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_remove_impl(&path, &path, true).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
}

#[test]
fn worktree_add_needs_a_commit() {
    let dir = TempDir::new().unwrap();
    Repository::init(dir.path()).unwrap();
    let err = git_worktree_add_impl(dir.path().to_str().unwrap(), "x").unwrap_err();
    assert!(err.contains("HEAD"), "{err}");
}

#[test]
fn primary_project_path_resolves_a_worktree_to_the_main_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "policy").unwrap();
    let resolved = primary_project_path(Path::new(&wt.path)).unwrap();
    assert_eq!(
        fs::canonicalize(&resolved).unwrap(),
        fs::canonicalize(&path).unwrap()
    );
}

#[test]
fn default_branch_is_main_or_master_from_the_repo() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    assert_eq!(git_default_branch_impl(&path).unwrap(), "main");

    force_default_branch(&path, "master");
    assert_eq!(git_default_branch_impl(&path).unwrap(), "master");
}

#[test]
fn default_branch_prefers_main_when_both_exist() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let repo = Repository::open(&path).unwrap();
    let commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("master", &commit, false).unwrap();
    assert_eq!(git_default_branch_impl(&path).unwrap(), "main");
}

#[test]
fn worktree_merge_fast_forwards_main_and_removes_the_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "feat").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");

    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, false).unwrap();
    assert_eq!(result.default_branch, "main");
    assert!(result.merged);
    assert!(result.fast_forward);
    assert!(result.cleaned_up);
    assert!(!Path::new(&wt.path).exists());
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("b.txt")).unwrap(),
        "from agent"
    );
    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_merge_commits_dirty_files_first() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "master");
    let wt = git_worktree_add_impl(&path, "dirty").unwrap();
    fs::write(Path::new(&wt.path).join("c.txt"), "leftover").unwrap();

    let result =
        git_worktree_merge_into_default_impl(&path, &wt.path, Some("Agent work: Writer"), false)
            .unwrap();
    assert_eq!(result.default_branch, "master");
    assert!(result.merged);
    assert!(result.cleaned_up);
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("c.txt")).unwrap(),
        "leftover"
    );
}

#[test]
fn worktree_merge_conflict_on_main_starts_the_merge_in_place() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "clash").unwrap();
    commit_in(&path, "a.txt", "on main\n", "main edit");
    commit_in(&wt.path, "a.txt", "on worktree\n", "wt edit");
    let main_before = Repository::open(&path)
        .unwrap()
        .head()
        .unwrap()
        .target()
        .unwrap();

    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, false).unwrap();
    assert!(!result.merged);
    assert!(!result.cleaned_up);
    assert!(!result.fast_forward);
    assert_eq!(result.oid, None);
    assert_eq!(result.conflicts, vec!["a.txt".to_string()]);
    assert!(
        Path::new(&wt.path).exists(),
        "the worktree stays until concluded"
    );

    let repo = Repository::open(&path).unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap(), main_before);
    assert_eq!(repo.state(), git2::RepositoryState::Merge);
    let state = crate::git::merge::git_merge_state_impl(&path).unwrap();
    assert_eq!(state.ours_label.as_deref(), Some("main"));
    assert_eq!(state.theirs_label, wt.branch);
    let on_disk = fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
    assert!(on_disk.contains("<<<<<<< main\n"), "{on_disk}");
}

#[test]
fn worktree_merge_conflict_elsewhere_says_how_to_resolve_it() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "clash").unwrap();
    commit_in(&path, "a.txt", "on main", "main edit");
    commit_in(&wt.path, "a.txt", "on worktree", "wt edit");
    let repo = Repository::open(&path).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("side", &head, false).unwrap();
    repo.set_head("refs/heads/side").unwrap();

    let err = git_worktree_merge_into_default_impl(&path, &wt.path, None, false).unwrap_err();
    let branch = wt.branch.clone().unwrap();
    assert_eq!(
        err,
        format!(
            "merge conflict — check out main and merge {branch} to resolve it in the merge panel"
        )
    );
    assert!(Path::new(&wt.path).exists());
    assert_eq!(repo.state(), git2::RepositoryState::Clean);
}

#[test]
fn worktree_merge_rejects_a_path_we_did_not_create() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_merge_into_default_impl(&path, &path, None, false).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
}

#[test]
fn worktree_list_reports_branch_dirty_and_ahead_from_the_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "work").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");
    fs::write(Path::new(&wt.path).join("c.txt"), "uncommitted").unwrap();

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].branch, wt.branch);
    assert!(listed[0].dirty);
    assert!(listed[0].branch_ahead);
}

#[test]
fn worktree_list_is_clean_and_not_ahead_right_after_add() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    git_worktree_add_impl(&path, "fresh").unwrap();

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].dirty);
    assert!(!listed[0].branch_ahead);
    assert!(listed[0].is_auric);
}

#[test]
fn remove_unless_work_removes_an_untouched_worktree_and_its_branch() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "idle").unwrap();

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(outcome.removed);
    assert!(!outcome.dirty && !outcome.branch_ahead);
    assert_eq!(outcome.branch, wt.branch);
    assert!(!Path::new(&wt.path).exists());
    let repo = Repository::open(&path).unwrap();
    assert!(repo
        .find_branch(wt.branch.as_deref().unwrap(), git2::BranchType::Local)
        .is_err());
}

#[test]
fn remove_unless_work_keeps_a_worktree_with_uncommitted_changes() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "dirty").unwrap();
    fs::write(Path::new(&wt.path).join("a.txt"), "changed").unwrap();

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(!outcome.removed);
    assert!(outcome.dirty);
    assert!(Path::new(&wt.path).exists());
}

#[test]
fn remove_unless_work_keeps_a_worktree_with_unmerged_commits() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "ahead").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(!outcome.removed);
    assert!(!outcome.dirty);
    assert!(outcome.branch_ahead);
    assert!(Path::new(&wt.path).exists());
    assert_eq!(git_worktree_list_impl(&path).unwrap().len(), 1);
}

#[test]
fn remove_unless_work_refuses_a_folder_that_is_no_auric_worktree() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_remove_unless_work_impl(&path).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
    assert!(Path::new(&path).join("a.txt").is_file());
}

fn origin_for(path: &str, dir: &TempDir) -> Repository {
    let origin = Repository::init_bare(dir.path()).unwrap();
    origin.set_head("refs/heads/main").unwrap();
    let repo = Repository::open(path).unwrap();
    let mut remote = repo.remote("origin", dir.path().to_str().unwrap()).unwrap();
    remote
        .push(&["refs/heads/main:refs/heads/main"], None)
        .unwrap();
    origin
}

#[test]
fn worktree_merge_pushes_default_not_head_and_deletes_remote_agent_branch() {
    for default in ["main", "master"] {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        let remote_dir = TempDir::new().unwrap();
        let origin = origin_for(&path, &remote_dir);
        let wt = git_worktree_add_impl(&path, "push").unwrap();
        commit_in(&wt.path, "b.txt", "agent", "agent work");
        let repo = Repository::open(&path).unwrap();
        let agent_ref = format!("refs/heads/{}", wt.branch.as_deref().unwrap());
        repo.find_remote("origin")
            .unwrap()
            .push(&[&format!("{agent_ref}:{agent_ref}")], None)
            .unwrap();
        if default == "master" {
            force_default_branch(&path, "master");
        }
        let old = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("side", &old, false).unwrap();
        repo.set_head("refs/heads/side").unwrap();
        let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap();
        assert!(result.pushed);
        assert!(result.cleaned_up);
        assert!(result.remote_branch_error.is_none());
        assert_eq!(
            origin
                .refname_to_id(&format!("refs/heads/{default}"))
                .unwrap()
                .to_string(),
            result.oid.unwrap()
        );
        assert!(origin.find_reference(&agent_ref).is_err());
        assert_eq!(repo.head().unwrap().shorthand(), Some("side"));
        assert!(origin.find_reference("refs/heads/side").is_err());
    }
}

#[test]
fn worktree_merge_locally_never_contacts_origin() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    Repository::open(&path)
        .unwrap()
        .remote("origin", "/nonexistent/remote")
        .unwrap();
    let wt = git_worktree_add_impl(&path, "local").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, false).unwrap();
    assert!(result.merged && result.cleaned_up);
    assert!(!result.pushed);
}

#[test]
fn worktree_merge_fetch_detects_stale_main_before_merging() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let remote_dir = TempDir::new().unwrap();
    let origin = origin_for(&path, &remote_dir);
    let wt = git_worktree_add_impl(&path, "stale").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    let peer_dir = TempDir::new().unwrap();
    Repository::clone(remote_dir.path().to_str().unwrap(), peer_dir.path()).unwrap();
    configure_repo_identity(peer_dir.path());
    commit_in(
        peer_dir.path().to_str().unwrap(),
        "remote.txt",
        "new",
        "remote work",
    );
    git_push_impl(peer_dir.path().to_str().unwrap()).unwrap();
    let before = Repository::open(&path)
        .unwrap()
        .refname_to_id("refs/heads/main")
        .unwrap();
    let error = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap_err();
    assert!(error.contains("origin/main"), "{error}");
    assert_eq!(
        Repository::open(&path)
            .unwrap()
            .refname_to_id("refs/heads/main")
            .unwrap(),
        before
    );
    assert!(Path::new(&wt.path).exists());
    assert_ne!(origin.refname_to_id("refs/heads/main").unwrap(), before);
}

#[test]
fn worktree_merge_rejected_push_keeps_local_merge_and_worktree() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let remote_dir = TempDir::new().unwrap();
    origin_for(&path, &remote_dir);
    // Separate fetch/push endpoints reproduce origin advancing after fetch:
    // preflight sees the old tip, receive sees a newer, incompatible tip.
    let peer_dir = TempDir::new().unwrap();
    Repository::clone(remote_dir.path().to_str().unwrap(), peer_dir.path()).unwrap();
    configure_repo_identity(peer_dir.path());
    commit_in(
        peer_dir.path().to_str().unwrap(),
        "remote.txt",
        "remote",
        "remote work",
    );
    let push_dir = TempDir::new().unwrap();
    let mut options = git2::build::RepoBuilder::new();
    options.bare(true);
    let origin = options
        .clone(peer_dir.path().to_str().unwrap(), push_dir.path())
        .unwrap();
    let before = origin.refname_to_id("refs/heads/main").unwrap();
    let repo = Repository::open(&path).unwrap();
    repo.remote_set_pushurl("origin", Some(push_dir.path().to_str().unwrap()))
        .unwrap();
    let wt = git_worktree_add_impl(&path, "reject").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap();
    assert!(result.merged);
    assert!(!result.pushed && !result.cleaned_up);
    assert!(result.push_error.is_some());
    assert!(Path::new(&wt.path).exists());
    assert_eq!(
        repo.refname_to_id("refs/heads/main").unwrap().to_string(),
        result.oid.unwrap()
    );
    assert_eq!(origin.refname_to_id("refs/heads/main").unwrap(), before);
}

#[test]
fn worktree_merge_already_contained_can_be_pushed_without_another_commit() {
    for push in [false, true] {
        let dir = TempDir::new().unwrap();
        let path = committed_repo(&dir);
        force_default_branch(&path, "main");
        let remote_dir = TempDir::new().unwrap();
        let origin = origin_for(&path, &remote_dir);
        let wt = git_worktree_add_impl(&path, "contained").unwrap();
        let before = Repository::open(&path)
            .unwrap()
            .refname_to_id("refs/heads/main")
            .unwrap();
        let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, push).unwrap();
        assert!(!result.merged);
        assert_eq!(result.pushed, push);
        assert!(result.cleaned_up);
        assert_eq!(result.oid.unwrap(), before.to_string());
        assert_eq!(origin.refname_to_id("refs/heads/main").unwrap(), before);
    }
}

#[test]
fn worktree_merge_fetch_failure_preserves_uncommitted_work() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "offline").unwrap();
    fs::write(Path::new(&wt.path).join("a.txt"), "dirty").unwrap();
    let before = Repository::open(&path)
        .unwrap()
        .refname_to_id("refs/heads/main")
        .unwrap();
    let error = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap_err();
    assert!(error.contains("fetch origin"), "{error}");
    assert_eq!(
        Repository::open(&path)
            .unwrap()
            .refname_to_id("refs/heads/main")
            .unwrap(),
        before
    );
    assert!(crate::git::status::repo_is_dirty(Path::new(&wt.path)));
}

#[test]
fn worktree_merge_reports_remote_delete_failure_after_a_successful_push() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let remote_dir = TempDir::new().unwrap();
    let origin = origin_for(&path, &remote_dir);
    let wt = git_worktree_add_impl(&path, "delete-locked").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    let agent_ref = format!("refs/heads/{}", wt.branch.as_deref().unwrap());
    Repository::open(&path)
        .unwrap()
        .find_remote("origin")
        .unwrap()
        .push(&[&format!("{agent_ref}:{agent_ref}")], None)
        .unwrap();
    fs::write(
        remote_dir.path().join(format!("{agent_ref}.lock")),
        "locked",
    )
    .unwrap();
    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap();
    assert!(result.merged && result.pushed && result.cleaned_up);
    assert!(result.remote_branch_error.is_some());
    assert!(origin.find_reference(&agent_ref).is_ok());
    assert_eq!(
        origin.refname_to_id("refs/heads/main").unwrap().to_string(),
        result.oid.unwrap()
    );
}

#[cfg(unix)]
#[test]
fn worktree_merge_reports_cleanup_failure_without_losing_merge_outcome() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "cleanup-denied").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    fs::set_permissions(&wt.path, fs::Permissions::from_mode(0o555)).unwrap();
    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, false).unwrap();
    // Restore before assertions so a failed test does not leave a protected dir.
    if Path::new(&wt.path).exists() {
        fs::set_permissions(&wt.path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(result.merged && !result.pushed);
    assert!(!result.cleaned_up);
    assert!(result.cleanup_error.is_some());
    assert_eq!(
        Repository::open(&path)
            .unwrap()
            .refname_to_id("refs/heads/main")
            .unwrap()
            .to_string(),
        result.oid.unwrap()
    );
    let _ = fs::remove_dir_all(&wt.path);
}

#[test]
fn worktree_merge_keeps_a_remote_agent_branch_that_advanced_since_fetch() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let remote_dir = TempDir::new().unwrap();
    origin_for(&path, &remote_dir);
    let wt = git_worktree_add_impl(&path, "remote-advanced").unwrap();
    commit_in(&wt.path, "b.txt", "agent", "agent work");
    let repo = Repository::open(&path).unwrap();
    let agent_ref = format!("refs/heads/{}", wt.branch.as_deref().unwrap());
    repo.find_remote("origin")
        .unwrap()
        .push(&[&format!("{agent_ref}:{agent_ref}")], None)
        .unwrap();
    let peer_dir = TempDir::new().unwrap();
    let mut clone = git2::build::RepoBuilder::new();
    clone.branch(wt.branch.as_deref().unwrap());
    clone
        .clone(remote_dir.path().to_str().unwrap(), peer_dir.path())
        .unwrap();
    configure_repo_identity(peer_dir.path());
    commit_in(
        peer_dir.path().to_str().unwrap(),
        "late.txt",
        "late",
        "late work",
    );
    let push_dir = TempDir::new().unwrap();
    let mut clone = git2::build::RepoBuilder::new();
    clone.bare(true);
    let pushed_origin = clone
        .clone(peer_dir.path().to_str().unwrap(), push_dir.path())
        .unwrap();
    pushed_origin
        .reference(
            "refs/heads/main",
            repo.refname_to_id("refs/heads/main").unwrap(),
            true,
            "test default",
        )
        .unwrap();
    let before = pushed_origin.refname_to_id(&agent_ref).unwrap();
    repo.remote_set_pushurl("origin", Some(push_dir.path().to_str().unwrap()))
        .unwrap();
    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None, true).unwrap();
    assert!(result.pushed && result.cleaned_up, "{result:?}");
    assert!(result.remote_branch_error.is_some());
    assert_eq!(pushed_origin.refname_to_id(&agent_ref).unwrap(), before);
}
