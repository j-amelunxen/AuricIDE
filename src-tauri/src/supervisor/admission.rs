//! The shared child-admission snapshot used by control prechecks and process launch.
//!
//! Callers read their inputs at the original gate, in their original order.
//! This module maps those explicit snapshots, including running-child counts,
//! into one policy check; a precheck result is never reused at process launch.

use super::policy::{self, Denied, ProviderModes, RunningChildren, SpawnRequest, SupervisorPolicy};
use crate::agents::{AgentConfig, AgentRole};
use crate::provider_policy::ProviderPolicy;
use crate::quota_blocks::QuotaBlock;
use std::collections::BTreeMap;

/// Inputs captured by one admission attempt. A later gate creates a fresh one.
pub struct ChildAdmission<'a> {
    policy: &'a SupervisorPolicy,
    project_policy: &'a ProviderPolicy,
    offered: &'a BTreeMap<String, Vec<String>>,
    modes: &'a BTreeMap<String, ProviderModes>,
    running: RunningChildren,
    quota_blocks: &'a [QuotaBlock],
}

impl<'a> ChildAdmission<'a> {
    pub fn new(
        running: RunningChildren,
        policy: &'a SupervisorPolicy,
        project_policy: &'a ProviderPolicy,
        offered: &'a BTreeMap<String, Vec<String>>,
        modes: &'a BTreeMap<String, ProviderModes>,
        quota_blocks: &'a [QuotaBlock],
    ) -> Self {
        Self {
            policy,
            project_policy,
            offered,
            modes,
            running,
            quota_blocks,
        }
    }

    fn inputs(&self) -> ChildCheckInputs<'_> {
        ChildCheckInputs {
            policy: self.policy,
            offered: self.offered,
            modes: self.modes,
            project_policy: self.project_policy,
            running: &self.running,
        }
    }

    /// Control keeps the structured reason and quota expiry for its wire error.
    pub fn check_request(&self, request: &SpawnRequest<'_>) -> Result<Option<String>, Denied> {
        check_request(&self.inputs(), self.quota_blocks, request)
    }

    /// Final launch also checks the caller's role and permission configuration.
    pub fn check_config(
        &self,
        config: &AgentConfig,
        canonical_project: Option<&str>,
    ) -> Result<(), String> {
        check_child_config_with_blocks(config, canonical_project, &self.inputs(), self.quota_blocks)
    }
}

fn check_request(
    inputs: &ChildCheckInputs<'_>,
    quota_blocks: &[QuotaBlock],
    request: &SpawnRequest<'_>,
) -> Result<Option<String>, Denied> {
    policy::check_spawn_with_blocks(
        inputs.policy,
        inputs.project_policy,
        inputs.offered,
        inputs.modes,
        inputs.running,
        quota_blocks,
        request,
    )
}

/// Everything the child check needs besides the spawn config.
pub(super) struct ChildCheckInputs<'a> {
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
#[cfg(test)]
pub(super) fn check_child_config(
    config: &AgentConfig,
    canonical_project: Option<&str>,
    inputs: &ChildCheckInputs<'_>,
) -> Result<(), String> {
    check_child_config_with_blocks(config, canonical_project, inputs, &[])
}

// code-gate: complexity-cyclomatic - each early return is one condition a supervisor's child must meet; listed flat so none is missed
fn check_child_config_with_blocks(
    config: &AgentConfig,
    canonical_project: Option<&str>,
    inputs: &ChildCheckInputs<'_>,
    quota_blocks: &[crate::quota_blocks::QuotaBlock],
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
    let permission_mode = check_request(
        inputs,
        quota_blocks,
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

#[cfg(test)]
#[path = "admission_tests.rs"]
mod tests;
