//! The supervisor agent's policy: the file, its Tauri commands, and the check
//! `spawn_agent_impl` runs again for every agent a supervisor started
//! (ADR 0004, `docs/design-agent-control.md` "Supervisor scope").
//!
//! The rules themselves are pure and live in `policy`. This module does the
//! I/O around them: it reads `<app_data_dir>/supervisor-policy.json` on every
//! check (no cache, so a change in Settings applies to the next spawn), writes
//! it atomically at mode 0600, and canonicalises project paths.

pub mod policy;

use crate::agents::{AgentConfig, AgentInfo, AgentRole, AgentStatus};
use crate::provider_policy::ProviderPolicy;
use crate::providers::{ModelOption, ProviderRegistry};
use policy::{
    check_spawn, insert_stricter, normalize_project_path, parse, ParseReason, ParsedPolicy,
    ProviderModes, RunningChildren, SpawnRequest, SupervisorPolicy, POLICY_VERSION,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const POLICY_FILE_NAME: &str = "supervisor-policy.json";
/// The supervisor's working directory under the app data dir. It owns no
/// project, so it does not run inside one.
pub const SUPERVISOR_DIR_NAME: &str = "supervisor";

pub fn policy_path_in(app_data: &Path) -> PathBuf {
    app_data.join(POLICY_FILE_NAME)
}

/// Reads and parses the file. Missing is `file_missing`; a file that exists
/// but cannot be read is `malformed`. Either way nothing is allowed.
pub fn read_policy_file(path: &Path) -> ParsedPolicy {
    match std::fs::read_to_string(path) {
        Ok(text) => parse(Some(&text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => parse(None),
        Err(_) => parse(Some("")),
    }
}

/// The real path when the folder exists, the normalised text otherwise. A
/// symlinked or `..`-laden path must find the same policy entry as the real
/// one, and a project that does not exist finds none.
pub fn canonical_project_path(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .ok()
        .and_then(|real| real.to_str().map(str::to_string))
        .unwrap_or_else(|| normalize_project_path(path))
}

/// The policy with every project key canonicalised, ready for lookup. Two
/// spellings of one folder (a symlink and its target) merge to the stricter
/// entry, so a deny never loses to an allow by how the keys sort.
pub fn with_canonical_keys(policy: SupervisorPolicy) -> SupervisorPolicy {
    let mut projects = BTreeMap::new();
    for (path, rules) in policy.projects {
        insert_stricter(&mut projects, canonical_project_path(&path), rules);
    }
    SupervisorPolicy { projects, ..policy }
}

/// Arguments that make a CLI run without asking: a mode whose launch carries
/// one of these skips the permission prompts. Matched as whole words of the
/// built command; anything starting `--dangerously` counts as well. A flag
/// that hands approvals to the CLI's own reviewer (Codex `--approve-for-me`,
/// Claude's `auto` classifier) is not one: the prompt is still decided.
pub const SKIP_PERMISSION_FLAGS: [&str; 4] = [
    "--yolo",
    "--auto",
    "bypassPermissions",
    "--bypass-permissions",
];

/// Whether `mode` lets `provider`'s CLI act without permission prompts:
/// the config marks it `"unattended": true`, it is `bypassPermissions`, or
/// the command it builds carries a skip flag. Judged from the built command
/// rather than the mode's name, because providers spell the same thing
/// differently (`auto` is a classifier for Claude and no checks at all for
/// another CLI).
pub fn is_unattended_mode(provider: &dyn crate::providers::AgentProvider, mode: &str) -> bool {
    if policy::REJECTED_PERMISSION_MODES.contains(&mode) {
        return true;
    }
    let marked = provider
        .info()
        .permission_modes
        .iter()
        .any(|option| option.value == mode && option.unattended);
    if marked {
        return true;
    }
    let command = provider
        .build_spawn_command("auto", "x", Some(mode), false, false, false)
        .command;
    command
        .split_whitespace()
        .map(|word| word.trim_matches(|c| c == '"' || c == '\''))
        .any(|word| word.starts_with("--dangerously") || SKIP_PERMISSION_FLAGS.contains(&word))
}

/// Per installed provider: its default mode and which of the modes it lists,
/// its default, and every mode `policy` names for it skip the prompts.
pub fn provider_modes(
    registry: &ProviderRegistry,
    policy: &SupervisorPolicy,
) -> BTreeMap<String, ProviderModes> {
    registry
        .list_providers()
        .into_iter()
        .filter_map(|info| {
            let provider = registry.get(&info.id)?;
            let named = policy
                .projects
                .values()
                .filter_map(|rules| rules.permission_mode.get(&info.id).cloned());
            let modes = modes_of(provider.as_ref(), named);
            Some((info.id, modes))
        })
        .collect()
}

/// One provider's default mode and which of its listed modes, its default and
/// `extra` skip the permission prompts.
pub fn modes_of(
    provider: &dyn crate::providers::AgentProvider,
    extra: impl IntoIterator<Item = String>,
) -> ProviderModes {
    let info = provider.info();
    let mut candidates: Vec<String> = info
        .permission_modes
        .iter()
        .map(|option| option.value.clone())
        .chain(std::iter::once(info.default_permission_mode.clone()))
        .chain(extra)
        .collect();
    candidates.sort();
    candidates.dedup();
    ProviderModes {
        default_mode: Some(info.default_permission_mode).filter(|mode| !mode.is_empty()),
        unattended: candidates
            .into_iter()
            .filter(|mode| is_unattended_mode(provider, mode))
            .collect(),
    }
}

/// Refuses a policy that names a mode skipping the prompts for any installed
/// provider. Run on save; `check_spawn` refuses the same again at spawn, where
/// a provider's default counts too.
pub fn reject_unattended_modes(
    policy: &SupervisorPolicy,
    modes: &BTreeMap<String, ProviderModes>,
) -> Result<(), String> {
    for (path, rules) in &policy.projects {
        for (provider, mode) in &rules.permission_mode {
            if modes
                .get(provider)
                .is_some_and(|known| known.unattended.contains(mode))
            {
                return Err(format!(
                    "Permission mode '{mode}' lets {provider} run without permission prompts; \
                     a supervisor's agents never may ({path})."
                ));
            }
        }
    }
    Ok(())
}

/// The policy a check uses: the file as it is now, keys canonicalised.
pub fn current_policy(app_data: &Path) -> SupervisorPolicy {
    with_canonical_keys(read_policy_file(&policy_path_in(app_data)).policy)
}

/// What every installed provider offers now, in its own order.
pub fn offered_models(registry: &ProviderRegistry) -> BTreeMap<String, Vec<ModelOption>> {
    registry
        .list_providers()
        .into_iter()
        .map(|info| (info.id, info.models))
        .collect()
}

pub fn model_names(offered: &BTreeMap<String, Vec<ModelOption>>) -> BTreeMap<String, Vec<String>> {
    offered
        .iter()
        .map(|(id, models)| {
            (
                id.clone(),
                models.iter().map(|model| model.value.clone()).collect(),
            )
        })
        .collect()
}

/// The children of `supervisor_id` that count against its limits: running or
/// queued, in total and per project.
pub fn running_children(agents: &[AgentInfo], supervisor_id: &str) -> RunningChildren {
    let mut running = RunningChildren::default();
    for agent in agents {
        let counts = matches!(agent.status, AgentStatus::Running | AgentStatus::Queued);
        if !counts || agent.spawned_by_agent_id.as_deref() != Some(supervisor_id) {
            continue;
        }
        running.total += 1;
        if let Some(path) = agent.project_path.as_deref() {
            *running
                .by_project
                .entry(canonical_project_path(path))
                .or_default() += 1;
        }
    }
    running
}

/// Everything the child check needs besides the spawn config.
pub struct ChildCheckInputs<'a> {
    /// Keys canonicalised (`with_canonical_keys`).
    pub policy: &'a SupervisorPolicy,
    pub offered: &'a BTreeMap<String, Vec<String>>,
    pub modes: &'a BTreeMap<String, ProviderModes>,
    pub project_policy: &'a ProviderPolicy,
    pub running: &'a RunningChildren,
}

/// The second check, in `spawn_agent_impl`, of a spawn that names the
/// supervisor that asked for it. The dispatcher already ran `check_spawn`;
/// this one holds even if a spawn reached the frontend some other way.
// code-gate: complexity-cyclomatic - each early return is one condition a supervisor's child must meet; listed flat so none is missed
pub fn check_child_config(
    config: &AgentConfig,
    canonical_project: Option<&str>,
    inputs: &ChildCheckInputs<'_>,
) -> Result<(), String> {
    if config.role() == AgentRole::Supervisor {
        return Err("A supervisor cannot start another supervisor.".to_string());
    }
    let Some(project) = canonical_project else {
        return Err("An agent started by a supervisor needs a project.".to_string());
    };
    let provider = config
        .provider
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "An agent started by a supervisor needs a named provider.".to_string())?;
    let permission_mode = check_spawn(
        inputs.policy,
        inputs.project_policy,
        inputs.offered,
        inputs.modes,
        inputs.running,
        &SpawnRequest {
            project_path: project,
            provider,
            model: &config.model,
            headless: config.headless.unwrap_or(false),
        },
    )
    .map_err(|denied| {
        format!(
            "The supervisor policy refuses this spawn ({}): {}",
            denied.reason.key(),
            denied.message
        )
    })?;
    if config.dangerously_ignore_permissions.unwrap_or(false)
        || config.auto_accept_edits.unwrap_or(false)
    {
        return Err(
            "An agent started by a supervisor runs in the permission mode its policy names, \
             never with permissions skipped or edits auto-accepted."
                .to_string(),
        );
    }
    if config.permission_mode != permission_mode {
        return Err(format!(
            "An agent started by a supervisor runs in permission mode {}, not {}.",
            permission_mode
                .as_deref()
                .unwrap_or("(the provider's default)"),
            config
                .permission_mode
                .as_deref()
                .unwrap_or("(the provider's default)")
        ));
    }
    Ok(())
}

/// Validates a policy the frontend wants saved and returns it the way it will
/// be written. Anything `parse` would drop is an error here instead: a save
/// that quietly lost a project would show Settings a policy the file does not
/// hold.
pub fn validate_for_write(mut value: Value) -> Result<SupervisorPolicy, String> {
    let Some(object) = value.as_object_mut() else {
        return Err("The supervisor policy must be a JSON object.".to_string());
    };
    object
        .entry("version")
        .or_insert_with(|| Value::from(POLICY_VERSION));
    let parsed = parse(Some(&value.to_string()));
    if let Some(entry) = parsed.rejected.first() {
        let project = entry.project.as_deref().unwrap_or("the file");
        return Err(match entry.reason {
            ParseReason::BypassPermissions => {
                format!("bypassPermissions is never allowed for a supervisor's agents ({project}).")
            }
            ParseReason::PathNotAbsolute => {
                format!("Project paths must be absolute ({project}).")
            }
            ParseReason::UnsupportedVersion => {
                format!("This build only writes supervisor policy version {POLICY_VERSION}.")
            }
            _ => format!("The supervisor policy has an invalid entry ({project})."),
        });
    }
    Ok(with_canonical_keys(parsed.policy))
}

/// Temp file at 0600, then a rename, as `app_config::write_credentials_atomic`:
/// a read mid-write sees the old file or the new one, never half of either.
///
/// Each write has its own temp file and writes are serialised: two saves
/// sharing one temp file would truncate each other, and the rename would
/// publish half of one.
pub fn write_policy_atomic(path: &Path, policy: &SupervisorPolicy) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static WRITE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let _writing = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let parent = path
        .parent()
        .ok_or_else(|| "The supervisor policy has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec_pretty(policy).map_err(|error| error.to_string())?;
    let sequence = WRITE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temporary = path.with_extension(format!("json.{}-{sequence}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    drop(file);
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("No app data directory: {error}"))
}

/// The supervisor's working directory, created when missing.
pub fn supervisor_cwd(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join(SUPERVISOR_DIR_NAME);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the supervisor folder: {error}"))?;
    Ok(dir)
}

/// The policy as the file holds it, with what was dropped and why.
#[tauri::command]
pub fn supervisor_policy_get(app: tauri::AppHandle) -> Result<ParsedPolicy, String> {
    Ok(read_policy_file(&policy_path_in(&app_data_dir(&app)?)))
}

/// Validates and saves; answers with the file as it now reads.
#[tauri::command]
pub fn supervisor_policy_set(app: tauri::AppHandle, policy: Value) -> Result<ParsedPolicy, String> {
    let path = policy_path_in(&app_data_dir(&app)?);
    let policy = validate_for_write(policy)?;
    if let Some(registry) = app.try_state::<crate::providers::ProviderRegistryState>() {
        reject_unattended_modes(&policy, &provider_modes(registry.inner(), &policy))?;
    }
    write_policy_atomic(&path, &policy)?;
    Ok(read_policy_file(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn child_config(provider: &str, model: &str) -> AgentConfig {
        serde_json::from_value(json!({
            "name": "child", "model": model, "task": "t", "cwd": null,
            "permissionMode": null, "dangerouslyIgnorePermissions": null,
            "autoAcceptEdits": null, "provider": provider, "headless": true,
            "spawnedByAgentId": "agent-sup"
        }))
        .unwrap()
    }

    fn sample_policy() -> SupervisorPolicy {
        serde_json::from_value(json!({
            "version": 1,
            "supervisor": { "provider": "claude", "model": null },
            "maxRunningChildren": 4,
            "projects": { "/abs/project-a": {
                "allowed": true, "providers": ["claude", "codex"],
                "models": { "claude": ["haiku"] },
                "permissionMode": { "codex": "acceptEdits" },
                "allowInteractive": false, "maxRunning": 1 } }
        }))
        .unwrap()
    }

    fn offered() -> BTreeMap<String, Vec<String>> {
        BTreeMap::from([
            (
                "claude".to_string(),
                vec!["haiku".to_string(), "opus".to_string()],
            ),
            ("codex".to_string(), vec!["gpt-6-luna".to_string()]),
        ])
    }

    fn check(config: &AgentConfig, running: &RunningChildren) -> Result<(), String> {
        let policy = sample_policy();
        let offered = offered();
        check_child_config(
            config,
            Some("/abs/project-a"),
            &ChildCheckInputs {
                policy: &policy,
                offered: &offered,
                modes: &BTreeMap::new(),
                project_policy: &ProviderPolicy::default(),
                running,
            },
        )
    }

    #[test]
    fn a_child_inside_the_policy_passes() {
        assert_eq!(
            check(
                &child_config("claude", "haiku"),
                &RunningChildren::default()
            ),
            Ok(())
        );
        let mut codex = child_config("codex", "gpt-6-luna");
        codex.permission_mode = Some("acceptEdits".into());
        assert_eq!(check(&codex, &RunningChildren::default()), Ok(()));
    }

    #[test]
    fn a_child_outside_the_policy_is_refused_with_the_reason_key() {
        let error =
            check(&child_config("claude", "opus"), &RunningChildren::default()).unwrap_err();
        assert!(error.contains("model_not_allowed"), "{error}");
        let full = RunningChildren {
            total: 1,
            by_project: BTreeMap::from([("/abs/project-a".to_string(), 1)]),
        };
        let error = check(&child_config("claude", "haiku"), &full).unwrap_err();
        assert!(error.contains("project_limit_reached"), "{error}");
        let mut interactive = child_config("claude", "haiku");
        interactive.headless = Some(false);
        assert!(check(&interactive, &RunningChildren::default())
            .unwrap_err()
            .contains("interactive_not_allowed"));
    }

    #[test]
    fn a_child_cannot_choose_its_own_permissions_or_be_a_supervisor() {
        let mut other_mode = child_config("codex", "gpt-6-luna");
        other_mode.permission_mode = Some("plan".into());
        assert!(check(&other_mode, &RunningChildren::default()).is_err());
        let mut skipping = child_config("claude", "haiku");
        skipping.dangerously_ignore_permissions = Some(true);
        assert!(check(&skipping, &RunningChildren::default()).is_err());
        let mut supervisor = child_config("claude", "haiku");
        supervisor.role = Some(AgentRole::Supervisor);
        assert!(check(&supervisor, &RunningChildren::default()).is_err());
        let policy = sample_policy();
        let offered = offered();
        let projectless = check_child_config(
            &child_config("claude", "haiku"),
            None,
            &ChildCheckInputs {
                policy: &policy,
                offered: &offered,
                modes: &BTreeMap::new(),
                project_policy: &ProviderPolicy::default(),
                running: &RunningChildren::default(),
            },
        );
        assert!(projectless.is_err());
    }

    #[test]
    fn running_children_count_only_this_supervisors_live_children() {
        let agent = |id: &str, parent: Option<&str>, status: AgentStatus| AgentInfo {
            id: id.into(),
            status,
            project_path: Some("/abs/project-a".into()),
            spawned_by_agent_id: parent.map(str::to_string),
            ..crate::control_socket::protocol::tests::sample_agent()
        };
        let agents = vec![
            agent("a", Some("sup"), AgentStatus::Running),
            agent("b", Some("sup"), AgentStatus::Queued),
            agent("c", Some("sup"), AgentStatus::Idle),
            agent("d", Some("other"), AgentStatus::Running),
            agent("e", None, AgentStatus::Running),
        ];
        let running = running_children(&agents, "sup");
        assert_eq!(running.total, 2);
        assert_eq!(running.by_project.get("/abs/project-a"), Some(&2));
    }

    #[test]
    fn a_saved_policy_is_private_and_reads_back_the_same() {
        let dir = tempfile::tempdir().unwrap();
        let path = policy_path_in(dir.path());
        assert_eq!(
            read_policy_file(&path).rejected[0].reason,
            ParseReason::FileMissing
        );
        let project = dir.path().join("project-a");
        std::fs::create_dir(&project).unwrap();
        let policy = validate_for_write(json!({
            "projects": { format!("{}/", project.display()): { "allowed": true } }
        }))
        .unwrap();
        write_policy_atomic(&path, &policy).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let read = read_policy_file(&path);
        assert!(read.rejected.is_empty());
        assert_eq!(read.policy, policy);
        let key = canonical_project_path(&project.to_string_lossy());
        assert!(
            read.policy.projects[&key].allowed,
            "stored under the real path"
        );
    }

    #[test]
    fn a_policy_with_bypass_permissions_or_a_bad_entry_is_not_saved() {
        let bypass = validate_for_write(json!({ "projects": { "/abs/p": {
            "allowed": true, "permissionMode": { "claude": "bypassPermissions" } } } }));
        assert!(bypass.unwrap_err().contains("bypassPermissions"));
        assert!(validate_for_write(json!({ "projects": { "rel": {} } })).is_err());
        assert!(
            validate_for_write(json!({ "projects": { "/abs/p": { "maxRunning": -1 } } })).is_err()
        );
        assert!(validate_for_write(json!([1])).is_err());
        assert!(validate_for_write(json!({ "version": 2 })).is_err());
    }

    #[test]
    fn an_unreadable_file_allows_nothing() {
        let dir = tempfile::tempdir().unwrap();
        // A directory where the file should be cannot be read as text.
        std::fs::create_dir(policy_path_in(dir.path())).unwrap();
        let parsed = read_policy_file(&policy_path_in(dir.path()));
        assert!(parsed.policy.projects.is_empty());
        assert_eq!(parsed.rejected[0].reason, ParseReason::Malformed);
    }

    /// Codex's `--approve-for-me` routes approvals to Codex's own reviewer,
    /// like Claude's `auto` classifier: reviewed, not skipped. Bypass and
    /// `--yolo` still count as unattended.
    #[test]
    fn a_reviewer_mode_is_attended_and_a_skip_flag_is_not() {
        let provider = crate::providers::DynamicProvider::new(
            serde_json::from_value(json!({
                "id": "codex", "name": "Codex", "executable": "codex",
                "arguments": [{ "type": "permission", "map": {
                    "auto": "--approve-for-me",
                    "yolo": "--yolo",
                    "bypassPermissions": "--dangerously-bypass-approvals-and-sandbox",
                    "acceptEdits": "--sandbox workspace-write"
                }, "fallback": "" }],
                "info": { "models": [], "permissionModes": [], "defaultModel": "auto",
                          "defaultPermissionMode": "acceptEdits" },
                "versionCheck": { "command": "codex", "args": ["--version"] },
                "promptTemplate": "codex \""
            }))
            .unwrap(),
        );
        assert!(!is_unattended_mode(&provider, "auto"));
        assert!(!is_unattended_mode(&provider, "acceptEdits"));
        assert!(is_unattended_mode(&provider, "yolo"));
        assert!(is_unattended_mode(&provider, "bypassPermissions"));
    }
}
