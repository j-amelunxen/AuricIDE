//! The supervisor scope (ADR 0004, `docs/design-agent-control.md`
//! "Supervisor scope"; machine-checkable half: `callerScope` in
//! `agentControl.fixtures.json`).
//!
//! A supervisor sees and touches only the agents it started. Any other id is
//! `unknown_agent`, the same answer as an id that does not exist, so it learns
//! nothing from probing. It may type into its own interactive children (to
//! answer their questions), may not name a role or a permission mode, and
//! every spawn passes the supervisor policy here before it reaches the
//! frontend.

use super::protocol::*;
use super::{to_value, Dispatcher, Outcome};
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use crate::providers::ModelOption;
use crate::supervisor::policy::{
    balancing, check_spawn, normalize_provider_id, resolve_model, visible_projects, Balancing,
    ModelChoice, ModelRequest, SpawnRequest, VisibleProject, VisibleProvider,
    BALANCING_WINDOW_DAYS,
};
use crate::supervisor::{
    canonical_project_path, live_runs_by_provider, model_names, running_children,
};
use std::collections::BTreeMap;
use std::path::Path;

impl Dispatcher {
    pub(super) fn dispatch_supervised(&self, supervisor: &str, request: Request) -> Outcome {
        match request {
            Request::ListAgents(_) => self.list_own_children(supervisor),
            Request::ReadOutput(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.read_output(params)
            }
            Request::AwaitResult(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.await_result(params)
            }
            Request::Kill(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.kill(params)
            }
            Request::RemoveWorktree(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.remove_worktree(params)
            }
            Request::Dismiss(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.dismiss(params)
            }
            Request::SendInput(params) => {
                let params = self.input_target(params)?;
                self.ensure_child(supervisor, &params.agent_id)?;
                self.send_input(params)
            }
            Request::Spawn(params) => self.supervised_spawn(supervisor, params),
            Request::ListProjects(params) => {
                self.supervised_projects(supervisor, params.project.as_deref())
            }
            Request::LinkPolicyGet(_) => self.link_policy_get(),
            Request::LinkPolicyPropose(params) => self.link_policy_propose(supervisor, params),
        }
    }

    /// The agents `supervisor` started: the live ones, then the finished ones
    /// whose result is still kept, newest first. A finished agent leaves the
    /// manager at once, so without the second half a supervisor whose
    /// children all finished saw an empty list and took them for lost.
    fn list_own_children(&self, supervisor: &str) -> Outcome {
        let live: Vec<AgentSummary> = self
            .summaries()
            .into_iter()
            .filter(|summary| summary.info.spawned_by_agent_id.as_deref() == Some(supervisor))
            .collect();
        let finished: Vec<AgentSummary> = self
            .run_results
            .finished_children_of(supervisor)
            .into_iter()
            .filter(|info| !live.iter().any(|summary| summary.info.id == info.id))
            .map(|info| AgentSummary {
                output_bytes: self.buffers.total_bytes(&info.id),
                stall: Default::default(),
                info,
            })
            .collect();
        let agents = live.into_iter().chain(finished).collect();
        let mut listed = to_value(ListAgentsResult { agents })?;
        // Project only this supervisor's listing; the shared AgentInfo and
        // await_result keep their existing idle/error status contract.
        for agent in listed["agents"].as_array_mut().into_iter().flatten() {
            let Some(result) = agent["id"].as_str().and_then(|id| self.run_results.get(id)) else {
                continue;
            };
            agent["status"] = serde_json::json!(if result.is_error { "error" } else { "done" });
            agent["finishedAt"] = result.finished_at.into();
            let preview = result.answer.as_deref().and_then(|answer| {
                answer
                    .lines()
                    .rev()
                    .map(str::trim)
                    .find(|line| line.starts_with("ANSWER:"))
                    .map(|line| line.chars().take(300).collect::<String>())
            });
            agent["answerPreview"] = serde_json::json!(preview);
        }
        Ok(listed)
    }

    /// `Ok` only for an agent `supervisor` started, live or finished.
    fn ensure_child(&self, supervisor: &str, agent_id: &str) -> Result<(), ControlError> {
        let live_child = self
            .find_agent(agent_id)
            .is_some_and(|agent| agent.spawned_by_agent_id.as_deref() == Some(supervisor));
        let finished_child = self.run_results.parent_of(agent_id).as_deref() == Some(supervisor);
        if live_child || finished_child {
            Ok(())
        } else {
            Err(Self::unknown(agent_id))
        }
    }

    fn supervised_spawn(&self, supervisor: &str, params: SpawnParams) -> Outcome {
        if params.role_passed {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                "role is not a spawn parameter for a supervisor; its agents are workers",
            ));
        }
        if params.permission_mode.is_some() {
            return Err(ControlError::new(
                ErrorCode::OutsideSupervisorScope,
                "A supervisor cannot choose a permission mode; the supervisor policy names it",
            ));
        }
        let Some(headless) = params.headless else {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                "a supervisor's spawn needs headless; provider and model may be left out",
            ));
        };
        let Some(project_path) = params.project_path.as_deref() else {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                super::protocol::WORKER_PROJECT_PATH_MESSAGE,
            ));
        };
        let project_path = canonical_project_path(project_path);
        let (provider, choice) = self.supervised_choice(supervisor, &project_path, &params)?;
        let model = choice.model.clone();
        let request = SpawnRequest {
            project_path: &project_path,
            provider: &provider,
            model: &model,
            headless,
        };
        // Checked once without the gate, so a refusal answers at once rather
        // than waiting behind another spawn's frontend round trip.
        self.check_supervised_spawn(supervisor, &request)?;
        // Then again under the gate, held through the spawn: the limit counts
        // children the manager knows, and a child is only known once the
        // spawn returns, so two passed requests must not both go ahead.
        let _gate = self
            .supervisor_spawn_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let permission_mode = self.check_supervised_spawn(supervisor, &request)?;

        let model_reason = params.model_reason.clone();
        let started = self.spawn(FrontendSpawnParams {
            params: SpawnParams {
                project_path: Some(project_path.clone()),
                provider: Some(provider.clone()),
                model: Some(model.clone()),
                headless: Some(headless),
                permission_mode,
                role: Some(AgentRole::Worker),
                // Booked here, in the spawn log; the frontend has no use for it.
                model_reason: None,
                ..params
            },
            spawned_by_agent_id: Some(supervisor.to_string()),
            run_source: Some(RUN_SOURCE_SUPERVISOR.to_string()),
        })?;
        if let Some(dir) = self.backend.app_data_dir() {
            super::spawn_log::append(
                &dir,
                &super::spawn_log::SpawnLogEntry {
                    at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    supervisor_id: supervisor.to_string(),
                    agent_id: started
                        .get("agentId")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                    project_path,
                    provider,
                    model,
                    rank: choice.rank,
                    picked: choice.picked,
                    model_reason,
                },
            );
        }
        Ok(started)
    }

    /// The provider and model a supervisor's spawn runs: what it named, else
    /// what it is told to pick (`preferred_provider`, the smallest ranked
    /// model), through the size gate (`resolve_model`).
    fn supervised_choice(
        &self,
        supervisor: &str,
        project_path: &str,
        params: &SpawnParams,
    ) -> Result<(String, ModelChoice), ControlError> {
        let policy = self.backend.supervisor_policy();
        let offered = self.backend.offered_models();
        let project = visible_projects(
            &policy,
            |path| self.backend.project_provider_policy(Path::new(path)),
            &model_names(&offered),
            &self.backend.provider_modes(&policy),
        )
        .into_iter()
        .find(|project| project.path == project_path);
        let provider = match params.provider.as_deref() {
            Some(named) => normalize_provider_id(named),
            None => project
                .as_ref()
                .and_then(|project| self.preferred_provider(project))
                .map_or_else(|| policy.supervisor.provider.clone(), |p| p.id.clone()),
        };
        let allowed = project
            .as_ref()
            .and_then(|project| project.providers.iter().find(|p| p.id == provider))
            .map(|visible| visible.models.clone())
            .unwrap_or_default();
        let options: &[ModelOption] = offered.get(&provider).map_or(&[], Vec::as_slice);
        if params.model.is_none() && allowed.is_empty() {
            // Nothing this supervisor may use there to pick from: the policy
            // check names why, as it would for a model that was named.
            let placeholder = options.first().map(|o| o.value.clone()).unwrap_or_default();
            self.check_supervised_spawn(
                supervisor,
                &SpawnRequest {
                    project_path,
                    provider: &provider,
                    model: &placeholder,
                    headless: params.headless.unwrap_or(true),
                },
            )?;
        }
        let choice = resolve_model(
            options,
            &allowed,
            &ModelRequest {
                provider: &provider,
                project_path,
                model: params.model.as_deref(),
                reason: params.model_reason.as_deref(),
            },
        )
        .map_err(|denied| {
            ControlError::new(ErrorCode::SupervisorDenied, denied.message)
                .with_reason(denied.reason.key())
        })?;
        Ok((provider, choice))
    }

    /// `check_spawn` against the policy, the offer and the running children
    /// as they are now.
    fn check_supervised_spawn(
        &self,
        supervisor: &str,
        request: &SpawnRequest<'_>,
    ) -> Result<Option<String>, ControlError> {
        let policy = self.backend.supervisor_policy();
        let offered = model_names(&self.backend.offered_models());
        let modes = self.backend.provider_modes(&policy);
        let project_policy = self
            .backend
            .project_provider_policy(Path::new(request.project_path));
        let running = running_children(&self.backend.agents(), supervisor);
        check_spawn(
            &policy,
            &project_policy,
            &offered,
            &modes,
            &running,
            request,
        )
        .map_err(|denied| {
            ControlError::new(ErrorCode::SupervisorDenied, denied.message)
                .with_reason(denied.reason.key())
        })
    }

    /// The projects the policy allows, sorted by path, each with what the
    /// supervisor may use there, and one catalog describing every model they
    /// allow. An allowed project the IDE does not list (no longer recent or
    /// starred) is still shown, built from its folder. `wanted` (a path or a
    /// name) keeps only the projects it names; none is `unknown_project`.
    fn supervised_projects(&self, supervisor: &str, wanted: Option<&str>) -> Outcome {
        let policy = self.backend.supervisor_policy();
        let offered = self.backend.offered_models();
        let visible = visible_projects(
            &policy,
            |path| self.backend.project_provider_policy(Path::new(path)),
            &model_names(&offered),
            &self.backend.provider_modes(&policy),
        );
        let agents = self.backend.agents();
        let running = running_children(&agents, supervisor);
        let listed = self.backend.projects();
        let since = balancing_since();
        let entries: Vec<(ProjectEntry, VisibleProject)> = visible
            .into_iter()
            .map(|project| {
                let entry = listed
                    .iter()
                    .find(|entry| canonical_project_path(&entry.path) == project.path)
                    .cloned()
                    .unwrap_or_else(|| unlisted_entry(&project.path, &agents));
                (entry, project)
            })
            .filter(|(entry, _)| wanted.map_or(true, |wanted| names_project(entry, wanted)))
            .collect();
        if let Some(wanted) = wanted {
            if entries.is_empty() {
                return Err(unknown_project(wanted));
            }
        }
        let catalog = model_catalog(&offered, entries.iter().map(|(_, project)| project));
        let projects = entries
            .into_iter()
            .map(|(mut entry, project)| {
                let balancing = self.project_balancing(&project, &agents, &since);
                let providers = project
                    .providers
                    .into_iter()
                    .map(|provider| SupervisorProviderAccess {
                        models: allowed_models(&catalog, &provider),
                        id: provider.id,
                        permission_mode: provider.permission_mode,
                    })
                    .collect();
                entry.supervisor = Some(SupervisorAccess {
                    balancing,
                    providers,
                    allow_interactive: project.allow_interactive,
                    running_children: running.by_project.get(&project.path).copied().unwrap_or(0),
                    max_running: project.max_running,
                });
                entry
            })
            .collect();
        to_value(ListProjectsResult {
            projects,
            catalog: Some(catalog),
        })
    }

    /// The provider a supervisor is told to take in `project`: the balancing
    /// `next`, else its own provider when the project allows it, else the
    /// first one the project allows.
    pub(super) fn preferred_provider<'p>(
        &self,
        project: &'p VisibleProject,
    ) -> Option<&'p VisibleProvider> {
        let agents = self.backend.agents();
        let next = self
            .project_balancing(project, &agents, &balancing_since())
            .and_then(|balancing| balancing.next);
        let preferred =
            next.unwrap_or_else(|| self.backend.supervisor_policy().supervisor.provider);
        project
            .providers
            .iter()
            .find(|provider| provider.id == preferred)
            .or_else(|| project.providers.first())
    }
}

/// Whether `wanted` names the project: its path (any spelling of it) or its
/// name, case aside.
pub(super) fn names_project(entry: &ProjectEntry, wanted: &str) -> bool {
    let wanted = wanted.trim();
    if Path::new(wanted).is_absolute() {
        return canonical_project_path(wanted) == canonical_project_path(&entry.path);
    }
    entry.name.eq_ignore_ascii_case(wanted)
}

pub(super) fn unknown_project(wanted: &str) -> ControlError {
    ControlError::new(
        ErrorCode::UnknownProject,
        format!("No project matches '{wanted}'. Call list_projects without project to see yours."),
    )
}

/// Every model the projects allow, once per provider, in the provider's own
/// order.
fn model_catalog<'p>(
    offered: &BTreeMap<String, Vec<ModelOption>>,
    projects: impl Iterator<Item = &'p VisibleProject>,
) -> ModelCatalog {
    let mut allowed: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for provider in projects.flat_map(|project| &project.providers) {
        let ids = allowed.entry(provider.id.as_str()).or_default();
        ids.extend(provider.models.iter().map(String::as_str));
    }
    allowed
        .into_iter()
        .map(|(provider, ids)| {
            let options = offered.get(provider).map_or(&[][..], Vec::as_slice);
            let mut entries: Vec<SupervisorModelEntry> = options
                .iter()
                .filter(|option| ids.contains(&option.value.as_str()))
                .map(catalog_entry)
                .collect();
            // A model the policy keeps but the provider no longer describes.
            for id in ids {
                if !entries.iter().any(|entry| entry.id == id) {
                    entries.push(SupervisorModelEntry {
                        id: id.to_string(),
                        label: id.to_string(),
                        rank: None,
                        use_for: None,
                        relative_cost: None,
                    });
                }
            }
            (provider.to_string(), entries)
        })
        .collect()
}

fn catalog_entry(option: &ModelOption) -> SupervisorModelEntry {
    SupervisorModelEntry {
        id: option.value.clone(),
        label: option.label.clone(),
        rank: option.rank,
        use_for: option.use_for.clone(),
        relative_cost: option.relative_cost,
    }
}

/// `"all"` when the provider allows every model the catalog lists for it.
fn allowed_models(catalog: &ModelCatalog, provider: &VisibleProvider) -> AllowedModels {
    let listed = catalog.get(&provider.id).map_or(&[][..], Vec::as_slice);
    let everything = listed
        .iter()
        .all(|entry| provider.models.contains(&entry.id));
    if everything {
        AllowedModels::All
    } else {
        AllowedModels::Ids(provider.models.clone())
    }
}

/// The start of the load-balancing window, as `recent_runs` takes it.
pub(super) fn balancing_since() -> String {
    (chrono::Utc::now() - chrono::Duration::days(BALANCING_WINDOW_DAYS.into()))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Dispatcher {
    /// The project's load balancing over the window starting `since`, live
    /// runs included. Only worth a database read where the project balances
    /// at all.
    pub(super) fn project_balancing(
        &self,
        project: &VisibleProject,
        agents: &[AgentInfo],
        since: &str,
    ) -> Option<Balancing> {
        let balanced = project
            .providers
            .iter()
            .any(|provider| provider.weight.unwrap_or(0) > 0);
        if !balanced {
            return None;
        }
        let mut runs = self.backend.recent_runs(Path::new(&project.path), since);
        for (id, live) in live_runs_by_provider(agents, &project.path) {
            *runs.entry(id).or_default() += live;
        }
        balancing(&project.providers, &runs)
    }
}

fn unlisted_entry(path: &str, agents: &[AgentInfo]) -> ProjectEntry {
    let facts = super::projects::inspect_folder(Path::new(path), None);
    let (description, description_source) = match facts.description {
        Some(described) => (Some(described.text), Some(described.source)),
        None => (None, None),
    };
    ProjectEntry {
        path: path.to_string(),
        name: super::projects::project_name(path),
        starred: false,
        is_open: false,
        initialized: facts.initialized,
        last_opened_at: None,
        running_agents: agents
            .iter()
            .filter(|agent| agent.status == AgentStatus::Running)
            .filter(|agent| agent.project_path.as_deref() == Some(path))
            .count(),
        description,
        description_source,
        supervisor: None,
    }
}
