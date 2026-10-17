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
use crate::supervisor::policy::{
    balancing, check_spawn, normalize_provider_id, visible_projects, Balancing, SpawnRequest,
    VisibleProject, BALANCING_WINDOW_DAYS,
};
use crate::supervisor::{
    canonical_project_path, live_runs_by_provider, model_names, running_children,
};
use std::path::Path;

impl Dispatcher {
    pub(super) fn dispatch_supervised(&self, supervisor: &str, request: Request) -> Outcome {
        match request {
            Request::ListAgents(_) => {
                self.list_agents(|agent| agent.spawned_by_agent_id.as_deref() == Some(supervisor))
            }
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
            Request::SendInput(params) => {
                self.ensure_child(supervisor, &params.agent_id)?;
                self.send_input(params)
            }
            Request::Spawn(params) => self.supervised_spawn(supervisor, params),
            Request::ListProjects(_) => self.supervised_projects(supervisor),
            Request::LinkPolicyGet(_) => self.link_policy_get(),
            Request::LinkPolicyPropose(params) => self.link_policy_propose(supervisor, params),
        }
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
        let (Some(provider), Some(model), Some(headless)) = (
            params.provider.clone(),
            params.model.clone(),
            params.headless,
        ) else {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                "a supervisor's spawn needs provider, model and headless; nothing is filled in",
            ));
        };

        let provider = normalize_provider_id(&provider);
        let project_path = canonical_project_path(&params.project_path);
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

        self.spawn(FrontendSpawnParams {
            params: SpawnParams {
                project_path: project_path.clone(),
                provider: Some(provider.clone()),
                model: Some(model.clone()),
                headless: Some(headless),
                permission_mode,
                role: Some(AgentRole::Worker),
                ..params
            },
            spawned_by_agent_id: Some(supervisor.to_string()),
            run_source: Some(RUN_SOURCE_SUPERVISOR.to_string()),
        })
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
    /// supervisor may use there. An allowed project the IDE does not list
    /// (no longer recent or starred) is still shown, built from its folder.
    fn supervised_projects(&self, supervisor: &str) -> Outcome {
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
        let projects = visible
            .into_iter()
            .map(|project| {
                let mut entry = listed
                    .iter()
                    .find(|entry| canonical_project_path(&entry.path) == project.path)
                    .cloned()
                    .unwrap_or_else(|| unlisted_entry(&project.path, &agents));
                let balancing = self.project_balancing(&project, &agents, &since);
                let providers = project
                    .providers
                    .into_iter()
                    .map(|provider| SupervisorProviderAccess {
                        models: provider
                            .models
                            .iter()
                            .map(|id| model_entry(&offered, &provider.id, id))
                            .collect(),
                        id: provider.id,
                        permission_mode: provider.permission_mode,
                    })
                    .collect();
                entry.supervisor = Some(SupervisorAccess {
                    providers,
                    allow_interactive: project.allow_interactive,
                    running_children: running.by_project.get(&project.path).copied().unwrap_or(0),
                    max_running: project.max_running,
                    balancing,
                });
                entry
            })
            .collect();
        to_value(ListProjectsResult { projects })
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

fn model_entry(
    offered: &std::collections::BTreeMap<String, Vec<crate::providers::ModelOption>>,
    provider: &str,
    model: &str,
) -> SupervisorModelEntry {
    let option = offered
        .get(provider)
        .and_then(|models| models.iter().find(|option| option.value == model));
    SupervisorModelEntry {
        id: model.to_string(),
        label: option.map_or_else(|| model.to_string(), |option| option.label.clone()),
        rank: option.and_then(|option| option.rank),
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
