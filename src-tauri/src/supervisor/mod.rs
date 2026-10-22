//! The supervisor agent's policy: the file, its Tauri commands, and the check
//! `spawn_agent_impl` runs again for every agent a supervisor started
//! (ADR 0004, `docs/design-agent-control.md` "Supervisor scope").
//!
//! The rules themselves are pure and live in `policy`. This module does the
//! I/O around them: it reads `<app_data_dir>/supervisor-policy.json` on every
//! check (no cache, so a change in Settings applies to the next spawn), writes
//! it atomically at mode 0600, and canonicalises project paths.

pub mod attachments;
pub mod managers;
pub mod policy;
pub mod runs;
pub mod several;

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
/// Every supervisor run works in a folder of its own under the user's home,
/// `~/.auric/supervisors/<start time>/`, the home-level twin of a project's
/// `.auric/`. It owns no project, so it does not run inside one; its file tools
/// reach this folder and nothing else (`--restricted`).
pub const SUPERVISOR_RUNS_DIR: [&str; 2] = [".auric", "supervisors"];
/// The per-run plugin folders that carry the approved skills. They sit under
/// the app data dir, outside the run folder, so the supervisor cannot edit a
/// skill it is about to run.
pub const SKILL_PLUGINS_DIR_NAME: &str = "supervisor-skills";
/// The plugin name Claude Code shows in front of an approved skill
/// (`/auric:video-to-tasklist`); the bare `/video-to-tasklist` resolves too.
pub const SKILL_PLUGIN_NAME: &str = "auric";
/// Plugin folders of runs older than this are removed at the next launch.
const SKILL_PLUGIN_RETENTION: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);

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
pub fn with_canonical_keys(mut policy: SupervisorPolicy) -> SupervisorPolicy {
    policy.connectors.bindings = policy
        .connectors
        .bindings
        .into_iter()
        .map(|(root, grants)| (canonical_project_path(&root), grants))
        .collect();
    let mut projects = BTreeMap::new();
    for (path, rules) in policy.projects {
        insert_stricter(&mut projects, canonical_project_path(&path), rules);
    }
    let mut skills = BTreeMap::new();
    for (path, rules) in policy.skills {
        policy::insert_skill(&mut skills, canonical_project_path(&path), rules);
    }
    SupervisorPolicy {
        projects,
        skills,
        ..policy
    }
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
///
/// Includes unavailable (stale) entries so Settings can mark them; spawn
/// checks go through [`model_names`], which keeps only available ids.
pub fn offered_models(registry: &ProviderRegistry) -> BTreeMap<String, Vec<ModelOption>> {
    registry
        .list_providers()
        .into_iter()
        .map(|info| (info.id, info.models))
        .collect()
}

/// Model ids a spawn may name: available entries only.
pub fn model_names(offered: &BTreeMap<String, Vec<ModelOption>>) -> BTreeMap<String, Vec<String>> {
    offered
        .iter()
        .map(|(id, models)| {
            (
                id.clone(),
                models
                    .iter()
                    .filter(|model| model.is_available())
                    .map(|model| model.value.clone())
                    .collect(),
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

/// Live agents (running or queued) per provider id in the project at
/// `project_path` (canonical), whoever started them. They are not in
/// `pm_agent_usage` yet: a run is booked when it ends.
pub fn live_runs_by_provider(agents: &[AgentInfo], project_path: &str) -> BTreeMap<String, u32> {
    let mut live = BTreeMap::new();
    for agent in agents {
        let counts = matches!(agent.status, AgentStatus::Running | AgentStatus::Queued);
        let here = agent
            .project_path
            .as_deref()
            .is_some_and(|path| canonical_project_path(path) == project_path);
        if counts && here {
            *live
                .entry(policy::normalize_provider_id(&agent.provider))
                .or_default() += 1;
        }
    }
    live
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
        let project = entry
            .project
            .as_deref()
            .or(entry.skill.as_deref())
            .or(entry.tool.as_deref())
            .unwrap_or("the file");
        return Err(match entry.reason {
            ParseReason::BypassPermissions => {
                format!("bypassPermissions is never allowed for a supervisor's agents ({project}).")
            }
            ParseReason::PathNotAbsolute => {
                format!("Project, skill and tool paths must be absolute ({project}).")
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
    write_json_atomic(path, policy)
}

/// The write behind `write_policy_atomic`, for any Rust-owned JSON file next to
/// the policy (the Project Manager registry).
pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static WRITE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let _writing = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let parent = path
        .parent()
        .ok_or_else(|| "The file has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let payload = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
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

/// Every permitted project gets its own `auric-pm` server, named
/// `auric-pm-<folder>` (fixture `pmServerNames`).
pub const PM_SERVER_PREFIX: &str = "auric-pm-";
/// Keeps `mcp__auric-pm-<slug>__<longest tool>` inside Claude Code's 64
/// characters.
const PM_SLUG_MAX: usize = 16;

/// `auric-pm-<slug>` per project path, in the order given. The slug is the
/// folder name in lowercase ASCII letters, digits and dashes, at most 16
/// long; a repeat gets `-2`, `-3`, … The TS twin names the same servers in
/// the launch prompt, so both read `supervisorPolicy.fixtures.json`.
pub fn pm_server_names(paths: &[String]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for path in paths {
        let folder = normalize_project_path(path);
        let base = folder.rsplit('/').next().unwrap_or("").to_lowercase();
        let mut slug = String::new();
        for c in base.chars() {
            let c = if c.is_ascii_alphanumeric() { c } else { '-' };
            if !(c == '-' && (slug.is_empty() || slug.ends_with('-'))) {
                slug.push(c);
            }
        }
        slug.truncate(PM_SLUG_MAX);
        let slug = match slug.trim_end_matches('-') {
            "" => "project".to_string(),
            trimmed => trimmed.to_string(),
        };
        let mut name = format!("{PM_SERVER_PREFIX}{slug}");
        let mut n = 2;
        while names.contains(&name) {
            name = format!("{PM_SERVER_PREFIX}{slug}-{n}");
            n += 1;
        }
        names.push(name);
    }
    names
}

/// The `auric-pm` servers a supervisor gets: one per permitted project that
/// has a project database, named over every permitted project so a name does
/// not shift when another project is initialised.
pub fn supervisor_pm_servers(policy: &SupervisorPolicy) -> Vec<(String, String)> {
    let permitted: Vec<String> = policy
        .projects
        .iter()
        .filter(|(_, rules)| rules.allowed)
        .map(|(path, _)| path.clone())
        .collect();
    pm_server_names(&permitted)
        .into_iter()
        .zip(permitted)
        .filter(|(_, path)| Path::new(path).join(".auric").join("project.db").is_file())
        .collect()
}

/// `~/.auric/supervisors` for this home directory.
pub fn supervisor_runs_root(home: &Path) -> PathBuf {
    SUPERVISOR_RUNS_DIR
        .iter()
        .fold(home.to_path_buf(), |path, part| path.join(part))
}

/// Pre-trusts folders for Claude Code in `~/.claude.json`. Claude Code checks
/// `projects[canonical_path].hasTrustDialogAccepted` in this file to decide
/// whether to display the interactive "Do you trust this workspace?" dialog.
/// Pre-seeding it avoids prompting the user every time a fresh supervisor run
/// folder is created.
///
/// The read-modify-write runs under one process-wide lock: two supervisors
/// starting at once would otherwise each write back what they read, and the
/// later write would drop the earlier one's folder.
pub fn pre_trust_claude_workspace(home: &Path, paths: &[&Path]) -> Result<(), String> {
    static CLAUDE_CONFIG: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _held = CLAUDE_CONFIG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let config_path = home.join(".claude.json");
    let mut root: Value = if config_path.is_file() {
        let text = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Could not read claude config: {e}"))?;
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        root = serde_json::json!({});
    }

    let map = root.as_object_mut().unwrap();
    if !map.contains_key("projects") || !map["projects"].is_object() {
        map.insert("projects".to_string(), serde_json::json!({}));
    }
    let projects = map.get_mut("projects").unwrap().as_object_mut().unwrap();

    for path in paths {
        let canonical = path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf())
            .to_string_lossy()
            .into_owned();
        let raw = path.to_string_lossy().into_owned();

        for key in [&canonical, &raw] {
            if !projects.contains_key(key.as_str()) || !projects[key.as_str()].is_object() {
                projects.insert((*key).clone(), serde_json::json!({}));
            }
            let entry = projects
                .get_mut(key.as_str())
                .unwrap()
                .as_object_mut()
                .unwrap();
            entry.insert("hasTrustDialogAccepted".to_string(), Value::Bool(true));
        }
    }

    let payload = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Could not serialize claude config: {e}"))?;
    std::fs::write(&config_path, payload)
        .map_err(|e| format!("Could not write claude config: {e}"))?;
    Ok(())
}

/// A new, empty working folder for one supervisor run, named by its start
/// time. Two runs in the same second get `-2`, `-3`, …: `create_dir` fails on
/// an existing folder, so a run never inherits another one's files.
pub fn new_supervisor_run_dir(home: &Path, started: &str) -> Result<PathBuf, String> {
    let root = supervisor_runs_root(home);
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create the supervisor folder: {error}"))?;
    for attempt in 1..=100 {
        let name = match attempt {
            1 => started.to_string(),
            n => format!("{started}-{n}"),
        };
        let dir = root.join(name);
        match std::fs::create_dir(&dir) {
            Ok(()) => {
                let _ = pre_trust_claude_workspace(home, &[&root, &dir]);
                return Ok(dir);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create the supervisor folder: {error}")),
        }
    }
    Err("Could not create the supervisor folder: too many runs started this second".to_string())
}

/// The folder of an earlier run, for a supervisor that resumes it. Only a
/// run folder itself qualifies (`runs::resolve_run_dir`): the folder is all a
/// restricted supervisor's file tools reach.
pub fn reuse_supervisor_run_dir(home: &Path, requested: &str) -> Result<PathBuf, String> {
    let root = supervisor_runs_root(home);
    let dir = runs::resolve_run_dir(&root, requested)?;
    let _ = pre_trust_claude_workspace(home, &[&root, &dir]);
    Ok(dir)
}

/// The approved skills a run actually gets: folders that still hold a
/// `SKILL.md`, with the Bash patterns they declare.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SkillPlugin {
    /// `None` when no approved skill could be loaded: no `--plugin-dir`.
    pub dir: Option<PathBuf>,
    /// Folder names, which are what the skills are called.
    pub skills: Vec<String>,
    pub bash: Vec<String>,
    /// Extra folders for the file tools (`--add-dir`), those that exist.
    pub dirs: Vec<String>,
}

/// Builds `<app_data>/supervisor-skills/<run>/` as a Claude Code plugin whose
/// `skills/` links to each approved skill folder, and nothing else. A listed
/// skill whose folder is gone is left out rather than failing the launch; two
/// skills with one folder name keep the first by path.
///
/// A resumed run has a folder from its earlier launch. It holds only links
/// and the manifest, so it is cleared and built from today's approvals:
/// linking over an old link fails, and a skill approved back then must not
/// stay reachable. `remove_dir_all` removes links, never what they point at.
pub fn build_skill_plugin(
    app_data: &Path,
    run_name: &str,
    skills: &BTreeMap<String, policy::SkillRules>,
) -> Result<SkillPlugin, String> {
    let root = app_data.join(SKILL_PLUGINS_DIR_NAME);
    prune_skill_plugins(&root);
    let dir = root.join(run_name);
    if std::fs::symlink_metadata(&dir).is_ok() {
        std::fs::remove_dir_all(&dir)
            .map_err(|error| format!("Could not clear the supervisor's earlier skills: {error}"))?;
    }
    let mut plugin = SkillPlugin::default();
    let mut links = Vec::new();
    for (path, rules) in skills {
        let source = Path::new(path);
        let Some(name) = source.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !source.join("SKILL.md").is_file() || plugin.skills.iter().any(|seen| seen == name) {
            continue;
        }
        plugin.skills.push(name.to_string());
        links.push((name.to_string(), source.to_path_buf()));
        for pattern in &rules.bash {
            if !plugin.bash.contains(pattern) {
                plugin.bash.push(pattern.clone());
            }
        }
        for dir in &rules.dirs {
            if Path::new(dir).is_dir() && !plugin.dirs.contains(dir) {
                plugin.dirs.push(dir.clone());
            }
        }
    }
    if links.is_empty() {
        return Ok(plugin);
    }
    let fail =
        |error: std::io::Error| format!("Could not prepare the supervisor's skills: {error}");
    std::fs::create_dir_all(dir.join(".claude-plugin")).map_err(fail)?;
    std::fs::create_dir_all(dir.join("skills")).map_err(fail)?;
    let manifest = serde_json::json!({ "name": SKILL_PLUGIN_NAME, "version": "1.0.0",
        "description": "The skills Settings → Supervisor approves for this run." });
    std::fs::write(
        dir.join(".claude-plugin").join("plugin.json"),
        manifest.to_string(),
    )
    .map_err(fail)?;
    for (name, source) in links {
        link_dir(&source, &dir.join("skills").join(name)).map_err(fail)?;
    }
    plugin.dir = Some(dir);
    Ok(plugin)
}

/// Adds the approved tools to a run: each as `Bash(<tool>)` and
/// `Bash(<tool> *)`, plus the folders it works in that exist. A tool given by
/// absolute path whose binary is gone is left out rather than failing the
/// launch, like a skill folder that vanished; a bare name is looked up by
/// Claude Code's shell at run time, so there is nothing to check here.
pub fn apply_tool_grants(plugin: &mut SkillPlugin, tools: &BTreeMap<String, policy::ToolRules>) {
    for (tool, rules) in tools {
        if tool.starts_with('/') && !Path::new(tool).is_file() {
            continue;
        }
        for pattern in policy::tool_patterns(tool) {
            if !plugin.bash.contains(&pattern) {
                plugin.bash.push(pattern);
            }
        }
        for dir in &rules.dirs {
            if Path::new(dir).is_dir() && !plugin.dirs.contains(dir) {
                plugin.dirs.push(dir.clone());
            }
        }
    }
}

#[cfg(unix)]
fn link_dir(source: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, link)
}

#[cfg(not(unix))]
fn link_dir(_source: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "skill folders are linked on unix only",
    ))
}

/// Removes plugin folders of runs that started more than a week ago. Only the
/// links are removed, never the skill folders they point at.
fn prune_skill_plugins(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > SKILL_PLUGIN_RETENTION);
        if old {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The policy as the file holds it, with what was dropped and why.
#[tauri::command]
pub fn supervisor_policy_get(app: tauri::AppHandle) -> Result<ParsedPolicy, String> {
    Ok(read_policy_file(&policy_path_in(&app_data_dir(&app)?)))
}

/// Where a tool Settings lists would run from (login-shell PATH, as the
/// supervisor's shell will find it), for display only: the policy gate never
/// reads this. `None`: not found.
#[tauri::command]
pub async fn supervisor_resolve_tool(name: String) -> Option<String> {
    crate::video_import::preflight::resolve_executable(&name)
        .await
        .map(|path| path.to_string_lossy().into_owned())
}

/// Validates and saves; answers with the file as it now reads.
#[tauri::command]
pub fn supervisor_policy_set(app: tauri::AppHandle, policy: Value) -> Result<ParsedPolicy, String> {
    let path = policy_path_in(&app_data_dir(&app)?);
    let policy = validate_for_write(policy)?;
    crate::connectors::validate_registration_changes(
        &read_policy_file(&path).policy.connectors,
        &policy.connectors,
    )?;
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

    #[test]
    fn a_run_folder_is_new_every_time_and_lives_under_the_home_dot_auric() {
        let home = tempfile::tempdir().unwrap();
        let first = new_supervisor_run_dir(home.path(), "2026-10-16_185017").unwrap();
        let second = new_supervisor_run_dir(home.path(), "2026-10-16_185017").unwrap();
        let root = home.path().join(".auric").join("supervisors");
        assert_eq!(first, root.join("2026-10-16_185017"));
        assert_eq!(second, root.join("2026-10-16_185017-2"));
        assert!(first.is_dir() && second.is_dir());
    }

    #[test]
    fn new_supervisor_run_dir_pre_trusts_workspace_in_claude_config() {
        let home = tempfile::tempdir().unwrap();
        let run_dir = new_supervisor_run_dir(home.path(), "2026-10-17_141112").unwrap();
        let root = home.path().join(".auric").join("supervisors");
        let claude_json = home.path().join(".claude.json");
        assert!(claude_json.is_file());
        let content: Value =
            serde_json::from_str(&std::fs::read_to_string(claude_json).unwrap()).unwrap();
        let projects = content.get("projects").and_then(Value::as_object).unwrap();
        assert_eq!(
            projects
                .get(&run_dir.to_string_lossy().into_owned())
                .and_then(|p| p.get("hasTrustDialogAccepted"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            projects
                .get(&root.to_string_lossy().into_owned())
                .and_then(|p| p.get("hasTrustDialogAccepted"))
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    fn skill_folder(root: &Path, name: &str) -> String {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn the_plugin_links_only_approved_skills_that_still_exist() {
        let app_data = tempfile::tempdir().unwrap();
        let sources = tempfile::tempdir().unwrap();
        let review = skill_folder(sources.path(), "review");
        let notes = skill_folder(sources.path(), "notes");
        let gone = sources.path().join("gone").to_string_lossy().into_owned();
        let skills = BTreeMap::from([
            (
                review.clone(),
                policy::SkillRules {
                    bash: vec!["review/scripts/*".into()],
                    dirs: vec![
                        sources.path().to_string_lossy().into_owned(),
                        "/abs/not-there".into(),
                    ],
                },
            ),
            (notes.clone(), policy::SkillRules::default()),
            (
                gone,
                policy::SkillRules {
                    bash: vec!["gone *".into()],
                    dirs: Vec::new(),
                },
            ),
        ]);
        let plugin = build_skill_plugin(app_data.path(), "run-1", &skills).unwrap();
        let dir = plugin.dir.clone().unwrap();
        assert_eq!(
            dir,
            app_data.path().join(SKILL_PLUGINS_DIR_NAME).join("run-1")
        );
        assert_eq!(plugin.skills, vec!["notes", "review"]);
        assert_eq!(
            plugin.bash,
            vec!["review/scripts/*"],
            "a missing skill brings no shell"
        );
        assert_eq!(
            plugin.dirs,
            vec![sources.path().to_string_lossy().into_owned()],
            "a folder that does not exist is not handed out"
        );
        let manifest: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join(".claude-plugin/plugin.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["name"], SKILL_PLUGIN_NAME);
        let link = dir.join("skills").join("review");
        assert_eq!(std::fs::read_link(&link).unwrap(), PathBuf::from(&review));
        assert!(!dir.join("skills").join("gone").exists());
    }

    #[test]
    fn a_resumed_run_builds_its_plugin_again_with_todays_approvals() {
        let app_data = tempfile::tempdir().unwrap();
        let sources = tempfile::tempdir().unwrap();
        let review = skill_folder(sources.path(), "review");
        let notes = skill_folder(sources.path(), "notes");
        let both = BTreeMap::from([
            (review.clone(), policy::SkillRules::default()),
            (notes, policy::SkillRules::default()),
        ]);
        build_skill_plugin(app_data.path(), "run-1", &both).unwrap();

        let only_review = BTreeMap::from([(review.clone(), policy::SkillRules::default())]);
        let plugin = build_skill_plugin(app_data.path(), "run-1", &only_review)
            .expect("the same run folder is built a second time");
        let dir = plugin.dir.unwrap();
        assert_eq!(
            std::fs::read_link(dir.join("skills").join("review")).unwrap(),
            PathBuf::from(&review)
        );
        assert!(
            std::fs::symlink_metadata(dir.join("skills").join("notes")).is_err(),
            "a skill no longer approved is gone from the rebuilt plugin"
        );
        assert!(
            Path::new(&review).join("SKILL.md").is_file(),
            "the source stays"
        );

        let none = build_skill_plugin(app_data.path(), "run-1", &BTreeMap::new()).unwrap();
        assert_eq!(none.dir, None);
        assert!(
            std::fs::symlink_metadata(dir.join("skills").join("review")).is_err(),
            "no approved skill leaves no link of an earlier build behind"
        );
    }

    #[test]
    fn concurrent_trust_writes_keep_every_folder() {
        let home = tempfile::tempdir().unwrap();
        let folders: Vec<PathBuf> = (0..16)
            .map(|n| {
                let dir = home.path().join(format!("run-{n}"));
                std::fs::create_dir_all(&dir).unwrap();
                dir
            })
            .collect();
        std::thread::scope(|scope| {
            for dir in &folders {
                let home = home.path();
                scope.spawn(move || pre_trust_claude_workspace(home, &[dir.as_path()]).unwrap());
            }
        });
        let content: Value = serde_json::from_str(
            &std::fs::read_to_string(home.path().join(".claude.json")).unwrap(),
        )
        .unwrap();
        for dir in &folders {
            let key = dir.canonicalize().unwrap().to_string_lossy().into_owned();
            assert_eq!(
                content["projects"][&key]["hasTrustDialogAccepted"],
                Value::Bool(true),
                "{key} lost its trust entry"
            );
        }
    }

    #[test]
    fn an_approved_tool_is_allowed_as_itself_and_with_arguments_only() {
        let work = tempfile::tempdir().unwrap();
        let binary = work.path().join("mytool");
        std::fs::write(&binary, "").unwrap();
        let binary = binary.to_string_lossy().into_owned();
        let tools = BTreeMap::from([
            (
                "umi".to_string(),
                policy::ToolRules {
                    dirs: vec![
                        work.path().to_string_lossy().into_owned(),
                        "/abs/not-there".into(),
                    ],
                },
            ),
            (binary.clone(), policy::ToolRules::default()),
            ("/abs/gone/tool".to_string(), policy::ToolRules::default()),
        ]);
        let mut plugin = SkillPlugin {
            bash: vec!["umi".into()],
            ..SkillPlugin::default()
        };
        apply_tool_grants(&mut plugin, &tools);
        assert_eq!(
            plugin.bash,
            vec![
                "umi".to_string(),
                binary.clone(),
                format!("{binary} *"),
                "umi *".to_string()
            ],
            "a missing binary brings no shell, a repeat is not added twice"
        );
        assert_eq!(
            plugin.dirs,
            vec![work.path().to_string_lossy().into_owned()],
            "a folder that does not exist is not handed out"
        );
    }

    #[test]
    fn no_approved_tool_leaves_the_plugin_as_it_was() {
        let mut plugin = SkillPlugin::default();
        apply_tool_grants(&mut plugin, &BTreeMap::new());
        assert_eq!(plugin, SkillPlugin::default());
    }

    #[test]
    fn no_approved_skill_means_no_plugin_and_no_shell() {
        let app_data = tempfile::tempdir().unwrap();
        let plugin = build_skill_plugin(app_data.path(), "run-1", &BTreeMap::new()).unwrap();
        assert_eq!(plugin, SkillPlugin::default());
        assert!(!app_data
            .path()
            .join(SKILL_PLUGINS_DIR_NAME)
            .join("run-1")
            .exists());
    }

    #[test]
    fn every_pm_server_name_matches_the_fixture() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../src/lib/config/supervisorPolicy.fixtures.json"
        ))
        .unwrap();
        for case in fixtures["pmServerNames"].as_array().unwrap() {
            let paths: Vec<String> = serde_json::from_value(case["paths"].clone()).unwrap();
            let expected: Vec<String> = serde_json::from_value(case["expected"].clone()).unwrap();
            assert_eq!(pm_server_names(&paths), expected, "{}", case["name"]);
        }
    }

    #[test]
    fn only_permitted_initialised_projects_get_an_auric_pm() {
        let root = tempfile::tempdir().unwrap();
        let project = |name: &str, initialised: bool| {
            let dir = root.path().join(name);
            std::fs::create_dir_all(dir.join(".auric")).unwrap();
            if initialised {
                std::fs::write(dir.join(".auric").join("project.db"), "").unwrap();
            }
            dir.to_string_lossy().into_owned()
        };
        let (a, b, c) = (project("a", true), project("b", false), project("c", true));
        let mut policy = SupervisorPolicy::default();
        for (path, allowed) in [(&a, true), (&b, true), (&c, false)] {
            let rules = policy::ProjectRules {
                allowed,
                ..Default::default()
            };
            policy.projects.insert(path.clone(), rules);
        }
        assert_eq!(
            supervisor_pm_servers(&policy),
            vec![("auric-pm-a".to_string(), a)]
        );
    }
}
