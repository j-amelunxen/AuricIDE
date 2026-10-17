//! What a supervisor agent may start: the pure rules.
//!
//! The twin of `src/lib/config/supervisorPolicy.ts`. That side decides what
//! Settings and the supervisor's launch prompt offer; this side decides what
//! actually spawns. Both run `src/lib/config/supervisorPolicy.fixtures.json`,
//! because a disagreement is the failure that matters: the prompt would offer
//! a model the socket refuses, or the socket would start one nobody was shown.
//!
//! Every error fails closed. Nothing the file does not plainly allow is
//! allowed. Paths are compared as given here; `super` canonicalises them.
//!
//! Any change to the rules starts by adding a case to that fixture file.

use crate::provider_policy::{is_provider_allowed, ProviderPolicy};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const POLICY_VERSION: u64 = 1;
pub const DEFAULT_SUPERVISOR_PROVIDER: &str = "claude";
pub const DEFAULT_MAX_RUNNING_CHILDREN: u32 = 4;
pub const DEFAULT_PROJECT_MAX_RUNNING: u32 = 2;
/// Never a mode a supervisor's child may run under, whatever the file says.
pub const REJECTED_PERMISSION_MODES: [&str; 1] = ["bypassPermissions"];
/// The largest load-balancing share a provider may be given.
pub const MAX_PROVIDER_WEIGHT: u64 = 99;
/// How far back `list_projects` counts the agents started in a project.
pub const BALANCING_WINDOW_DAYS: u32 = 7;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorModel {
    pub provider: String,
    pub model: Option<String>,
    /// Candidate providers allowed to act as supervisor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub providers: Option<Vec<String>>,
    /// Claude in Chrome (`--chrome`): the user's own browser, logged-in
    /// sessions included, so it is off unless switched on.
    #[serde(default)]
    pub chrome: bool,
}

impl Default for SupervisorModel {
    fn default() -> Self {
        Self {
            provider: DEFAULT_SUPERVISOR_PROVIDER.to_string(),
            model: None,
            providers: None,
            chrome: false,
        }
    }
}

impl SupervisorModel {
    #[allow(dead_code)]
    pub fn candidate_providers(&self) -> Vec<String> {
        let mut candidates = Vec::new();
        if let Some(ref list) = self.providers {
            for id in list {
                let norm = normalize_provider_id(id);
                if !norm.is_empty() && !candidates.contains(&norm) {
                    candidates.push(norm);
                }
            }
        }
        if candidates.is_empty() {
            let primary = normalize_provider_id(&self.provider);
            if !primary.is_empty() {
                candidates.push(primary);
            } else {
                candidates.push(DEFAULT_SUPERVISOR_PROVIDER.to_string());
            }
        }
        candidates
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRules {
    pub allowed: bool,
    /// `None`: whatever the project's provider policy permits.
    pub providers: Option<Vec<String>>,
    /// Absent provider: every model it offers. Empty list: none.
    pub models: BTreeMap<String, Vec<String>>,
    pub permission_mode: BTreeMap<String, String>,
    /// Load balancing: each provider's share of the agents started here.
    /// Advisory: `check_spawn` never reads it. Empty: no balancing.
    #[serde(default)]
    pub provider_weights: BTreeMap<String, u32>,
    pub allow_interactive: bool,
    pub max_running: u32,
}

impl Default for ProjectRules {
    fn default() -> Self {
        Self {
            allowed: false,
            providers: None,
            models: BTreeMap::new(),
            permission_mode: BTreeMap::new(),
            provider_weights: BTreeMap::new(),
            allow_interactive: false,
            max_running: DEFAULT_PROJECT_MAX_RUNNING,
        }
    }
}

/// A skill the supervisor may load, keyed by its folder (the one holding
/// `SKILL.md`). `bash` are the only shell commands it may run, as Claude Code
/// `Bash(...)` rule patterns; no pattern, no shell. `dirs` are folders besides
/// the run folder its file tools may read and write (a skill's workspace).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRules {
    pub bash: Vec<String>,
    #[serde(default)]
    pub dirs: Vec<String>,
}

/// A CLI tool the supervisor may run, keyed by a bare command name (found on
/// PATH) or by the absolute path of its binary. It becomes `Bash(<tool>)` and
/// `Bash(<tool> *)` (`tool_patterns`). `dirs` are folders besides the run
/// folder its file tools may read and write (the tool's data).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRules {
    #[serde(default)]
    pub dirs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorPolicy {
    pub version: u64,
    pub supervisor: SupervisorModel,
    pub max_running_children: u32,
    pub projects: BTreeMap<String, ProjectRules>,
    #[serde(default)]
    pub skills: BTreeMap<String, SkillRules>,
    #[serde(default)]
    pub tools: BTreeMap<String, ToolRules>,
}

impl Default for SupervisorPolicy {
    /// Allows nothing: no project is listed.
    fn default() -> Self {
        Self {
            version: POLICY_VERSION,
            supervisor: SupervisorModel::default(),
            max_running_children: DEFAULT_MAX_RUNNING_CHILDREN,
            projects: BTreeMap::new(),
            skills: BTreeMap::new(),
            tools: BTreeMap::new(),
        }
    }
}

/// Why (part of) a file was not taken. Stable keys, see the fixture `reasons`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParseReason {
    FileMissing,
    Malformed,
    UnsupportedVersion,
    InvalidEntry,
    PathNotAbsolute,
    BypassPermissions,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RejectedEntry {
    /// The project key as written, `None` when the whole file was refused.
    pub project: Option<String>,
    /// The skill key as written, for an entry under `skills`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    /// The tool key as written, for an entry under `tools`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub reason: ParseReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedPolicy {
    pub policy: SupervisorPolicy,
    pub rejected: Vec<RejectedEntry>,
}

fn refused(reason: ParseReason) -> ParsedPolicy {
    ParsedPolicy {
        policy: SupervisorPolicy::default(),
        rejected: vec![RejectedEntry {
            project: None,
            skill: None,
            tool: None,
            reason,
        }],
    }
}

/// Provider ids are lowercase in the registry; a hand-typed key must still match.
pub fn normalize_provider_id(value: &str) -> String {
    value.trim().to_lowercase()
}

/// Reads the file's text (`None`: there is no file). Never fails: what cannot
/// be read allows nothing, and says why in `rejected`.
pub fn parse(raw: Option<&str>) -> ParsedPolicy {
    let Some(raw) = raw else {
        return refused(ParseReason::FileMissing);
    };
    let Ok(Value::Object(source)) = serde_json::from_str::<Value>(raw) else {
        return refused(ParseReason::Malformed);
    };
    if source.get("version").and_then(Value::as_u64) != Some(POLICY_VERSION) {
        return refused(ParseReason::UnsupportedVersion);
    }
    let projects = match source.get("projects") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(projects)) => projects.clone(),
        Some(_) => return refused(ParseReason::Malformed),
    };
    let skills = match source.get("skills") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(skills)) => skills.clone(),
        Some(_) => return refused(ParseReason::Malformed),
    };

    let tools = match source.get("tools") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(tools)) => tools.clone(),
        Some(_) => return refused(ParseReason::Malformed),
    };

    let mut policy = SupervisorPolicy {
        supervisor: parse_supervisor(source.get("supervisor")),
        max_running_children: source
            .get("maxRunningChildren")
            .and_then(as_limit)
            .unwrap_or(DEFAULT_MAX_RUNNING_CHILDREN),
        ..SupervisorPolicy::default()
    };
    let mut rejected = Vec::new();
    for (key, entry) in &projects {
        match parse_project(key, entry) {
            Ok((path, rules)) => insert_stricter(&mut policy.projects, path, rules),
            Err(reason) => rejected.push(RejectedEntry {
                project: Some(key.clone()),
                skill: None,
                tool: None,
                reason,
            }),
        }
    }
    for (key, entry) in &skills {
        match parse_skill(key, entry) {
            Ok((path, rules)) => insert_skill(&mut policy.skills, path, rules),
            Err(reason) => rejected.push(RejectedEntry {
                project: None,
                skill: Some(key.clone()),
                tool: None,
                reason,
            }),
        }
    }
    for (key, entry) in &tools {
        match parse_tool(key, entry) {
            Ok((name, rules)) => insert_tool(&mut policy.tools, name, rules),
            Err(reason) => rejected.push(RejectedEntry {
                project: None,
                skill: None,
                tool: Some(key.clone()),
                reason,
            }),
        }
    }
    ParsedPolicy { policy, rejected }
}

fn parse_skill(key: &str, entry: &Value) -> Result<(String, SkillRules), ParseReason> {
    if !key.starts_with('/') {
        return Err(ParseReason::PathNotAbsolute);
    }
    let Value::Object(source) = entry else {
        return Err(ParseReason::InvalidEntry);
    };
    let bash = match source.get("bash") {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => string_list(value)?,
    };
    let mut patterns: Vec<String> = Vec::new();
    for pattern in bash.iter().map(|pattern| pattern.trim()) {
        if pattern.is_empty() || patterns.iter().any(|seen| seen == pattern) {
            continue;
        }
        if !is_bash_pattern(pattern) {
            return Err(ParseReason::InvalidEntry);
        }
        patterns.push(pattern.to_string());
    }
    let dirs = parse_dirs(source.get("dirs"))?;
    Ok((
        normalize_project_path(key),
        SkillRules {
            bash: patterns,
            dirs,
        },
    ))
}

/// Extra folders: absolute, not the root, trimmed and without repeats.
fn parse_dirs(value: Option<&Value>) -> Result<Vec<String>, ParseReason> {
    let listed = match value {
        None | Some(Value::Null) => Vec::new(),
        Some(value) => string_list(value)?,
    };
    let mut dirs: Vec<String> = Vec::new();
    for dir in listed.iter().map(|dir| dir.trim()) {
        if dir.is_empty() {
            continue;
        }
        if !dir.starts_with('/') || !is_bash_pattern(dir) {
            return Err(ParseReason::InvalidEntry);
        }
        let dir = normalize_project_path(dir);
        if dir == "/" {
            return Err(ParseReason::InvalidEntry);
        }
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    Ok(dirs)
}

/// A tool key is a bare command name or the absolute path of a binary
/// (fixture `toolRules`). `.` alone would be `Bash(. *)`, the `source`
/// builtin, hence a name needs a letter or digit; `*` in a path would widen
/// the rule. `None`: the key is fine; otherwise why it is refused.
pub fn tool_key_problem(key: &str) -> Option<ParseReason> {
    let bare = !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'));
    if bare {
        return (!key.chars().any(|c| c.is_ascii_alphanumeric()))
            .then_some(ParseReason::InvalidEntry);
    }
    if !key.starts_with('/') {
        return Some(if key.contains('/') {
            ParseReason::PathNotAbsolute
        } else {
            ParseReason::InvalidEntry
        });
    }
    // U+FEFF is whitespace to JavaScript's `\s` but not to Rust; both sides refuse it.
    let unsafe_path = !is_bash_pattern(key)
        || key
            .chars()
            .any(|c| c.is_whitespace() || c == '\u{feff}' || c == '*');
    (unsafe_path || normalize_project_path(key) == "/").then_some(ParseReason::InvalidEntry)
}

fn parse_tool(key: &str, entry: &Value) -> Result<(String, ToolRules), ParseReason> {
    if let Some(reason) = tool_key_problem(key) {
        return Err(reason);
    }
    let Value::Object(source) = entry else {
        return Err(ParseReason::InvalidEntry);
    };
    let name = if key.starts_with('/') {
        normalize_project_path(key)
    } else {
        key.to_string()
    };
    Ok((
        name,
        ToolRules {
            dirs: parse_dirs(source.get("dirs"))?,
        },
    ))
}

/// The two Claude Code Bash patterns a tool is allowed under.
pub fn tool_patterns(tool: &str) -> [String; 2] {
    [tool.to_string(), format!("{tool} *")]
}

/// Two spellings of one tool keep only the folders both allow.
pub fn insert_tool(tools: &mut BTreeMap<String, ToolRules>, name: String, rules: ToolRules) {
    let merged = match tools.remove(&name) {
        Some(existing) => ToolRules {
            dirs: intersect(&existing.dirs, &rules.dirs),
        },
        None => rules,
    };
    tools.insert(name, merged);
}

/// A pattern becomes `Bash(<pattern>)`: a bracket would end the rule early and
/// a line break or quote would split the launch command (fixture
/// `skillPatternRules`).
pub fn is_bash_pattern(pattern: &str) -> bool {
    !pattern
        .chars()
        .any(|c| matches!(c, '(' | ')' | '"' | '`' | '\\') || c.is_control())
}

/// Two spellings of one skill folder keep only the patterns both allow.
pub fn insert_skill(skills: &mut BTreeMap<String, SkillRules>, path: String, rules: SkillRules) {
    let merged = match skills.remove(&path) {
        Some(existing) => SkillRules {
            bash: intersect(&existing.bash, &rules.bash),
            dirs: intersect(&existing.dirs, &rules.dirs),
        },
        None => rules,
    };
    skills.insert(path, merged);
}

fn parse_supervisor(value: Option<&Value>) -> SupervisorModel {
    let defaults = SupervisorModel::default();
    let Some(Value::Object(source)) = value else {
        return defaults;
    };
    let providers = parse_providers(source.get("providers")).ok().flatten();
    SupervisorModel {
        provider: source
            .get("provider")
            .and_then(Value::as_str)
            .map(normalize_provider_id)
            .filter(|id| !id.is_empty())
            .unwrap_or(defaults.provider),
        model: source
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
            .map(str::to_string),
        providers,
        // Only a literal `true` switches the browser on.
        chrome: source.get("chrome").and_then(Value::as_bool) == Some(true),
    }
}

/// A non-negative integer that fits a limit.
fn as_limit(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|n| u32::try_from(n).ok())
}

/// `/abs/project-a/` → `/abs/project-a`; the root stays `/`.
pub fn normalize_project_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() && path.starts_with('/') {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_project(key: &str, entry: &Value) -> Result<(String, ProjectRules), ParseReason> {
    if !key.starts_with('/') {
        return Err(ParseReason::PathNotAbsolute);
    }
    let Value::Object(source) = entry else {
        return Err(ParseReason::InvalidEntry);
    };
    let defaults = ProjectRules::default();
    let rules = ProjectRules {
        allowed: optional(source, "allowed", Value::as_bool)?.unwrap_or(defaults.allowed),
        providers: parse_providers(source.get("providers"))?,
        models: parse_models(source.get("models"))?,
        permission_mode: parse_permission_modes(source.get("permissionMode"))?,
        provider_weights: parse_weights(source.get("providerWeights"))?,
        allow_interactive: optional(source, "allowInteractive", Value::as_bool)?
            .unwrap_or(defaults.allow_interactive),
        max_running: optional(source, "maxRunning", as_limit)?.unwrap_or(defaults.max_running),
    };
    Ok((normalize_project_path(key), rules))
}

/// An absent (or null) field is `None`; one of the wrong type refuses the entry.
fn optional<T>(
    source: &Map<String, Value>,
    field: &str,
    read: impl Fn(&Value) -> Option<T>,
) -> Result<Option<T>, ParseReason> {
    match source.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => read(value).map(Some).ok_or(ParseReason::InvalidEntry),
    }
}

fn string_list(value: &Value) -> Result<Vec<String>, ParseReason> {
    let Value::Array(entries) = value else {
        return Err(ParseReason::InvalidEntry);
    };
    entries
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .map(str::to_string)
                .ok_or(ParseReason::InvalidEntry)
        })
        .collect()
}

fn parse_providers(value: Option<&Value>) -> Result<Option<Vec<String>>, ParseReason> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let mut seen = BTreeSet::new();
    let ids = string_list(value)?
        .iter()
        .map(|id| normalize_provider_id(id))
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect();
    Ok(Some(ids))
}

fn object_of(value: Option<&Value>) -> Result<Option<&Map<String, Value>>, ParseReason> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(map)) => Ok(Some(map)),
        Some(_) => Err(ParseReason::InvalidEntry),
    }
}

fn parse_models(value: Option<&Value>) -> Result<BTreeMap<String, Vec<String>>, ParseReason> {
    let mut models: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let Some(source) = object_of(value)? else {
        return Ok(models);
    };
    for (provider, list) in source {
        let id = normalize_provider_id(provider);
        if id.is_empty() {
            return Err(ParseReason::InvalidEntry);
        }
        // Model ids are compared exactly, so they are kept as written.
        let merged = models.entry(id).or_default();
        for model in string_list(list)? {
            if !merged.contains(&model) {
                merged.push(model);
            }
        }
    }
    Ok(models)
}

fn parse_permission_modes(value: Option<&Value>) -> Result<BTreeMap<String, String>, ParseReason> {
    let mut modes = BTreeMap::new();
    let Some(source) = object_of(value)? else {
        return Ok(modes);
    };
    for (provider, mode) in source {
        let id = normalize_provider_id(provider);
        let mode = mode.as_str().ok_or(ParseReason::InvalidEntry)?;
        if id.is_empty() {
            return Err(ParseReason::InvalidEntry);
        }
        if REJECTED_PERMISSION_MODES.contains(&mode.trim()) {
            return Err(ParseReason::BypassPermissions);
        }
        modes.insert(id, mode.to_string());
    }
    Ok(modes)
}

/// Two keys for one provider keep the smaller share (fixture `providerWeightsRules`).
fn parse_weights(value: Option<&Value>) -> Result<BTreeMap<String, u32>, ParseReason> {
    let mut weights: BTreeMap<String, u32> = BTreeMap::new();
    let Some(source) = object_of(value)? else {
        return Ok(weights);
    };
    for (provider, weight) in source {
        let id = normalize_provider_id(provider);
        let weight = weight
            .as_u64()
            .filter(|weight| *weight <= MAX_PROVIDER_WEIGHT)
            .ok_or(ParseReason::InvalidEntry)?;
        if id.is_empty() {
            return Err(ParseReason::InvalidEntry);
        }
        let weight = weight as u32;
        let kept = weights
            .get(&id)
            .map_or(weight, |earlier| weight.min(*earlier));
        weights.insert(id, kept);
    }
    Ok(weights)
}

/// Adds `rules` under `path`; when the path is there already (two spellings of
/// one folder), the stricter of both stays, so a deny can never lose to an
/// allow by how the keys sort (fixture `parseMergeRules`).
pub fn insert_stricter(
    projects: &mut BTreeMap<String, ProjectRules>,
    path: String,
    rules: ProjectRules,
) {
    let merged = match projects.remove(&path) {
        Some(existing) => stricter(existing, rules),
        None => rules,
    };
    projects.insert(path, merged);
}

fn intersect(a: &[String], b: &[String]) -> Vec<String> {
    a.iter().filter(|id| b.contains(id)).cloned().collect()
}

fn stricter(a: ProjectRules, b: ProjectRules) -> ProjectRules {
    let providers = match (a.providers, b.providers) {
        (Some(x), Some(y)) => Some(intersect(&x, &y)),
        (x, y) => x.or(y),
    };
    let mut models = a.models;
    for (provider, list) in b.models {
        let merged = match models.remove(&provider) {
            Some(existing) => intersect(&existing, &list),
            None => list,
        };
        models.insert(provider, merged);
    }
    let mut permission_mode = a.permission_mode;
    let mut conflict = false;
    for (provider, mode) in b.permission_mode {
        match permission_mode.get(&provider) {
            Some(existing) if *existing != mode => conflict = true,
            _ => {
                permission_mode.insert(provider, mode);
            }
        }
    }
    if conflict {
        // There is no stricter of two modes; the project allows nothing.
        permission_mode.clear();
    }
    // A hint, not a permission: two spellings that disagree balance nothing.
    let provider_weights = if a.provider_weights == b.provider_weights {
        a.provider_weights
    } else {
        BTreeMap::new()
    };
    ProjectRules {
        allowed: a.allowed && b.allowed && !conflict,
        providers,
        models,
        permission_mode,
        provider_weights,
        allow_interactive: a.allow_interactive && b.allow_interactive,
        max_running: a.max_running.min(b.max_running),
    }
}

// ── Permission modes that skip the prompts ──────────────────────────────────

/// What a provider's permission modes mean for a supervisor's child: the mode
/// it runs under when none is named, and the modes that skip permission
/// prompts (fixture `permissionModesRules`). Rust derives `unattended` from
/// the provider config (`super::provider_modes`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderModes {
    #[serde(rename = "default")]
    pub default_mode: Option<String>,
    pub unattended: Vec<String>,
}

/// The mode a child of `provider` would run under, and whether it skips the
/// permission prompts. A provider without an entry has no default and no
/// unattended mode.
fn effective_mode(
    rules: &ProjectRules,
    modes: &BTreeMap<String, ProviderModes>,
    provider: &str,
) -> (Option<String>, bool) {
    let named = rules.permission_mode.get(provider).cloned();
    let known = modes.get(provider);
    let effective = named
        .clone()
        .or_else(|| known.and_then(|m| m.default_mode.clone()));
    let unattended = match (&effective, known) {
        (Some(mode), Some(known)) => known.unattended.contains(mode),
        _ => false,
    };
    (named, unattended)
}

// ── What a supervisor sees ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleProvider {
    pub id: String,
    pub models: Vec<String>,
    pub permission_mode: Option<String>,
    /// Its load-balancing share; `None` where the rules name none.
    pub weight: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisibleProject {
    pub path: String,
    pub providers: Vec<VisibleProvider>,
    pub allow_interactive: bool,
    pub max_running: u32,
}

/// The models of `provider` the rules leave, in the provider's own order.
fn usable_models(rules: &ProjectRules, provider: &str, offered: &[String]) -> Vec<String> {
    match rules.models.get(provider) {
        Some(listed) => offered
            .iter()
            .filter(|model| listed.contains(model))
            .cloned()
            .collect(),
        None => offered.to_vec(),
    }
}

/// Projects listed with `allowed: true`, sorted by path, each with the
/// providers that survive the supervisor list, the project's provider policy
/// and the models still offered. A project whose providers all fall away
/// stays visible with none, so the supervisor can say why it cannot start
/// anything there.
pub fn visible_projects(
    policy: &SupervisorPolicy,
    project_policy: impl Fn(&str) -> ProviderPolicy,
    offered: &BTreeMap<String, Vec<String>>,
    modes: &BTreeMap<String, ProviderModes>,
) -> Vec<VisibleProject> {
    policy
        .projects
        .iter()
        .filter(|(_, rules)| rules.allowed)
        .map(|(path, rules)| {
            let project = project_policy(path);
            let providers = offered
                .iter()
                .filter(|(id, _)| {
                    rules
                        .providers
                        .as_ref()
                        .map_or(true, |listed| listed.contains(id))
                })
                .filter(|(id, _)| is_provider_allowed(id, &project))
                .filter(|(id, _)| !effective_mode(rules, modes, id).1)
                .map(|(id, models)| VisibleProvider {
                    id: id.clone(),
                    models: usable_models(rules, id, models),
                    permission_mode: rules.permission_mode.get(id).cloned(),
                    weight: rules.provider_weights.get(id).copied(),
                })
                .filter(|provider| !provider.models.is_empty())
                .collect();
            VisibleProject {
                path: path.clone(),
                providers,
                allow_interactive: rules.allow_interactive,
                max_running: rules.max_running,
            }
        })
        .collect()
}

// ── Load balancing ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBalance {
    pub id: String,
    pub weight: u32,
    /// Agents of this provider started in the project within the window.
    pub spawns: u32,
    pub target_percent: u32,
    /// `None` while nothing was started in the window.
    pub actual_percent: Option<u32>,
}

/// What `list_projects` tells a supervisor about a project's load balancing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Balancing {
    pub window_days: u32,
    /// The provider furthest behind its share: the one to start next.
    pub next: Option<String>,
    pub providers: Vec<ProviderBalance>,
}

fn percent(part: u32, total: u32) -> u32 {
    ((u64::from(part) * 200 + u64::from(total)) / (2 * u64::from(total))) as u32
}

/// The split among the providers a supervisor may use here, against how many
/// agents each actually got (`spawns`, by provider id). `None` when no usable
/// provider has a share above 0. `next` is the provider with the fewest spawns
/// per share; a tie goes to the larger share, then to the first by id.
pub fn balancing(
    providers: &[VisibleProvider],
    spawns: &BTreeMap<String, u32>,
) -> Option<Balancing> {
    let weighted: Vec<(&str, u32, u32)> = providers
        .iter()
        .map(|p| {
            let weight = p.weight.unwrap_or(0);
            (
                p.id.as_str(),
                weight,
                spawns.get(&p.id).copied().unwrap_or(0),
            )
        })
        .collect();
    let total_weight: u32 = weighted.iter().map(|(_, weight, _)| weight).sum();
    if total_weight == 0 {
        return None;
    }
    let total_spawns: u32 = weighted.iter().map(|(_, _, count)| count).sum();
    // a is further behind than b when a.count / a.weight < b.count / b.weight.
    let behind = |a: &(&str, u32, u32), b: &(&str, u32, u32)| {
        let (lhs, rhs) = (
            u64::from(a.2) * u64::from(b.1),
            u64::from(b.2) * u64::from(a.1),
        );
        lhs < rhs || (lhs == rhs && a.1 > b.1)
    };
    let next = weighted
        .iter()
        .filter(|(_, weight, _)| *weight > 0)
        .fold(
            None,
            |best: Option<&(&str, u32, u32)>, candidate| match best {
                Some(best) if !behind(candidate, best) => Some(best),
                _ => Some(candidate),
            },
        )
        .map(|(id, _, _)| id.to_string());
    Some(Balancing {
        window_days: BALANCING_WINDOW_DAYS,
        next,
        providers: weighted
            .iter()
            .map(|(id, weight, count)| ProviderBalance {
                id: id.to_string(),
                weight: *weight,
                spawns: *count,
                target_percent: percent(*weight, total_weight),
                actual_percent: (total_spawns > 0).then(|| percent(*count, total_spawns)),
            })
            .collect(),
    })
}

// ── Whether one spawn may go ahead ──────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DenyReason {
    ProjectNotListed,
    ProjectNotAllowed,
    ProviderNotInstalled,
    ProviderNotAllowed,
    ProviderDeniedByProject,
    ProviderHasNoModels,
    ModelNotAllowed,
    ModelNotOffered,
    PermissionModeUnattended,
    InteractiveNotAllowed,
    ProjectLimitReached,
    GlobalLimitReached,
}

impl DenyReason {
    pub fn key(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default()
    }
}

/// The calling supervisor's children that count against its limits: running
/// or queued, in total and per project path.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunningChildren {
    pub total: u32,
    pub by_project: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnRequest<'a> {
    pub project_path: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub headless: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Denied {
    pub reason: DenyReason,
    /// For a person; the reason key is what callers match on.
    pub message: String,
}

fn deny(reason: DenyReason, message: String) -> Denied {
    Denied { reason, message }
}

/// Runs the checks in the fixture's `checkOrder`; the first that fails is the
/// answer. On success, the permission mode the child runs under: the
/// policy's value for that provider, or `None` for the provider's own default.
// code-gate: complexity-cyclomatic, complexity-function-length - one branch per fixture checkOrder entry, in that order; splitting them would hide the order
pub fn check_spawn(
    policy: &SupervisorPolicy,
    project_policy: &ProviderPolicy,
    offered: &BTreeMap<String, Vec<String>>,
    modes: &BTreeMap<String, ProviderModes>,
    running: &RunningChildren,
    request: &SpawnRequest<'_>,
) -> Result<Option<String>, Denied> {
    let path = normalize_project_path(request.project_path);
    let provider = normalize_provider_id(request.provider);
    let model = request.model;
    let Some(rules) = policy.projects.get(&path) else {
        return Err(deny(
            DenyReason::ProjectNotListed,
            format!(
                "{path} is not in the supervisor policy. Allow it under Settings → Supervisor."
            ),
        ));
    };
    if !rules.allowed {
        return Err(deny(
            DenyReason::ProjectNotAllowed,
            format!("The supervisor may not use {path}. Allow it under Settings → Supervisor."),
        ));
    }
    let Some(offered_models) = offered.get(&provider) else {
        return Err(deny(
            DenyReason::ProviderNotInstalled,
            format!("Provider '{provider}' is not installed in AuricIDE."),
        ));
    };
    if let Some(listed) = &rules.providers {
        if !listed.contains(&provider) {
            return Err(deny(
                DenyReason::ProviderNotAllowed,
                format!(
                    "Provider '{provider}' is not allowed for the supervisor in {path}. Allowed: {}.",
                    listed.join(", ")
                ),
            ));
        }
    }
    if !is_provider_allowed(&provider, project_policy) {
        return Err(deny(
            DenyReason::ProviderDeniedByProject,
            format!("Provider '{provider}' is not permitted by the provider policy of {path}."),
        ));
    }
    if let Some(listed) = rules.models.get(&provider) {
        if listed.is_empty() {
            return Err(deny(
                DenyReason::ProviderHasNoModels,
                format!("The supervisor policy allows no {provider} model in {path}."),
            ));
        }
        if !listed.iter().any(|allowed| allowed == model) {
            return Err(deny(
                DenyReason::ModelNotAllowed,
                format!(
                    "Model '{model}' is not allowed for {provider} in {path}. Allowed: {}.",
                    listed.join(", ")
                ),
            ));
        }
    }
    if !offered_models.iter().any(|offered| offered == model) {
        return Err(deny(
            DenyReason::ModelNotOffered,
            format!("Provider '{provider}' does not offer model '{model}'."),
        ));
    }
    let (permission_mode, unattended) = effective_mode(rules, modes, &provider);
    if unattended {
        return Err(deny(
            DenyReason::PermissionModeUnattended,
            format!(
                "Provider '{provider}' would run without permission prompts in {path}. \
                 Name an attended permission mode for it under Settings → Supervisor."
            ),
        ));
    }
    if !request.headless && !rules.allow_interactive {
        return Err(deny(
            DenyReason::InteractiveNotAllowed,
            format!("Only headless runs are allowed in {path}."),
        ));
    }
    let in_project = running.by_project.get(&path).copied().unwrap_or(0);
    if in_project >= rules.max_running {
        return Err(deny(
            DenyReason::ProjectLimitReached,
            format!(
                "The supervisor already runs {in_project} of at most {} agents in {path}.",
                rules.max_running
            ),
        ));
    }
    if running.total >= policy.max_running_children {
        return Err(deny(
            DenyReason::GlobalLimitReached,
            format!(
                "The supervisor already runs {} of at most {} agents.",
                running.total, policy.max_running_children
            ),
        ));
    }
    Ok(permission_mode)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) const FIXTURES: &str =
        include_str!("../../../src/lib/config/supervisorPolicy.fixtures.json");

    pub(crate) fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).unwrap()
    }

    fn policy_from(value: &Value) -> SupervisorPolicy {
        serde_json::from_value(value.clone()).unwrap()
    }

    fn provider_policy_from(value: &Value) -> ProviderPolicy {
        ProviderPolicy {
            allow: value["allow"]
                .as_array()
                .map(|list| list.iter().map(|id| id.as_str().unwrap().into()).collect()),
            deny: value["deny"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().into())
                .collect(),
        }
    }

    fn offered_from(value: &Value) -> BTreeMap<String, Vec<String>> {
        serde_json::from_value(value.clone()).unwrap()
    }

    /// Absent on most cases: nothing is known to be unattended.
    fn modes_from(value: &Value) -> BTreeMap<String, ProviderModes> {
        if value.is_null() {
            return BTreeMap::new();
        }
        serde_json::from_value(value.clone()).unwrap()
    }

    #[test]
    fn every_parse_case_matches_the_fixture() {
        let fixtures = fixtures();
        let cases = fixtures["parse"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let parsed = parse(case["raw"].as_str());
            assert_eq!(
                serde_json::to_value(&parsed).unwrap(),
                case["expected"],
                "{name}"
            );
        }
    }

    #[test]
    fn defaults_and_rejected_modes_match_the_fixture() {
        let fixtures = fixtures();
        let defaults = &fixtures["defaults"];
        assert_eq!(
            defaults["supervisor"],
            serde_json::to_value(SupervisorModel::default()).unwrap()
        );
        assert_eq!(defaults["maxRunningChildren"], DEFAULT_MAX_RUNNING_CHILDREN);
        assert_eq!(
            defaults["project"],
            serde_json::to_value(ProjectRules::default()).unwrap()
        );
        assert_eq!(
            fixtures["rejectedPermissionModes"],
            json!(REJECTED_PERMISSION_MODES)
        );
    }

    #[test]
    fn reason_keys_and_check_order_match_the_fixture() {
        let fixtures = fixtures();
        let parse_reasons = [
            ParseReason::FileMissing,
            ParseReason::Malformed,
            ParseReason::UnsupportedVersion,
            ParseReason::InvalidEntry,
            ParseReason::PathNotAbsolute,
            ParseReason::BypassPermissions,
        ];
        let keys: Vec<String> = fixtures["reasons"]["parse"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        let mut ours: Vec<String> = parse_reasons
            .iter()
            .map(|r| serde_json::to_value(r).unwrap().as_str().unwrap().into())
            .collect();
        let mut theirs = keys;
        ours.sort();
        theirs.sort();
        assert_eq!(ours, theirs);

        let order = [
            DenyReason::ProjectNotListed,
            DenyReason::ProjectNotAllowed,
            DenyReason::ProviderNotInstalled,
            DenyReason::ProviderNotAllowed,
            DenyReason::ProviderDeniedByProject,
            DenyReason::ProviderHasNoModels,
            DenyReason::ModelNotAllowed,
            DenyReason::ModelNotOffered,
            DenyReason::PermissionModeUnattended,
            DenyReason::InteractiveNotAllowed,
            DenyReason::ProjectLimitReached,
            DenyReason::GlobalLimitReached,
        ];
        let ours: Vec<String> = order.iter().map(|r| r.key()).collect();
        assert_eq!(json!(ours), fixtures["checkOrder"]);
        for key in &ours {
            assert!(
                fixtures["reasons"]["checkSpawn"].get(key).is_some(),
                "{key} has no fixture text"
            );
        }
    }

    #[test]
    fn every_visible_projects_case_matches_the_fixture() {
        let fixtures = fixtures();
        let cases = fixtures["visibleProjects"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let policies = case["projectPolicies"].as_object().unwrap();
            let visible = visible_projects(
                &policy_from(&case["policy"]),
                |path| {
                    policies
                        .get(path)
                        .map(provider_policy_from)
                        .unwrap_or_default()
                },
                &offered_from(&case["offeredModels"]),
                &modes_from(&case["permissionModes"]),
            );
            assert_eq!(
                serde_json::to_value(&visible).unwrap(),
                case["expected"],
                "{name}"
            );
        }
    }

    #[test]
    fn every_check_spawn_case_matches_the_fixture() {
        let fixtures = fixtures();
        let cases = fixtures["checkSpawn"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let request = &case["request"];
            let running = &case["running"];
            let outcome = check_spawn(
                &policy_from(&case["policy"]),
                &provider_policy_from(&case["projectPolicy"]),
                &offered_from(&case["offeredModels"]),
                &modes_from(&case["permissionModes"]),
                &RunningChildren {
                    total: running["total"].as_u64().unwrap() as u32,
                    by_project: serde_json::from_value(running["byProject"].clone()).unwrap(),
                },
                &SpawnRequest {
                    project_path: request["projectPath"].as_str().unwrap(),
                    provider: request["provider"].as_str().unwrap(),
                    model: request["model"].as_str().unwrap(),
                    headless: request["headless"].as_bool().unwrap(),
                },
            );
            let expected = &case["expected"];
            let actual = match outcome {
                Ok(mode) => json!({ "ok": true, "permissionMode": mode }),
                Err(denied) => {
                    assert!(!denied.message.is_empty(), "{name}: message");
                    json!({ "ok": false, "code": "supervisor_denied", "reason": denied.reason.key() })
                }
            };
            assert_eq!(&actual, expected, "{name}");
        }
    }

    fn usable(weights: &[(&str, Option<u32>)]) -> Vec<VisibleProvider> {
        weights
            .iter()
            .map(|(id, weight)| VisibleProvider {
                id: id.to_string(),
                models: vec!["m".into()],
                permission_mode: None,
                weight: *weight,
            })
            .collect()
    }

    fn counts(pairs: &[(&str, u32)]) -> BTreeMap<String, u32> {
        pairs.iter().map(|(id, n)| (id.to_string(), *n)).collect()
    }

    #[test]
    fn balancing_is_absent_without_a_share_above_zero() {
        assert_eq!(
            balancing(&usable(&[("claude", None), ("codex", None)]), &counts(&[])),
            None
        );
        assert_eq!(
            balancing(&usable(&[("claude", Some(0))]), &counts(&[("claude", 4)])),
            None
        );
    }

    #[test]
    fn balancing_names_the_provider_furthest_behind_its_share() {
        let providers = usable(&[
            ("antigravity", None),
            ("claude", Some(2)),
            ("codex", Some(1)),
        ]);
        // Nothing started yet: the tie goes to the larger share.
        let fresh = balancing(&providers, &counts(&[])).unwrap();
        assert_eq!(fresh.next.as_deref(), Some("claude"));
        assert_eq!(fresh.window_days, BALANCING_WINDOW_DAYS);
        let targets: Vec<u32> = fresh.providers.iter().map(|p| p.target_percent).collect();
        assert_eq!(targets, vec![0, 67, 33]);
        assert!(fresh.providers.iter().all(|p| p.actual_percent.is_none()));

        // claude 2 of 2, codex 0 of 1: codex is behind.
        let after_two = balancing(&providers, &counts(&[("claude", 2)])).unwrap();
        assert_eq!(after_two.next.as_deref(), Some("codex"));

        // claude 3 per 2, codex 1 per 1: codex is still behind; a provider
        // without a share is never suggested, even when it ran most.
        let later = balancing(
            &providers,
            &counts(&[("antigravity", 9), ("claude", 3), ("codex", 1)]),
        )
        .unwrap();
        assert_eq!(later.next.as_deref(), Some("codex"));
        let actual: Vec<Option<u32>> = later.providers.iter().map(|p| p.actual_percent).collect();
        assert_eq!(actual, vec![Some(69), Some(23), Some(8)]);
        assert_eq!(later.providers[1].spawns, 3);
    }

    #[test]
    fn balancing_ties_on_the_same_share_go_to_the_first_by_id() {
        let providers = usable(&[("claude", Some(1)), ("codex", Some(1))]);
        let tie = balancing(&providers, &counts(&[("claude", 1), ("codex", 1)])).unwrap();
        assert_eq!(tie.next.as_deref(), Some("claude"));
    }

    #[test]
    fn supervisor_candidate_providers_and_parsing() {
        // Defaults to single provider
        let default_model = SupervisorModel::default();
        assert_eq!(default_model.candidate_providers(), vec!["claude"]);

        // Explicit single provider in field
        let single_model = SupervisorModel {
            provider: "codex".to_string(),
            model: None,
            providers: None,
            chrome: false,
        };
        assert_eq!(single_model.candidate_providers(), vec!["codex"]);

        // Explicit list in providers overrides provider field for candidates
        let multi_model = SupervisorModel {
            provider: "claude".to_string(),
            model: None,
            providers: Some(vec![
                "Codex".to_string(),
                "claude".to_string(),
                "codex".to_string(),
            ]),
            chrome: false,
        };
        assert_eq!(multi_model.candidate_providers(), vec!["codex", "claude"]);

        // Parsed from json
        let parsed = parse(Some(
            r#"{
                "version": 1,
                "supervisor": {
                    "provider": "claude",
                    "providers": ["codex", "claude"]
                }
            }"#,
        ));
        assert_eq!(
            parsed.policy.supervisor.candidate_providers(),
            vec!["codex", "claude"]
        );
        assert_eq!(
            parsed.policy.supervisor.providers,
            Some(vec!["codex".to_string(), "claude".to_string()])
        );
    }
}
