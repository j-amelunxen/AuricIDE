//! The one spawn the supervisor link does without a supervisor: the agent of
//! a job (`jobs.create`, `docs/design-supervisor-link.md`, "Jobs").
//!
//! It gets no right a supervisor's child would not get. Provider and model
//! are chosen the way a supervisor is told to choose them — the project's
//! load-balancing `next`, then the smallest ranked model — and the result
//! passes `check_spawn` against the supervisor policy like any child, with
//! the link's running jobs counted as its children. The agent is always
//! headless and always in a worktree of its own.

use super::protocol::*;
use super::supervised::balancing_since;
use super::{Dispatcher, Outcome};
use crate::agents::{AgentRole, AgentStatus};
use crate::supervisor::policy::{
    check_spawn, visible_projects, RunningChildren, SpawnRequest, VisibleProject,
};
use crate::supervisor::{canonical_project_path, model_names};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

/// What a job's spawn started.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LinkSpawn {
    pub agent_id: String,
    pub provider: String,
    pub model: String,
    /// The agent's working directory: its worktree.
    pub repo_path: Option<String>,
}

fn denied(reason: &str, message: String) -> ControlError {
    ControlError::new(ErrorCode::SupervisorDenied, message).with_reason(reason)
}

impl Dispatcher {
    /// The provider a supervisor would pick here: the balancing `next`, else
    /// the supervisor's own provider when the project allows it, else the
    /// first one the project allows.
    fn link_provider<'p>(
        &self,
        project: &'p VisibleProject,
    ) -> Option<&'p crate::supervisor::policy::VisibleProvider> {
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

    /// The smallest model of `provider` the project allows that has a size.
    /// Unranked models are never picked by default, as for a supervisor.
    fn link_model(&self, provider: &str, allowed: &[String]) -> Option<String> {
        let offered = self.backend.offered_models();
        offered
            .get(provider)?
            .iter()
            .filter(|option| allowed.contains(&option.value))
            .filter_map(|option| option.rank.map(|rank| (rank, option.value.clone())))
            .min()
            .map(|(_, model)| model)
    }

    /// Running and queued agents among `link_agents`, as children of one
    /// supervisor would be counted.
    fn link_running(&self, link_agents: &BTreeSet<String>) -> RunningChildren {
        let mut running = RunningChildren::default();
        for agent in self.backend.agents() {
            let live = matches!(agent.status, AgentStatus::Running | AgentStatus::Queued);
            if !live || !link_agents.contains(&agent.id) {
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

    /// Starts a job's agent in `project_path` with `prompt`, or says which
    /// policy rule refused it (`supervisor_denied`, with the rule as reason).
    pub(crate) fn spawn_for_link(
        &self,
        project_path: &str,
        prompt: String,
        name: String,
        link_agents: &BTreeSet<String>,
    ) -> Result<LinkSpawn, ControlError> {
        let project_path = canonical_project_path(project_path);
        let policy = self.backend.supervisor_policy();
        let offered = model_names(&self.backend.offered_models());
        let modes = self.backend.provider_modes(&policy);
        let visible = visible_projects(
            &policy,
            |path| self.backend.project_provider_policy(Path::new(path)),
            &offered,
            &modes,
        );
        let Some(project) = visible.iter().find(|p| p.path == project_path) else {
            return Err(denied(
                "project_not_listed",
                format!(
                    "{project_path} is not open to supervisors. Allow it under Settings → Supervisor."
                ),
            ));
        };
        let Some(provider) = self.link_provider(project) else {
            return Err(denied(
                "provider_not_allowed",
                format!("No provider is allowed for supervisors in {project_path}."),
            ));
        };
        let Some(model) = self.link_model(&provider.id, &provider.models) else {
            return Err(denied(
                "no_ranked_model",
                format!(
                    "No allowed {} model in {project_path} has a size (rank), so none is picked \
                     by default.",
                    provider.id
                ),
            ));
        };
        let request = SpawnRequest {
            project_path: &project_path,
            provider: &provider.id,
            model: &model,
            headless: true,
        };
        let check = || {
            check_spawn(
                &policy,
                &self
                    .backend
                    .project_provider_policy(Path::new(&project_path)),
                &offered,
                &modes,
                &self.link_running(link_agents),
                &request,
            )
            .map_err(|refused| denied(&refused.reason.key(), refused.message))
        };
        // Held through the spawn, as for a supervisor's children: the limit
        // counts agents the manager knows, and one is known only once the
        // spawn returns.
        let _gate = self
            .supervisor_spawn_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let permission_mode = check()?;
        self.start_link_agent(SpawnParams {
            project_path: project_path.clone(),
            prompt,
            provider: Some(provider.id.clone()),
            model: Some(model.clone()),
            permission_mode,
            headless: Some(true),
            name: Some(name),
            role: Some(AgentRole::Worker),
            role_passed: false,
            worktree: Some(true),
        })
    }

    /// Hands the checked spawn to the frontend, provenance set by Rust, and
    /// reads back the agent and its worktree.
    fn start_link_agent(&self, params: SpawnParams) -> Result<LinkSpawn, ControlError> {
        let provider = params.provider.clone().unwrap_or_default();
        let model = params.model.clone().unwrap_or_default();
        let outcome: Outcome = self.spawn(FrontendSpawnParams {
            params,
            spawned_by_agent_id: None,
            run_source: Some(RUN_SOURCE_SUPERVISOR.to_string()),
        });
        let agent_id = outcome?
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                ControlError::new(ErrorCode::Internal, "spawn answered without agentId")
            })?;
        let repo_path = self.find_agent(&agent_id).and_then(|agent| agent.repo_path);
        Ok(LinkSpawn {
            agent_id,
            provider,
            model,
            repo_path,
        })
    }
}
