use super::*;
use crate::git::status::*;
use git2::Repository;
use tempfile::TempDir;

#[test]
fn git_status_reports_an_ignored_directory_itself() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    fs::write(dir.path().join(".gitignore"), "build/\nsecret.txt\n").unwrap();
    fs::create_dir(dir.path().join("build")).unwrap();
    fs::write(dir.path().join("build").join("out.js"), "x").unwrap();
    fs::write(dir.path().join("secret.txt"), "s").unwrap();

    let statuses = git_status_impl(&path).unwrap();
    let ignored: Vec<&str> = statuses
        .iter()
        .filter(|s| s.status == "ignored")
        .map(|s| s.path.as_str())
        .collect();

    assert!(
        ignored.iter().any(|p| *p == "secret.txt"),
        "ignored files must appear, got {ignored:?}"
    );
    // libgit2 reports ignored directories with a trailing slash. The
    // explorer's relative paths do not — resolveGitStatus strips it.
    assert!(
        ignored.contains(&"build/"),
        "ignored directories must appear as themselves, got {ignored:?}"
    );
    for path in ["secret.txt", "build/"] {
        let row = statuses.iter().find(|s| s.path == path).unwrap();
        assert_eq!(row.status, "ignored");
        assert_eq!(row.staged, None);
        assert_eq!(row.unstaged, None);
    }
}

#[test]
fn git_status_reports_both_sides_as_modified_on_each_axis() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "file.txt", "v1\n", "init");
    fs::write(dir.path().join("file.txt"), "v2\n").unwrap();
    git_stage_impl(repo_path, &["file.txt".to_string()]).unwrap();
    fs::write(dir.path().join("file.txt"), "v3\n").unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "file.txt");
    assert_eq!(row.staged.as_deref(), Some("modified"));
    assert_eq!(row.unstaged.as_deref(), Some("modified"));
    assert_eq!(row.status, "modified");
}

#[test]
fn git_status_reports_untracked() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    fs::write(dir.path().join("new.txt"), "hi\n").unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "new.txt");
    assert_eq!(row.status, "untracked");
    assert_eq!(row.staged, None);
    assert_eq!(row.unstaged.as_deref(), Some("untracked"));
}

#[test]
fn git_status_reports_staged_new() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    fs::write(dir.path().join("new.txt"), "hi\n").unwrap();
    git_stage_impl(repo_path, &["new.txt".to_string()]).unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "new.txt");
    assert_eq!(row.status, "added");
    assert_eq!(row.staged.as_deref(), Some("added"));
    assert_eq!(row.unstaged, None);
}

#[test]
fn git_status_reports_unstaged_delete() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "gone.txt", "bye\n", "init");
    fs::remove_file(dir.path().join("gone.txt")).unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "gone.txt");
    assert_eq!(row.status, "deleted");
    assert_eq!(row.staged, None);
    assert_eq!(row.unstaged.as_deref(), Some("deleted"));
}

#[test]
fn git_status_reports_staged_delete() {
    let dir = init_test_repo();
    let repo_path = dir.path().to_str().unwrap();
    commit_file(&dir, "gone.txt", "bye\n", "init");
    fs::remove_file(dir.path().join("gone.txt")).unwrap();
    git_stage_impl(repo_path, &["gone.txt".to_string()]).unwrap();

    let rows = git_status_impl(repo_path).unwrap();
    let row = find_status(&rows, "gone.txt");
    assert_eq!(row.status, "deleted");
    assert_eq!(row.staged.as_deref(), Some("deleted"));
    assert_eq!(row.unstaged, None);
}

#[test]
fn git_status_treats_an_ignored_nested_repo_as_ignored_in_the_parent() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    init_repo(&dir.path().join("noise"));
    fs::write(dir.path().join("noise").join("wip.txt"), "x").unwrap();
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"["noise"]"#);

    let statuses = git_status_impl(&path).unwrap();
    let noise: Vec<&GitFileStatus> = statuses
        .iter()
        .filter(|s| s.path == "noise" || s.path == "noise/" || s.path.starts_with("noise/"))
        .collect();
    assert!(
        !noise.is_empty(),
        "the ignored nested repo must still appear so the explorer can grey it out, got {statuses:?}"
    );
    assert!(
        noise.iter().all(|s| s.status == "ignored"),
        "ignored nested-repo paths must not stay untracked, got {noise:?}"
    );
}

#[test]
fn git_projects_dirty_is_false_for_a_clean_committed_repo() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    assert!(!dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_true_for_an_unstaged_edit() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join("a.txt"), "changed").unwrap();
    assert!(dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_true_for_a_staged_new_file() {
    let dir = init_test_repo();
    let path = dir.path().to_str().unwrap();
    commit_file(&dir, "kept.txt", "ok\n", "init");
    fs::write(dir.path().join("new.txt"), "hi\n").unwrap();
    git_stage_impl(path, &["new.txt".to_string()]).unwrap();
    assert!(dirty_for(path));
}

#[test]
fn git_projects_dirty_is_true_for_an_untracked_file() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join("scratch.txt"), "wip").unwrap();
    assert!(dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_ignores_gitignored_files() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join(".gitignore"), "secret.txt\n").unwrap();
    git_stage_impl(dir.path().to_str().unwrap(), &[".gitignore".to_string()]).unwrap();
    git_commit_impl(dir.path().to_str().unwrap(), "ignore secret").unwrap();
    fs::write(dir.path().join("secret.txt"), "s").unwrap();
    assert!(!dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_false_when_the_path_is_not_a_repo() {
    let plain = TempDir::new().unwrap();
    assert!(!dirty_for(plain.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_false_when_the_path_does_not_exist() {
    assert!(!dirty_for("/definitely/not/a/real/project/path"));
}

#[test]
fn git_projects_dirty_sees_a_dirty_repo_nested_under_the_project() {
    let root = TempDir::new().unwrap();
    let nested = root.path().join("pkg");
    fs::create_dir(&nested).unwrap();
    let repo = Repository::init(&nested).unwrap();
    let mut config = repo.config().unwrap();
    config.set_str("user.name", "Test").unwrap();
    config.set_str("user.email", "test@example.com").unwrap();
    fs::write(nested.join("a.txt"), "hi").unwrap();
    git_stage_impl(nested.to_str().unwrap(), &["a.txt".to_string()]).unwrap();
    git_commit_impl(nested.to_str().unwrap(), "init").unwrap();
    fs::write(nested.join("a.txt"), "dirty").unwrap();

    assert!(dirty_for(root.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_ignores_a_dirty_nested_repo_the_project_hid() {
    let root = TempDir::new().unwrap();
    let nested = root.path().join("pkg");
    fs::create_dir(&nested).unwrap();
    let repo = Repository::init(&nested).unwrap();
    let mut config = repo.config().unwrap();
    config.set_str("user.name", "Test").unwrap();
    config.set_str("user.email", "test@example.com").unwrap();
    fs::write(nested.join("a.txt"), "hi").unwrap();
    git_stage_impl(nested.to_str().unwrap(), &["a.txt".to_string()]).unwrap();
    git_commit_impl(nested.to_str().unwrap(), "init").unwrap();
    fs::write(nested.join("a.txt"), "dirty").unwrap();
    crate::ignored_repos::write_ignored_repos_for_test(root.path(), r#"["pkg"]"#);

    assert!(!dirty_for(root.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_true_when_a_root_repo_contains_a_dirty_nested_repo() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    dirty_nested_repo_at(dir.path(), "pkg");

    assert!(dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_ignores_a_dirty_nested_repo_inside_a_root_repo() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join(".gitignore"), ".auric/\n").unwrap();
    git_stage_impl(dir.path().to_str().unwrap(), &[".gitignore".to_string()]).unwrap();
    git_commit_impl(dir.path().to_str().unwrap(), "ignore auric").unwrap();
    dirty_nested_repo_at(dir.path(), "pkg");
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"["pkg"]"#);

    assert!(!dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_is_true_when_a_submodule_is_dirty() {
    let origin = committed_origin_repo();
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    add_submodule(dir.path(), origin.path(), "pkg");
    fs::write(dir.path().join("pkg").join("a.txt"), "dirty").unwrap();

    assert!(dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_ignores_a_dirty_submodule_the_project_hid() {
    let origin = committed_origin_repo();
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join(".gitignore"), ".auric/\n").unwrap();
    git_stage_impl(dir.path().to_str().unwrap(), &[".gitignore".to_string()]).unwrap();
    git_commit_impl(dir.path().to_str().unwrap(), "ignore auric").unwrap();
    add_submodule(dir.path(), origin.path(), "pkg");
    fs::write(dir.path().join("pkg").join("a.txt"), "dirty").unwrap();
    crate::ignored_repos::write_ignored_repos_for_test(dir.path(), r#"["pkg"]"#);

    assert!(!dirty_for(dir.path().to_str().unwrap()));
}

#[test]
fn git_projects_dirty_sees_an_ignore_list_while_the_project_db_stays_open() {
    let dir = TempDir::new().unwrap();
    committed_repo(&dir);
    fs::write(dir.path().join(".gitignore"), ".auric/\n").unwrap();
    git_stage_impl(dir.path().to_str().unwrap(), &[".gitignore".to_string()]).unwrap();
    git_commit_impl(dir.path().to_str().unwrap(), "ignore auric").unwrap();
    dirty_nested_repo_at(dir.path(), "pkg");

    let auric = dir.path().join(".auric");
    fs::create_dir_all(&auric).unwrap();
    let conn = rusqlite::Connection::open(auric.join("project.db")).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (namespace TEXT, key TEXT, value TEXT,
         updated_at TEXT, PRIMARY KEY (namespace, key))",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO kv_store (namespace, key, value, updated_at)
         VALUES ('ignored_repos', 'paths', '[\"pkg\"]', datetime('now'))",
        [],
    )
    .unwrap();

    assert!(
        !dirty_for(dir.path().to_str().unwrap()),
        "the dirty probe must see an ignore list written on a still-open WAL connection"
    );
    drop(conn);
}

#[test]
fn git_projects_dirty_returns_one_row_per_input_in_order() {
    let clean = TempDir::new().unwrap();
    committed_repo(&clean);
    let dirty = TempDir::new().unwrap();
    committed_repo(&dirty);
    fs::write(dirty.path().join("a.txt"), "changed").unwrap();
    let missing = "/no/such/project".to_string();

    let clean_path = clean.path().to_str().unwrap().to_string();
    let dirty_path = dirty.path().to_str().unwrap().to_string();
    let rows = git_projects_dirty_impl(&[clean_path.clone(), missing.clone(), dirty_path.clone()]);

    assert_eq!(
        rows,
        vec![
            ProjectDirty {
                path: clean_path,
                dirty: false,
            },
            ProjectDirty {
                path: missing,
                dirty: false,
            },
            ProjectDirty {
                path: dirty_path,
                dirty: true,
            },
        ]
    );
}
