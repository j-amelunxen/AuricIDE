use super::*;
use crate::agents::*;
use crate::providers::SpawnInjection;

// Preserve the pre-refactor cases' inputs; production callers use the typed gate.
fn admit_spawn(
    config: AgentConfig,
    app_data: Option<&std::path::Path>,
    home: Option<&std::path::Path>,
    agents: &[AgentInfo],
    offered: &std::collections::BTreeMap<String, Vec<String>>,
    modes_for: &dyn Fn(
        &crate::supervisor::policy::SupervisorPolicy,
    ) -> std::collections::BTreeMap<
        String,
        crate::supervisor::policy::ProviderModes,
    >,
) -> Result<AgentConfig, String> {
    admit(
        config,
        AdmissionInputs {
            app_data,
            home,
            agents,
            offered,
            modes_for,
        },
    )
}

// ── Supervisor spawns (ADR 0004) ────────────────────────────────────────────

fn supervisor_test_config(extra: serde_json::Value) -> AgentConfig {
    let mut base = serde_json::json!({
        "name": "a", "model": "haiku", "task": "t", "cwd": "/somewhere",
        "permissionMode": null, "dangerouslyIgnorePermissions": null,
        "autoAcceptEdits": null, "provider": "claude", "headless": true
    });
    for (key, value) in extra.as_object().unwrap() {
        base[key] = value.clone();
    }
    serde_json::from_value(base).unwrap()
}

/// An app data dir whose policy allows `haiku` headless in one project, and
/// that project (initialised, no provider policy of its own).
fn supervisor_test_world() -> (tempfile::TempDir, tempfile::TempDir, String) {
    let app_data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join(".auric")).unwrap();
    std::fs::write(project.path().join(".auric/project.db"), b"").unwrap();
    let path = crate::project_path::canonical_project_path(&project.path().to_string_lossy());
    let policy = crate::supervisor::validate_for_write(serde_json::json!({
        "projects": { path.clone(): {
            "allowed": true, "providers": ["claude"], "models": { "claude": ["haiku"] },
            "maxRunning": 1 } }
    }))
    .unwrap();
    crate::json_store::write_json(&crate::supervisor::policy_path_in(app_data.path()), &policy)
        .unwrap();
    (app_data, project, path)
}

fn no_modes(
    _: &crate::supervisor::policy::SupervisorPolicy,
) -> std::collections::BTreeMap<String, crate::supervisor::policy::ProviderModes> {
    std::collections::BTreeMap::new()
}

fn offered_claude() -> std::collections::BTreeMap<String, Vec<String>> {
    std::collections::BTreeMap::from([(
        "claude".to_string(),
        vec!["haiku".to_string(), "opus".to_string()],
    )])
}

#[test]
fn a_spawn_naming_a_supervisor_is_checked_against_the_policy_again() {
    let (app_data, _project, path) = supervisor_test_world();
    let child = |model: &str| {
        supervisor_test_config(serde_json::json!({
            "model": model, "projectPath": path, "spawnedByAgentId": "agent-sup",
            "runSource": "ui"
        }))
    };
    let admitted = admit_spawn(
        child("haiku"),
        Some(app_data.path()),
        None,
        &[],
        &offered_claude(),
        &no_modes,
    )
    .expect("inside the policy");
    assert_eq!(
        admitted.run_source.as_deref(),
        Some("supervisor"),
        "booked as the supervisor's, whatever the frontend said"
    );

    let refused = admit_spawn(
        child("opus"),
        Some(app_data.path()),
        None,
        &[],
        &offered_claude(),
        &no_modes,
    );
    assert!(refused.unwrap_err().contains("model_not_allowed"));

    let busy = AgentInfo {
        id: "agent-busy".into(),
        project_path: Some(path.clone()),
        spawned_by_agent_id: Some("agent-sup".into()),
        ..crate::control_socket::protocol::tests::sample_agent()
    };
    let full = admit_spawn(
        child("haiku"),
        Some(app_data.path()),
        None,
        &[busy],
        &offered_claude(),
        &no_modes,
    );
    assert!(full.unwrap_err().contains("project_limit_reached"));

    let unchecked = admit_spawn(
        child("haiku"),
        None,
        None,
        &[],
        &offered_claude(),
        &no_modes,
    );
    assert!(
        unchecked.is_err(),
        "no app data dir: refused, not run unchecked"
    );
}

#[test]
fn a_spawn_without_a_supervisor_is_left_alone() {
    let config = supervisor_test_config(serde_json::json!({ "model": "opus" }));
    let admitted = admit_spawn(config, None, None, &[], &offered_claude(), &no_modes).unwrap();
    assert_eq!(admitted.model, "opus");
    assert_eq!(admitted.cwd.as_deref(), Some("/somewhere"));
}

#[test]
fn a_supervisor_runs_interactive_unbound_in_a_fresh_run_folder_in_default_mode() {
    let app_data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let supervisor = || {
        supervisor_test_config(serde_json::json!({
            "role": "supervisor", "projectPath": "/some/project",
            "permissionMode": "bypassPermissions", "dangerouslyIgnorePermissions": true,
            "autoAcceptEdits": true, "headless": true, "launchRequestUid": "req-1"
        }))
    };
    let admit = |config| {
        admit_spawn(
            config,
            Some(app_data.path()),
            Some(home.path()),
            &[],
            &offered_claude(),
            &no_modes,
        )
    };
    let admitted = admit(supervisor()).unwrap();
    let again = admit(supervisor()).unwrap();
    let runs = home.path().join(".auric").join("supervisors");
    let folder = std::path::PathBuf::from(admitted.cwd.clone().unwrap());
    assert_eq!(folder.parent(), Some(runs.as_path()));
    assert!(folder.is_dir());
    assert_ne!(
        admitted.cwd, again.cwd,
        "every run gets a folder of its own"
    );
    assert_eq!(admitted.project_path, None);
    assert_eq!(admitted.headless, Some(false));
    assert_eq!(admitted.permission_mode.as_deref(), Some("default"));
    assert_eq!(admitted.dangerously_ignore_permissions, Some(false));
    assert_eq!(admitted.auto_accept_edits, Some(false));
    assert_eq!(admitted.launch_request_uid, None);

    let homeless = admit_spawn(
        supervisor(),
        Some(app_data.path()),
        None,
        &[],
        &offered_claude(),
        &no_modes,
    );
    assert!(
        homeless.is_err(),
        "no home: refused, not run somewhere else"
    );

    let nested = supervisor_test_config(serde_json::json!({
        "role": "supervisor", "spawnedByAgentId": "agent-sup"
    }));
    assert!(admit(nested).is_err());
}

#[test]
fn a_supervisor_without_skills_has_file_tools_and_only_the_timer_shell_grant() {
    assert!(check_supervisor_provider("claude").is_ok());
    assert!(check_supervisor_provider("codex").is_ok());
    assert!(check_supervisor_provider("unsupported")
        .unwrap_err()
        .contains("Claude Code and Codex"));
    assert_eq!(
        supervisor_claude_arguments(
            "/data/agent-bindings/sup $1.mcp.json",
            &crate::supervisor::SkillPlugin::default(),
            false,
            &[]
        ),
        vec![
            "--mcp-config",
            "\"/data/agent-bindings/sup \\$1.mcp.json\"",
            "--strict-mcp-config",
            "--tools",
            "\"Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Bash\"",
            "--restricted",
            "--allowedTools",
            "\"mcp__auric-supervisor__*\"",
            "Read",
            "Write",
            "Edit",
            "Glob",
            "Grep",
            "Skill",
            "ToolSearch",
            "\"Bash(sleep *)\"",
            "--no-chrome",
            "--permission-mode",
            "dontAsk",
        ]
    );
}

#[test]
fn an_approved_skill_brings_its_plugin_and_exactly_its_shell_commands() {
    let skills = crate::supervisor::SkillPlugin {
        dir: Some("/data/supervisor-skills/run 1".into()),
        skills: vec!["video-to-tasklist".to_string()],
        bash: vec!["~/.claude/skills/video-to-tasklist/scripts/*".to_string()],
        dirs: vec!["/home/u/review workspace".to_string()],
    };
    let args = supervisor_claude_arguments("/c.json", &skills, true, &[]);
    let joined = args.join(" ");
    assert!(joined.contains("--tools \"Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Bash\""));
    assert!(joined.contains("--add-dir \"/home/u/review workspace\" --allowedTools"));
    assert!(joined.contains("\"mcp__auric-supervisor__*\" \"mcp__claude-in-chrome__*\""));
    assert!(joined.contains("--plugin-dir \"/data/supervisor-skills/run 1\""));
    assert!(joined.contains("\"Bash(~/.claude/skills/video-to-tasklist/scripts/*)\""));
    assert!(
        !args.iter().any(|a| a == "Bash" || a == "\"Bash\""),
        "never a bare Bash: {joined}"
    );
    assert!(joined.ends_with("--chrome --permission-mode dontAsk"));
    assert!(joined.contains("\"mcp__claude-in-chrome__*\""));
}

#[test]
fn an_approved_tool_alone_gives_bash_and_exactly_its_two_rules() {
    let mut plugin = crate::supervisor::SkillPlugin::default();
    let tools = std::collections::BTreeMap::from([(
        "umi".to_string(),
        crate::supervisor::policy::ToolRules::default(),
    )]);
    crate::supervisor::apply_tool_grants(&mut plugin, &tools);
    let args = supervisor_claude_arguments("/c.json", &plugin, false, &[]);
    let joined = args.join(" ");
    assert!(joined.contains("--tools \"Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Bash\""));
    assert!(
        !joined.contains("--plugin-dir"),
        "a tool is not a skill: {joined}"
    );
    assert!(joined.contains("\"Bash(umi)\" \"Bash(umi *)\" --no-chrome"));
}

#[test]
fn the_supervisor_flags_land_behind_the_executable_and_before_the_task() {
    let config: crate::providers::ProviderConfig = serde_json::from_str(
        r#"{
          "id": "claude", "name": "Claude Code", "executable": "claude",
          "arguments": [
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "headless", "flag": "-p" },
            { "type": "task", "quote": true },
            { "type": "permission", "map": { "default": "" }, "fallback": "" }
          ],
          "info": { "models": [], "permissionModes": [], "defaultModel": "sonnet",
                    "defaultPermissionMode": "default" },
          "versionCheck": { "command": "claude", "args": ["--version"] },
          "promptTemplate": "claude -p \""
        }"#,
    )
    .unwrap();
    let provider = crate::providers::dynamic::DynamicProvider::new(config);
    let cmd = crate::providers::AgentProvider::build_spawn_command(
        &provider,
        "opus",
        "plan the week",
        Some("default"),
        false,
        false,
        false,
    )
    .with_injection(SpawnInjection {
        arguments: supervisor_claude_arguments(
            "/c.json",
            &crate::supervisor::SkillPlugin::default(),
            false,
            &[],
        ),
        env_vars: Vec::new(),
    });
    assert_eq!(
        cmd.command,
        "claude --mcp-config \"/c.json\" --strict-mcp-config \
         --tools \"Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Bash\" --restricted \
         --allowedTools \"mcp__auric-supervisor__*\" Read Write Edit Glob Grep Skill ToolSearch \
         \"Bash(sleep *)\" --no-chrome --permission-mode dontAsk --model opus \"plan the week\""
    );
}

#[test]
fn supervisor_codex_arguments_configures_mcp_servers() {
    let runtime = std::path::Path::new("/bin/runtime.js");
    let socket = std::path::Path::new("/tmp/auric.sock");
    let mut pm_env = std::collections::BTreeMap::new();
    pm_env.insert("AURIC_PROJECT".to_string(), "p1".to_string());

    let args =
        supervisor_codex_arguments(runtime, socket, &pm_env, "/opt/homebrew/bin/node").unwrap();
    let joined = args.join(" ");
    assert!(joined.contains("mcp_servers.auric-supervisor.command=\"/opt/homebrew/bin/node\""));
    assert!(
        joined.contains("mcp_servers.auric-supervisor.args=[\"/bin/runtime.js\",\"--supervisor\"]")
    );
    assert!(joined.contains("mcp_servers.auric-supervisor.required=true"));
    assert!(joined.contains("mcp_servers.auric-supervisor.default_tools_approval_mode=\"approve\""));
    assert!(joined.contains("\"AURIC_CONTROL_SOCKET\"=\"/tmp/auric.sock\""));
    // TOML string escapes in the arguments, then one shell quoting around them.
    assert!(joined.contains("\"AURIC_PM_CHILD_ENV\"="));
    assert!(joined.contains("AURIC_PROJECT"));
    assert!(
        !joined.contains("--project-root") && !joined.contains("auric-pm"),
        "no server per project: {joined}"
    );
}

#[test]
fn a_resumed_supervisor_works_in_the_run_folder_it_names() {
    let app_data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let earlier =
        crate::supervisor::new_supervisor_run_dir(home.path(), "2026-10-01_090000").unwrap();
    std::fs::write(earlier.join("notes.md"), b"where we were").unwrap();
    let resume = |dir: &std::path::Path| {
        admit_spawn(
            supervisor_test_config(serde_json::json!({
                "role": "supervisor", "resumeRunDir": dir.to_string_lossy()
            })),
            Some(app_data.path()),
            Some(home.path()),
            &[],
            &offered_claude(),
            &no_modes,
        )
    };

    let admitted = resume(&earlier).unwrap();
    assert_eq!(
        admitted.cwd.as_deref(),
        Some(earlier.canonicalize().unwrap().to_string_lossy().as_ref())
    );
    assert_eq!(admitted.resume_run_dir, None);
    assert_eq!(admitted.permission_mode.as_deref(), Some("default"));
    let runs = std::fs::read_dir(earlier.parent().unwrap())
        .unwrap()
        .count();
    assert_eq!(runs, 1, "no new folder next to the resumed one");

    let outside = tempfile::tempdir().unwrap();
    assert!(
        resume(outside.path()).is_err(),
        "a folder outside the runs root is refused"
    );
    assert!(
        resume(earlier.parent().unwrap()).is_err(),
        "the runs root itself is refused"
    );
}

#[test]
fn a_supervisor_restored_after_a_restart_resumes_its_own_folder() {
    let mut persisted = persisted_from_config(
        &supervisor_test_config(serde_json::json!({
            "role": "supervisor", "cwd": "/Users/dev/.auric/supervisors/2026-10-01_090000"
        })),
        "agent-sup",
        "claude",
        0,
    );
    persisted.role = Some(AgentRole::Supervisor);
    let resumed = resumed_config(persisted.clone(), None);
    assert_eq!(
        resumed.resume_run_dir.as_deref(),
        Some("/Users/dev/.auric/supervisors/2026-10-01_090000")
    );

    persisted.role = Some(AgentRole::Worker);
    assert_eq!(resumed_config(persisted, None).resume_run_dir, None);
}

// ── Several supervisors ─────────────────────────────────────────────────────

fn live_supervisor(id: &str, key: Option<&str>, run_dir: &std::path::Path) -> AgentInfo {
    AgentInfo {
        id: id.into(),
        role: AgentRole::Supervisor,
        supervisor_key: key.map(str::to_string),
        repo_path: Some(run_dir.to_string_lossy().into_owned()),
        project_path: None,
        ..crate::control_socket::protocol::tests::sample_agent()
    }
}

#[test]
fn a_run_folder_a_live_supervisor_works_in_is_not_resumed_twice() {
    let app_data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let run = crate::supervisor::new_supervisor_run_dir(home.path(), "2026-10-21_090000").unwrap();
    let other =
        crate::supervisor::new_supervisor_run_dir(home.path(), "2026-10-21_100000").unwrap();
    let resume = |dir: &std::path::Path, live: &[AgentInfo]| {
        admit_spawn(
            supervisor_test_config(serde_json::json!({
                "role": "supervisor", "resumeRunDir": dir.to_string_lossy()
            })),
            Some(app_data.path()),
            Some(home.path()),
            live,
            &offered_claude(),
            &no_modes,
        )
    };
    let live = [live_supervisor("agent-3", None, &run)];
    let refused = resume(&run, &live).unwrap_err();
    assert!(
        refused.contains("is already in use by the running supervisor agent-3"),
        "{refused}"
    );
    let admitted = resume(&other, &live).expect("another run resumes");
    assert_eq!(
        admitted.resumed_run_dir, admitted.cwd,
        "the resume is remembered"
    );

    let mut finished = live[0].clone();
    finished.status = AgentStatus::Idle;
    assert!(
        resume(&run, &[finished]).is_ok(),
        "a finished one holds nothing"
    );
}

#[test]
fn a_supervisor_key_is_checked_written_to_the_run_and_taken_back_on_resume() {
    let app_data = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let admit = |extra: serde_json::Value, live: &[AgentInfo]| {
        let mut config = serde_json::json!({ "role": "supervisor" });
        for (key, value) in extra.as_object().unwrap() {
            config[key] = value.clone();
        }
        admit_spawn(
            supervisor_test_config(config),
            Some(app_data.path()),
            Some(home.path()),
            live,
            &offered_claude(),
            &no_modes,
        )
    };
    let keyed = admit(serde_json::json!({ "supervisorKey": "mail-triage" }), &[]).unwrap();
    assert_eq!(keyed.supervisor_key.as_deref(), Some("mail-triage"));
    let run = std::path::PathBuf::from(keyed.cwd.clone().unwrap());
    assert_eq!(
        crate::supervisor::several::read_run_key(&run).as_deref(),
        Some("mail-triage")
    );

    let holder = [live_supervisor(
        "agent-3",
        Some("mail-triage"),
        std::path::Path::new("/x"),
    )];
    let taken = admit(
        serde_json::json!({ "supervisorKey": "mail-triage" }),
        &holder,
    );
    assert!(taken
        .unwrap_err()
        .contains("is already the key of a running supervisor (agent-3)"));
    let malformed = admit(serde_json::json!({ "supervisorKey": "Mail" }), &[]);
    assert!(malformed
        .unwrap_err()
        .contains("is not a valid supervisor key"));

    let resumed = admit(
        serde_json::json!({ "resumeRunDir": run.to_string_lossy() }),
        &[],
    )
    .unwrap();
    assert_eq!(
        resumed.supervisor_key.as_deref(),
        Some("mail-triage"),
        "a resume without a key of its own takes the run's"
    );
    let taken_on_resume = admit(
        serde_json::json!({ "resumeRunDir": run.to_string_lossy() }),
        &holder,
    );
    let refusal = taken_on_resume.unwrap_err();
    assert!(
        refusal.contains("remembers the key 'mail-triage'") && refusal.contains("(agent-3)"),
        "the refusal says the run's own key is taken, and by whom: {refusal}"
    );
    assert!(crate::supervisor::several::is_busy_refusal(&refusal));

    let worker = admit_spawn(
        supervisor_test_config(serde_json::json!({ "supervisorKey": "mail-triage" })),
        Some(app_data.path()),
        Some(home.path()),
        &[],
        &offered_claude(),
        &no_modes,
    );
    assert_eq!(
        worker.unwrap_err(),
        crate::supervisor::several::WORKER_KEY_MESSAGE
    );
}

#[test]
fn a_restored_supervisor_names_the_id_it_replaces_and_keeps_its_key() {
    let mut persisted = persisted_from_config(
        &supervisor_test_config(serde_json::json!({
            "role": "supervisor", "supervisorKey": "mail-triage",
            "cwd": "/Users/dev/.auric/supervisors/2026-10-01_090000"
        })),
        "agent-sup",
        "claude",
        0,
    );
    persisted.role = Some(AgentRole::Supervisor);
    let resumed = resumed_config(persisted, None);
    assert_eq!(resumed.supervisor_key.as_deref(), Some("mail-triage"));
    assert_eq!(resumed.replaces_agent_id.as_deref(), Some("agent-sup"));
}

#[test]
fn the_loser_of_a_launch_race_is_stopped_before_it_is_refused() {
    let run = std::path::Path::new("/r/2026-10-21_090000");
    let winner = live_supervisor("agent-3", Some("mail-triage"), run);
    let keyed = supervisor_test_config(serde_json::json!({
        "role": "supervisor", "supervisorKey": "mail-triage"
    }));
    let mut killed = false;
    let refused = super::refuse_late_supervisor(&[winner.clone()], &keyed, || {
        killed = true;
    });
    assert!(refused.is_err() && killed, "same key: refused and stopped");

    let mut resumed = supervisor_test_config(serde_json::json!({ "role": "supervisor" }));
    resumed.resumed_run_dir = Some(run.to_string_lossy().into_owned());
    let mut killed = false;
    assert!(
        super::refuse_late_supervisor(&[winner.clone()], &resumed, || killed = true).is_err()
            && killed,
        "same run folder: refused and stopped"
    );

    let free = supervisor_test_config(serde_json::json!({
        "role": "supervisor", "supervisorKey": "docs"
    }));
    let mut killed = false;
    assert!(super::refuse_late_supervisor(&[winner], &free, || killed = true).is_ok());
    assert!(!killed, "the winner of nothing is left alone");
}

/// A home with the runs folders of a `launchKey` fixture case and an app data
/// dir holding its registry.
struct ManagerWorld {
    app_data: tempfile::TempDir,
    home: tempfile::TempDir,
}

impl ManagerWorld {
    fn with_managers(managers: &[serde_json::Value]) -> Self {
        let world = Self {
            app_data: tempfile::tempdir().unwrap(),
            home: tempfile::tempdir().unwrap(),
        };
        let records: Vec<serde_json::Value> = managers
            .iter()
            .map(|manager| {
                world.run(manager["runDir"].as_str().unwrap());
                serde_json::json!({
                    "key": manager["key"], "name": "Release Desk", "runDir": manager["runDir"],
                    "promotedAt": "2026-10-01T00:00:00Z", "archivedAt": manager["archivedAt"],
                    "lastLaunch": null
                })
            })
            .collect();
        std::fs::write(
            world.app_data.path().join("supervisor-managers.json"),
            serde_json::json!({ "version": 1, "managers": records }).to_string(),
        )
        .unwrap();
        world
    }

    fn run(&self, folder: &str) -> std::path::PathBuf {
        let dir = crate::supervisor::supervisor_runs_root(self.home.path()).join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn admit(
        &self,
        resume: Option<&str>,
        key: Option<&str>,
        live: &[AgentInfo],
    ) -> Result<AgentConfig, String> {
        let resume_run_dir = resume.map(|folder| self.run(folder).to_string_lossy().into_owned());
        self.admit_config(
            supervisor_test_config(serde_json::json!({
                "role": "supervisor", "resumeRunDir": resume_run_dir, "supervisorKey": key
            })),
            live,
        )
    }

    fn admit_config(&self, config: AgentConfig, live: &[AgentInfo]) -> Result<AgentConfig, String> {
        admit_spawn(
            config,
            Some(self.app_data.path()),
            Some(self.home.path()),
            live,
            &offered_claude(),
            &no_modes,
        )
    }

    fn live_supervisor(&self, key: Option<&str>, folder: &str) -> AgentInfo {
        AgentInfo {
            id: "agent-3".into(),
            role: AgentRole::Supervisor,
            supervisor_key: key.map(str::to_string),
            repo_path: Some(self.run(folder).to_string_lossy().into_owned()),
            ..crate::control_socket::protocol::tests::sample_agent()
        }
    }

    fn registry(&self) -> serde_json::Value {
        let text =
            std::fs::read_to_string(self.app_data.path().join("supervisor-managers.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }
}

fn managers_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../src/lib/agents/supervisorManagers.fixtures.json"
    ))
    .unwrap()
}

#[test]
fn every_launch_key_case_of_the_fixture_is_decided_as_it_says() {
    let fixture = managers_fixture();
    let table = &fixture["launchKey"];
    for case in table["cases"].as_array().unwrap() {
        let world = ManagerWorld::with_managers(table["managers"].as_array().unwrap());
        let live: Vec<AgentInfo> = case["live"]
            .as_array()
            .unwrap()
            .iter()
            .map(|agent| {
                let folder = agent["repoPath"]
                    .as_str()
                    .unwrap()
                    .rsplit('/')
                    .next()
                    .unwrap();
                world.live_supervisor(agent["supervisorKey"].as_str(), folder)
            })
            .collect();
        if let (Some(folder), Some(file_key)) = (case["resume"].as_str(), case["fileKey"].as_str())
        {
            crate::supervisor::several::write_run_key(&world.run(folder), Some(file_key)).unwrap();
        }
        let outcome = world.admit(case["resume"].as_str(), case["own"].as_str(), &live);
        let expected = &case["result"];
        match (expected.get("error"), outcome) {
            (Some(code), Err(sentence)) => {
                let code = code.as_str().unwrap();
                match fixture["refusals"][code].as_str() {
                    Some(pattern) => assert!(
                        regex::Regex::new(pattern).unwrap().is_match(&sentence),
                        "{case}: {sentence}"
                    ),
                    None => assert!(
                        crate::supervisor::several::is_busy_refusal(&sentence),
                        "{case}: {sentence}"
                    ),
                }
            }
            (None, Ok(admitted)) => {
                assert_eq!(
                    admitted.supervisor_key.as_deref(),
                    expected["key"].as_str(),
                    "{case}"
                );
                if let Some(folder) = expected["resumes"].as_str() {
                    assert!(
                        admitted.cwd.as_deref().unwrap().ends_with(folder),
                        "{case}: {:?}",
                        admitted.cwd
                    );
                }
            }
            (_, other) => panic!("{case}: {other:?}"),
        }
    }
}

#[test]
fn a_manager_runs_under_its_name_and_a_plain_supervisor_keeps_its_own() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    let manager = world.admit(Some("2026-10-21_090000"), None, &[]).unwrap();
    assert_eq!(manager.name, "Release Desk");
    let plain = world.admit(None, None, &[]).unwrap();
    assert_eq!(plain.name, "a");
}

#[test]
fn opening_a_manager_by_key_whose_folder_is_gone_answers_manager_run_missing() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    std::fs::remove_dir_all(world.run("2026-10-21_090000")).unwrap();

    let refused = world.admit(None, Some("release-desk"), &[]).unwrap_err();

    let fixture = managers_fixture();
    let pattern = fixture["refusals"]["manager_run_missing"].as_str().unwrap();
    assert!(
        regex::Regex::new(pattern).unwrap().is_match(&refused),
        "{refused}"
    );
    assert!(
        refused.contains("'2026-10-21_090000'"),
        "the folder name, not a path: {refused}"
    );
}

fn manager_world_with_folder_gone() -> ManagerWorld {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    std::fs::remove_dir_all(world.run("2026-10-21_090000")).unwrap();
    world
}

fn assert_run_missing_by_folder_name(refused: &str) {
    let fixture = managers_fixture();
    let pattern = fixture["refusals"]["manager_run_missing"].as_str().unwrap();
    assert!(
        regex::Regex::new(pattern).unwrap().is_match(refused),
        "{refused}"
    );
    assert!(refused.contains("'2026-10-21_090000'"), "{refused}");
}

fn resume_by_path(world: &ManagerWorld, folder: &str) -> Result<AgentConfig, String> {
    let path = crate::supervisor::supervisor_runs_root(world.home.path()).join(folder);
    world.admit_config(
        supervisor_test_config(serde_json::json!({
            "role": "supervisor", "resumeRunDir": path.to_string_lossy()
        })),
        &[],
    )
}

#[test]
fn resuming_a_gone_manager_folder_by_path_names_the_folder_not_the_path() {
    let world = manager_world_with_folder_gone();
    assert_run_missing_by_folder_name(&resume_by_path(&world, "2026-10-21_090000").unwrap_err());
}

#[test]
fn a_gone_runs_root_is_manager_run_missing_by_path_and_by_key() {
    let world = manager_world_with_folder_gone();
    std::fs::remove_dir_all(crate::supervisor::supervisor_runs_root(world.home.path())).unwrap();
    assert_run_missing_by_folder_name(&resume_by_path(&world, "2026-10-21_090000").unwrap_err());
    assert_run_missing_by_folder_name(&world.admit(None, Some("release-desk"), &[]).unwrap_err());
}

#[test]
fn a_manager_folder_that_is_a_link_to_a_sibling_run_counts_as_missing() {
    let world = manager_world_with_folder_gone();
    let runs = crate::supervisor::supervisor_runs_root(world.home.path());
    let sibling = world.run("2026-09-01_090000");
    std::os::unix::fs::symlink(&sibling, runs.join("2026-10-21_090000")).unwrap();

    assert_run_missing_by_folder_name(&world.admit(None, Some("release-desk"), &[]).unwrap_err());
}

#[test]
fn resuming_a_folder_that_is_no_manager_behaves_as_before_even_with_managers_around() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    let plain = world.admit(Some("2026-09-01_090000"), None, &[]).unwrap();
    assert_eq!(plain.supervisor_key, None);
    assert_eq!(plain.name, "a");
    let keyed = world
        .admit(Some("2026-09-01_090000"), Some("docs"), &[])
        .unwrap();
    assert_eq!(keyed.supervisor_key.as_deref(), Some("docs"));
    assert_eq!(
        world.registry()["managers"][0]["lastLaunch"],
        serde_json::Value::Null,
        "a plain resume touches no manager"
    );
}

#[test]
fn a_stranger_cannot_take_a_managers_key_by_resuming_another_folder() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    let refused = world
        .admit(Some("2026-09-01_090000"), Some("release-desk"), &[])
        .unwrap_err();
    assert!(
        refused.contains("release-desk") && refused.contains("Release Desk"),
        "{refused}"
    );
}

#[test]
fn an_unreadable_registry_stops_a_resume_but_not_a_plain_new_supervisor() {
    let world = ManagerWorld::with_managers(&[]);
    std::fs::write(
        world.app_data.path().join("supervisor-managers.json"),
        "{ nope",
    )
    .unwrap();
    let refused = world
        .admit(Some("2026-09-01_090000"), None, &[])
        .unwrap_err();
    assert!(
        refused.contains("supervisor-managers.json could not be read"),
        "{refused}"
    );
    assert!(world.admit(None, None, &[]).is_ok());
}

#[test]
fn a_manager_launch_is_booked_only_once_the_spawn_goes_ahead_and_never_on_a_restore() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    let no_launch = serde_json::Value::Null;
    let admitted = world.admit(Some("2026-10-21_090000"), None, &[]).unwrap();
    assert_eq!(
        world.registry()["managers"][0]["lastLaunch"],
        no_launch,
        "admission alone books nothing: the spawn can still fail after it"
    );
    let booking = admitted
        .launch_to_book
        .expect("a fresh launch is to be booked");
    assert_eq!(booking.key, "release-desk");

    let mut restored = supervisor_test_config(serde_json::json!({
        "role": "supervisor",
        "resumeRunDir": world.run("2026-10-21_090000").to_string_lossy(),
    }));
    restored.replaces_agent_id = Some("agent-1".into());
    let restored = world.admit_config(restored, &[]).unwrap();
    assert_eq!(restored.name, "Release Desk");
    let booking = restored
        .launch_to_book
        .expect("a restore is a session of its own");
    assert!(booking.restored);
    let registry = world.app_data.path().join("supervisor-managers.json");

    super::apply_booking(&registry, &booking).unwrap();

    let manager = &world.registry()["managers"][0];
    assert_eq!(
        manager["lastLaunch"], no_launch,
        "a restored session replays its old prompt, so it launched with no new instructions"
    );
    assert!(manager["session"]["startedAt"].is_string());
    assert_eq!(manager["session"]["notedAt"], serde_json::Value::Null);
}

#[test]
fn opening_a_manager_records_the_instructions_it_was_launched_with() {
    use sha2::{Digest, Sha256};
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    std::fs::write(
        world.run("2026-10-21_090000").join("INSTRUCTIONS.md"),
        "Write Spanish.",
    )
    .unwrap();
    let booking = world
        .admit(Some("2026-10-21_090000"), None, &[])
        .unwrap()
        .launch_to_book
        .unwrap();
    crate::supervisor::managers::record_launch(
        &world.app_data.path().join("supervisor-managers.json"),
        &booking.key,
        booking.instructions.as_deref(),
    )
    .unwrap();
    let launch = &world.registry()["managers"][0]["lastLaunch"];
    assert_eq!(
        launch["instructionsSha256"],
        format!("{:x}", Sha256::digest(b"Write Spanish."))
    );
    assert!(launch["at"].as_str().unwrap().ends_with('Z'));
}

#[test]
fn instructions_over_the_limit_refuse_the_launch_and_record_nothing() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    std::fs::write(
        world.run("2026-10-21_090000").join("INSTRUCTIONS.md"),
        "x".repeat(16385),
    )
    .unwrap();
    let refused = world
        .admit(Some("2026-10-21_090000"), None, &[])
        .unwrap_err();
    let pattern = managers_fixture()["refusals"]["instructions_too_large"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        regex::Regex::new(&pattern).unwrap().is_match(&refused),
        "{refused}"
    );
    assert_eq!(
        world.registry()["managers"][0]["lastLaunch"],
        serde_json::Value::Null
    );
}

#[test]
fn only_the_run_folder_of_a_manager_gets_the_deny_rules() {
    let world = ManagerWorld::with_managers(
        managers_fixture()["launchKey"]["managers"]
            .as_array()
            .unwrap(),
    );
    let denied = |folder: &str| super::manager_denied_tools_for_run(world.app_data.path(), folder);
    assert_eq!(denied("2026-10-21_090000"), manager_denied_tools());
    assert!(
        denied("2026-09-01_090000").is_empty(),
        "a plain run is unrestricted"
    );
    std::fs::remove_file(world.app_data.path().join("supervisor-managers.json")).unwrap();
    assert!(
        denied("2026-10-21_090000").is_empty(),
        "no registry, no manager"
    );
}

#[test]
fn a_manager_launch_adds_the_deny_rules_before_the_last_flag_and_a_plain_one_adds_nothing() {
    let instructions = &managers_fixture()["instructions"];
    let denied: Vec<String> = instructions["denyRules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|rule| format!("\"{}\"", rule.as_str().unwrap()))
        .collect();
    let plugin = crate::supervisor::SkillPlugin::default();
    let plain = supervisor_claude_arguments("/c.json", &plugin, false, &[]);
    assert!(!plain
        .iter()
        .any(|a| a == instructions["denyFlag"].as_str().unwrap()));
    let manager = supervisor_claude_arguments("/c.json", &plugin, false, &manager_denied_tools());
    let flag = manager
        .iter()
        .position(|a| a == instructions["denyFlag"].as_str().unwrap())
        .unwrap();
    assert_eq!(&manager[flag + 1..flag + 1 + denied.len()], &denied[..]);
    assert_eq!(
        &manager[flag + 1 + denied.len()..],
        ["--permission-mode", "dontAsk"],
        "a value-taking flag must be followed by a flag, never by the task"
    );
}

#[test]
fn a_resumed_supervisor_takes_over_live_persisted_and_finished_children_and_says_so() {
    let run = "/home/user/.auric/supervisors/2026-10-21_090000";
    let persistence = crate::agent_persistence::new_agent_persistence_state(None);
    {
        let mut p = persistence.lock().unwrap();
        let mut old = persisted_from_config(
            &supervisor_test_config(serde_json::json!({ "role": "supervisor", "cwd": run })),
            "agent-1",
            "claude",
            0,
        );
        old.role = Some(AgentRole::Supervisor);
        p.record_spawn(old).unwrap();
        let child = persisted_from_config(
            &supervisor_test_config(serde_json::json!({ "spawnedByAgentId": "agent-1" })),
            "agent-2",
            "claude",
            0,
        );
        p.record_spawn(child).unwrap();
    }
    let results = crate::agents::run_results::RunResults::default();
    let finished_child = AgentInfo {
        id: "agent-4".into(),
        spawned_by_agent_id: Some("agent-1".into()),
        ..crate::control_socket::protocol::tests::sample_agent()
    };
    results.record_finished(
        crate::agents::run_results::RunResult::from_finish(
            "agent-4",
            AgentStatus::Idle,
            Some(0),
            None,
            || None,
            1,
        ),
        finished_child,
    );
    let mut live = vec![
        AgentInfo {
            id: "agent-2".into(),
            spawned_by_agent_id: Some("agent-1".into()),
            ..crate::control_socket::protocol::tests::sample_agent()
        },
        AgentInfo {
            id: "agent-5".into(),
            spawned_by_agent_id: Some("agent-9".into()),
            ..crate::control_socket::protocol::tests::sample_agent()
        },
    ];
    let mut emitted = Vec::new();
    let adoption = super::adopt_into(
        live.iter_mut(),
        Some(&persistence),
        Some(&results),
        (run, None, "agent-20"),
        |adoption| emitted.push(serde_json::to_value(adoption).unwrap()),
    )
    .expect("the run had a supervisor before");
    assert_eq!(adoption.from_ids, vec!["agent-1"]);
    assert_eq!(live[0].spawned_by_agent_id.as_deref(), Some("agent-20"));
    assert_eq!(live[1].spawned_by_agent_id.as_deref(), Some("agent-9"));
    assert_eq!(results.parent_of("agent-4").as_deref(), Some("agent-20"));
    let persisted_parent = persistence
        .lock()
        .unwrap()
        .agents()
        .find(|agent| agent.id == "agent-2")
        .and_then(|agent| agent.spawned_by_agent_id.clone());
    assert_eq!(persisted_parent.as_deref(), Some("agent-20"));
    assert_eq!(
        emitted,
        vec![serde_json::json!({ "fromIds": ["agent-1"], "toId": "agent-20" })],
        "one event with exactly what moved"
    );

    let mut nothing = Vec::new();
    assert!(super::adopt_into(
        live.iter_mut(),
        Some(&persistence),
        Some(&results),
        ("/home/user/.auric/supervisors/other", None, "agent-21"),
        |adoption| nothing.push(adoption.clone()),
    )
    .is_none());
    assert!(nothing.is_empty(), "no earlier supervisor: no event");
}

#[test]
fn role_and_supervisor_survive_a_restart() {
    let config = supervisor_test_config(serde_json::json!({
        "spawnedByAgentId": "agent-sup", "role": "worker"
    }));
    let persisted = persisted_from_config(&config, "agent-9", "claude", 1);
    let resumed = resumed_config(persisted, None);
    assert_eq!(resumed.role, Some(AgentRole::Worker));
    assert_eq!(resumed.spawned_by_agent_id.as_deref(), Some("agent-sup"));
}

/// Counting canonicalizes every child's project path before provider modes
/// are read. A callback changing a symlink must not move an existing child
/// out of the limit snapshot used by this admission.
#[cfg(unix)]
#[test]
fn child_project_counts_are_captured_before_provider_modes_are_read() {
    let (app_data, project, path) = supervisor_test_world();
    let alias_root = tempfile::tempdir().unwrap();
    let other_project = tempfile::tempdir().unwrap();
    let alias = alias_root.path().join("project-alias");
    std::os::unix::fs::symlink(project.path(), &alias).unwrap();
    let live = AgentInfo {
        project_path: Some(alias.to_string_lossy().into_owned()),
        spawned_by_agent_id: Some("agent-sup".into()),
        status: AgentStatus::Running,
        ..crate::control_socket::protocol::tests::sample_agent()
    };
    let config = supervisor_test_config(serde_json::json!({
        "projectPath": path, "spawnedByAgentId": "agent-sup"
    }));
    let modes_for = |_: &crate::supervisor::policy::SupervisorPolicy| {
        std::fs::remove_file(&alias).unwrap();
        std::os::unix::fs::symlink(other_project.path(), &alias).unwrap();
        std::collections::BTreeMap::new()
    };
    let error = admit_spawn(
        config,
        Some(app_data.path()),
        None,
        &[live],
        &offered_claude(),
        &modes_for,
    )
    .expect_err("the original project was at its child limit before modes were read");
    assert!(error.contains("project_limit_reached"), "{error}");
}
