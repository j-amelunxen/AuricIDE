use super::*;
use crate::git::discovery::git_discover_repos_impl;
use tempfile::TempDir;

#[test]
fn root_repo_reports_one_entry_with_empty_relative_path() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].kind, "root");
    assert_eq!(repos[0].relative_path, "");
    assert_eq!(repos[0].path, dir.path().to_str().unwrap());
    assert_eq!(
        repos[0].name,
        dir.path().file_name().unwrap().to_str().unwrap()
    );
}

#[test]
fn two_nested_repos_under_a_non_repo_root_are_sorted_and_root_is_absent() {
    let dir = TempDir::new().unwrap();
    init_repo(&dir.path().join("web"));
    init_repo(&dir.path().join("api"));

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
    assert_eq!(relative_paths, vec!["api", "web"]);
    assert!(repos.iter().all(|r| r.kind == "nested"));
}

#[test]
fn a_repo_below_a_root_repo_lists_root_first_then_the_nested_repo() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    init_repo(&dir.path().join("service"));

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert_eq!(repos.len(), 2);
    assert_eq!(repos[0].kind, "root");
    assert_eq!(repos[0].relative_path, "");
    assert_eq!(repos[1].kind, "nested");
    assert_eq!(repos[1].relative_path, "service");
}

#[test]
fn discovery_prunes_node_modules_and_stops_past_the_max_depth() {
    let dir = TempDir::new().unwrap();
    init_repo(&dir.path().join("node_modules/some-package"));
    init_repo(&dir.path().join("a/b/c/service-a")); // depth 4 — included
    init_repo(&dir.path().join("a/b/c/d/service-b")); // depth 5 — excluded

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
    assert_eq!(relative_paths, vec!["a/b/c/service-a"]);
}

#[test]
fn discovery_omits_an_ignored_nested_repo() {
    let dir = TempDir::new().unwrap();
    init_repo(&dir.path().join("keep"));
    init_repo(&dir.path().join("noise"));
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"["noise"]"#);

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
    assert_eq!(relative_paths, vec!["keep"]);
}

#[test]
fn discovery_omits_every_repo_under_an_ignored_prefix() {
    let dir = TempDir::new().unwrap();
    init_repo(&dir.path().join("keep"));
    init_repo(&dir.path().join("vendor/lib-a"));
    init_repo(&dir.path().join("vendor/lib-b"));
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"["vendor"]"#);

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    let relative_paths: Vec<&str> = repos.iter().map(|r| r.relative_path.as_str()).collect();
    assert_eq!(relative_paths, vec!["keep"]);
}

#[test]
fn discovery_never_hides_the_project_root_repo() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"[""]"#);

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].kind, "root");
}

#[test]
fn a_dot_git_file_counts_as_a_repo() {
    let dir = TempDir::new().unwrap();
    let checkout = dir.path().join("worktree-checkout");
    fs::create_dir_all(&checkout).unwrap();
    fs::write(checkout.join(".git"), "gitdir: ../actual/.git\n").unwrap();

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].relative_path, "worktree-checkout");
}

#[test]
fn a_declared_submodule_is_kind_submodule_a_plain_checkout_is_kind_nested() {
    let root = TempDir::new().unwrap();
    let source = TempDir::new().unwrap();

    init_repo(source.path());
    configure_repo_identity(source.path());
    fs::write(source.path().join("readme.md"), "hi").unwrap();
    commit_all(source.path(), "init");

    init_repo(root.path());
    configure_repo_identity(root.path());
    fs::write(root.path().join("readme.md"), "hi").unwrap();
    commit_all(root.path(), "init");

    let submodule_add = git_command(root.path())
        .args([
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source.path().to_str().unwrap(),
            "lib/nested",
        ])
        .output()
        .unwrap();
    assert!(
        submodule_add.status.success(),
        "git submodule add failed: {}",
        String::from_utf8_lossy(&submodule_add.stderr)
    );

    // A plain, unrelated checkout sitting next to the submodule — same
    // depth, same parent, not declared in .gitmodules.
    init_repo(&root.path().join("lib/plain-checkout"));

    let repos = git_discover_repos_impl(root.path()).unwrap();

    let submodule = repos
        .iter()
        .find(|r| r.relative_path == "lib/nested")
        .expect("submodule not discovered");
    assert_eq!(submodule.kind, "submodule");

    let plain = repos
        .iter()
        .find(|r| r.relative_path == "lib/plain-checkout")
        .expect("plain nested checkout not discovered");
    assert_eq!(plain.kind, "nested");
}

#[test]
fn a_missing_or_non_directory_root_is_an_error() {
    let dir = TempDir::new().unwrap();

    let missing = dir.path().join("does-not-exist");
    assert!(git_discover_repos_impl(&missing).is_err());

    let file_root = dir.path().join("just-a-file");
    fs::write(&file_root, "hi").unwrap();
    assert!(git_discover_repos_impl(&file_root).is_err());
}

#[test]
fn a_root_with_no_repos_anywhere_returns_an_empty_ok() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("just-a-folder")).unwrap();

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert!(repos.is_empty());
}

#[test]
fn a_root_directory_named_like_a_pruned_dir_is_still_discovered() {
    // The prune list is about what NOT to descend into below the root —
    // it must never veto the root itself just because a project happens
    // to be checked out into a folder named "target".
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("target");
    init_repo(&root);

    let repos = git_discover_repos_impl(&root).unwrap();

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].kind, "root");
    assert_eq!(repos[0].relative_path, "");
}

#[test]
fn a_repo_inside_a_pruned_directory_below_the_root_is_not_reported() {
    let dir = TempDir::new().unwrap();
    init_repo(&dir.path().join("target/nested-build-artifact"));

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert!(repos.is_empty());
}

#[test]
fn discovery_skips_auric_worktree_sibling_folders() {
    let dir = TempDir::new().unwrap();
    init_repo(dir.path());
    init_repo(&dir.path().join("project.auric-wt/fix-ab12"));

    let repos = git_discover_repos_impl(dir.path()).unwrap();

    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].kind, "root");
}

#[test]
fn classify_kind_resolves_through_the_nearest_enclosing_repo_not_any_ancestor() {
    let source = TempDir::new().unwrap();
    init_repo(source.path());
    configure_repo_identity(source.path());
    fs::write(source.path().join("readme.md"), "hi").unwrap();
    commit_all(source.path(), "init");
    let source_path = source.path().to_str().unwrap();

    // --- nearest repo declares it: "submodule" ---
    let nearest_declares_it = TempDir::new().unwrap();
    let root_a = nearest_declares_it.path().join("root");
    init_repo(&root_a);
    configure_repo_identity(&root_a);
    fs::write(root_a.join("readme.md"), "hi").unwrap();
    commit_all(&root_a, "init");

    let mid_a = root_a.join("mid");
    init_repo(&mid_a);
    configure_repo_identity(&mid_a);
    fs::write(mid_a.join("readme.md"), "hi").unwrap();
    commit_all(&mid_a, "init");
    let add_leaf_to_mid = git_command(&mid_a)
        .args([
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source_path,
            "leaf",
        ])
        .output()
        .unwrap();
    assert!(
        add_leaf_to_mid.status.success(),
        "git submodule add (mid) failed: {}",
        String::from_utf8_lossy(&add_leaf_to_mid.stderr)
    );

    let repos_a = git_discover_repos_impl(&root_a).unwrap();
    let leaf_a = repos_a
        .iter()
        .find(|r| r.relative_path == "mid/leaf")
        .expect("mid/leaf not discovered");
    assert_eq!(leaf_a.kind, "submodule");

    // --- only a grandparent declares it, an intervening repo does not: "nested" ---
    let only_a_grandparent_declares_it = TempDir::new().unwrap();
    let root_b = only_a_grandparent_declares_it.path().join("root");
    init_repo(&root_b);
    configure_repo_identity(&root_b);
    fs::write(root_b.join("readme.md"), "hi").unwrap();
    commit_all(&root_b, "init");

    let add_leaf_to_root = git_command(&root_b)
        .args([
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            source_path,
            "mid/leaf",
        ])
        .output()
        .unwrap();
    assert!(
        add_leaf_to_root.status.success(),
        "git submodule add (root) failed: {}",
        String::from_utf8_lossy(&add_leaf_to_root.stderr)
    );
    init_repo(&root_b.join("mid"));

    let repos_b = git_discover_repos_impl(&root_b).unwrap();
    let leaf_b = repos_b
        .iter()
        .find(|r| r.relative_path == "mid/leaf")
        .expect("mid/leaf not discovered");
    assert_eq!(leaf_b.kind, "nested");
}
