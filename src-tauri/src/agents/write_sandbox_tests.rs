use super::*;

/// Scratch dirs under `target/`, which none of the sandbox's standing
/// allowances (temp dirs, caches) cover — so a write that lands there was
/// allowed by the workspace rule and nothing else.
fn scratch() -> tempfile::TempDir {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    std::fs::create_dir_all(&base).unwrap();
    tempfile::tempdir_in(base).unwrap()
}

fn inputs<'a>(cwd: &'a Path, home: &'a Path, extra: &'a [String]) -> SandboxInputs<'a> {
    SandboxInputs {
        cwd: Some(cwd),
        project_root: None,
        home,
        provider_writable: extra,
        notifications_db: None,
    }
}

#[test]
fn refuses_without_a_workspace() {
    let home = scratch();
    let none = SandboxInputs {
        cwd: None,
        project_root: None,
        home: home.path(),
        provider_writable: &[],
        notifications_db: None,
    };
    assert!(writable_paths(&none).is_err());
    let missing = inputs(Path::new("/definitely/not/here"), home.path(), &[]);
    assert!(writable_paths(&missing).is_err());
}

#[test]
fn workspace_project_and_provider_paths_are_writable() {
    let cwd = scratch();
    let project = scratch();
    let home = scratch();
    let extra = vec!["~/.cli-state".to_string()];
    let paths = writable_paths(&SandboxInputs {
        project_root: Some(project.path()),
        notifications_db: Some(&home.path().join("inbox.db")),
        ..inputs(cwd.path(), home.path(), &extra)
    })
    .unwrap();
    let real = |p: &Path| std::fs::canonicalize(p).unwrap();
    assert!(paths.dirs.contains(&real(cwd.path())));
    assert!(paths.dirs.contains(&real(project.path())));
    assert!(paths.dirs.contains(&real(home.path()).join(".cli-state")));
    assert!(paths.dirs.contains(&real(home.path()).join(".npm")));
    // The home itself is not writable, only named places in it.
    assert!(!paths.dirs.contains(&real(home.path())));
    assert!(paths
        .files
        .contains(&real(home.path()).join("inbox.db-wal")));
}

#[test]
fn a_worktree_may_write_its_shared_git_dir() {
    let main = scratch();
    let wt = scratch();
    let common = main.path().join(".git");
    let gitdir = common.join("worktrees").join("wt");
    std::fs::create_dir_all(&gitdir).unwrap();
    std::fs::write(gitdir.join("commondir"), "../..\n").unwrap();
    std::fs::write(
        wt.path().join(".git"),
        format!("gitdir: {}\n", gitdir.display()),
    )
    .unwrap();

    let home = scratch();
    let paths = writable_paths(&inputs(wt.path(), home.path(), &[])).unwrap();
    assert!(paths
        .dirs
        .contains(&std::fs::canonicalize(&common).unwrap()));
    // Only its .git, not the rest of the main checkout.
    assert!(!paths
        .dirs
        .contains(&std::fs::canonicalize(main.path()).unwrap()));
}

#[test]
fn profile_denies_writes_then_allows_the_listed_paths() {
    let paths = WritablePaths {
        dirs: vec![PathBuf::from("/work/a \"b\"")],
        files: vec![PathBuf::from("/data/inbox.db")],
    };
    let text = profile(&paths);
    let deny = text.find("(deny file-write*)").unwrap();
    let allow = text.find("(allow file-write*").unwrap();
    assert!(deny < allow, "the allow list must come after the deny");
    assert!(text.contains(r#"(subpath "/work/a \"b\"")"#));
    assert!(text.contains(r#"(literal "/data/inbox.db")"#));
}

#[test]
fn confine_wraps_the_whole_command_line() {
    let cmd = SpawnCommand {
        command: "agy -p \"task; rm -rf ~\" --dangerously-skip-permissions".to_string(),
        env_vars: vec![],
        executable: "agy".to_string(),
    };
    let confined = confine(cmd, "(version 1)\n(allow default)");
    assert!(confined
        .command
        .starts_with("/usr/bin/sandbox-exec -p '(version 1)\n(allow default)' agy -p"));
    assert!(confined.command.ends_with("--dangerously-skip-permissions"));
    assert!(confined.executable.ends_with(" agy"));
}

/// The profile where it acts: a real process under sandbox-exec.
#[cfg(target_os = "macos")]
#[test]
fn a_confined_shell_writes_its_workspace_and_nothing_else() {
    let workspace = scratch();
    let outside = scratch();
    let home = scratch();
    let paths = writable_paths(&inputs(workspace.path(), home.path(), &[])).unwrap();
    let inside_file = workspace.path().join("inside.txt");
    let outside_file = outside.path().join("outside.txt");
    let tmp_file = format!("/tmp/auric-write-sandbox-{}", std::process::id());
    let script = format!(
        "touch {} ; touch {} ; mkdir -p {}/sub ; mkdir -p ./tmp && touch ./tmp/scratch ; touch {}",
        shell_word(&inside_file.display().to_string()),
        shell_word(&outside_file.display().to_string()),
        shell_word(&workspace.path().display().to_string()),
        shell_word(&tmp_file),
    );
    let status = std::process::Command::new(SANDBOX_EXEC)
        .args(["-p", &profile(&paths), "/bin/sh", "-c", &script])
        .current_dir(workspace.path())
        .status()
        .unwrap();
    assert!(status.code().is_some());
    assert!(inside_file.exists(), "the workspace must stay writable");
    assert!(workspace.path().join("sub").is_dir());
    assert!(
        workspace.path().join("tmp/scratch").exists(),
        "./tmp is part of the workspace"
    );
    assert!(Path::new(&tmp_file).exists(), "/tmp must stay writable");
    let _ = std::fs::remove_file(&tmp_file);
    assert!(
        !outside_file.exists(),
        "a write outside the workspace must be denied"
    );
}

/// The whole chain against the real Antigravity CLI, where it acts: the
/// command line a conductor spawn builds (headless, default `auto` mode), the
/// write sandbox around it, and the auric-pm server reached through the
/// global bridge entry. Needs `agy` logged in, the `auric-pm` bridge entry in
/// its MCP config and a built `src-tauri/resources/auric-mcp`. Costs a model
/// turn, so it is ignored by default:
///
///   cargo test agy_headless_end_to_end -- --ignored --nocapture
#[cfg(target_os = "macos")]
#[test]
#[ignore]
fn agy_headless_end_to_end() {
    use crate::providers::{AgentProvider, DynamicProvider};

    let workspace = scratch();
    let outside = scratch();
    let ws = std::fs::canonicalize(workspace.path()).unwrap();
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(&ws)
            .output()
            .unwrap()
    };
    git(&["init", "-q"]);
    git(&[
        "-c",
        "user.email=p@example.invalid",
        "-c",
        "user.name=p",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init",
    ]);

    // An AuricIDE project: the MCP server refuses a folder without its database.
    std::fs::create_dir_all(ws.join(".auric")).unwrap();
    std::fs::write(ws.join(".auric/project.db"), b"").unwrap();

    // The per-project binding file, shaped like `ensure_agent_mcp_config` writes it.
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let server = manifest.join("resources/auric-mcp/server.mjs");
    assert!(
        server.exists(),
        "build the MCP runtime first (scripts/build-mcp-runtime.mjs)"
    );
    let binding = outside.path().join("project.mcp.json");
    std::fs::write(
        &binding,
        serde_json::json!({ "mcpServers": { "auric-pm": {
            "command": "node",
            "args": [server, "--project-root", ws],
        } } })
        .to_string(),
    )
    .unwrap();

    let provider = DynamicProvider::new(
        serde_json::from_str(
            &std::fs::read_to_string(manifest.join("../dynamic-providers/antigravity.json"))
                .expect("dynamic-providers/antigravity.json (git-ignored, local)"),
        )
        .unwrap(),
    );
    let outside_file = outside.path().join("escaped.txt");
    let task = format!(
        "Do these steps, each as its own shell command unless said otherwise, and never retry a failed \
         step in another way:\n1. echo hi > inside.txt\n2. git add -A && git -c user.email=p@example.invalid \
         -c user.name=p commit -m probe\n3. echo hi > {}\n4. Call the auric-pm MCP tool list_epics and \
         write the number of epics it returned into mcp.txt with your file tool.\nThen reply DONE.",
        outside_file.display()
    );
    let cmd = provider.build_spawn_command("gemini-3.8-flash-low", &task, None, false, false, true);
    let writable = provider
        .write_sandbox(None, false, false)
        .expect("auto must be confined");
    let home = std::path::PathBuf::from(std::env::var("HOME").unwrap());
    let paths = writable_paths(&SandboxInputs {
        cwd: Some(&ws),
        project_root: Some(&ws),
        home: &home,
        provider_writable: &writable,
        notifications_db: None,
    })
    .unwrap();
    let cmd = confine(cmd, &profile(&paths));
    println!("{}", cmd.command);

    let out = std::process::Command::new("/bin/zsh")
        .args(["-lc", &cmd.command])
        .current_dir(&ws)
        .env("AURIC_MCP_CONFIG", &binding)
        .output()
        .unwrap();
    println!("{}", String::from_utf8_lossy(&out.stdout));
    eprintln!("{}", String::from_utf8_lossy(&out.stderr));

    assert!(
        ws.join("inside.txt").exists(),
        "shell writes in the workspace"
    );
    let log = String::from_utf8_lossy(&git(&["log", "--oneline"]).stdout).to_string();
    assert!(log.contains("probe"), "git commit in the workspace: {log}");
    assert!(
        !outside_file.exists(),
        "a write outside the workspace must be denied"
    );
    let mcp = std::fs::read_to_string(ws.join("mcp.txt")).unwrap_or_default();
    assert!(
        mcp.trim().chars().any(|c| c.is_ascii_digit()),
        "auric-pm reached: {mcp:?}"
    );
}
