//! `link_policy_get` and `link_policy_propose`: how a supervisor reads the
//! supervisor link policy and asks for a change to it
//! (`docs/design-supervisor-link.md`, "Policy proposals").
//!
//! Supervisor callers only. An external caller, and so the supervisor link
//! socket, which dispatches as one, is refused: the person edits the settings
//! directly, and a client must not be able to raise its own permissions. No
//! method here decides a proposal; that is a Tauri command behind the IDE's
//! Apply button.

use super::protocol::*;
use super::{to_value, Dispatcher, Outcome};
use crate::supervisor_link::jobs::now_ms;
use crate::supervisor_link::policy::{
    job_kinds_dir_in, read_stored, resolve, JobLimits, LinkPolicy, ProjectConfig, ProjectOrigins,
    StoredPolicy,
};
use crate::supervisor_link::proposals::{self, Proposal, ProposalStore, Proposer};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// What the link acts on, without the reading-side details.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveLinkPolicy {
    pub projects: BTreeMap<String, ProjectConfig>,
    pub origins: BTreeMap<String, ProjectOrigins>,
    pub project_daily_limits: BTreeMap<String, u32>,
    pub jobs: JobLimits,
}

impl From<LinkPolicy> for EffectiveLinkPolicy {
    fn from(policy: LinkPolicy) -> Self {
        Self {
            projects: policy.projects,
            origins: policy.origins,
            project_daily_limits: policy.project_daily_limits,
            jobs: policy.jobs,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingProposal {
    pub id: String,
    pub reason: String,
    pub diff: Vec<String>,
    pub expires_at: u64,
}

impl From<Proposal> for PendingProposal {
    fn from(proposal: Proposal) -> Self {
        Self {
            id: proposal.id,
            reason: proposal.reason,
            diff: proposal.diff,
            expires_at: proposal.expires_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPolicyGetResult {
    pub stored: StoredPolicy,
    pub effective: EffectiveLinkPolicy,
    pub pending: Vec<PendingProposal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPolicyProposeResult {
    pub proposal_id: String,
    /// Always `pending`: nothing is applied by proposing.
    pub status: &'static str,
    pub expires_at: u64,
    pub diff: Vec<String>,
}

pub(super) fn supervisors_only() -> ControlError {
    ControlError::new(
        ErrorCode::OutsideSupervisorScope,
        "link_policy_get and link_policy_propose are for supervisors; a person changes the \
         supervisor link settings in Settings → Supervisor → Supervisor link",
    )
}

impl Dispatcher {
    fn link_app_data(&self) -> Result<PathBuf, ControlError> {
        self.backend
            .app_data_dir()
            .ok_or_else(|| ControlError::new(ErrorCode::Internal, "no app data directory"))
    }

    /// The stored policy (what a proposal changes), the effective one per
    /// project with each part's origin, and the proposals still pending.
    pub(super) fn link_policy_get(&self) -> Outcome {
        let dir = self.link_app_data()?;
        let stored = read_stored(&dir);
        let effective = resolve(&stored, Some(&job_kinds_dir_in(&dir)));
        let pending = ProposalStore::new(&dir)
            .pending(now_ms())
            .into_iter()
            .map(PendingProposal::from)
            .collect();
        to_value(LinkPolicyGetResult {
            stored,
            effective: effective.into(),
            pending,
        })
    }

    /// Checks the change, stores it as a pending proposal and raises the
    /// inbox notification with Apply and Discard. Changes nothing else.
    pub(super) fn link_policy_propose(
        &self,
        supervisor: &str,
        params: LinkPolicyProposeParams,
    ) -> Outcome {
        let dir = self.link_app_data()?;
        let proposed_by = Proposer {
            agent_id: supervisor.to_string(),
            name: self.find_agent(supervisor).map(|agent| agent.name),
        };
        let proposal = ProposalStore::new(&dir)
            .propose(proposed_by, &params.reason, params.changes, now_ms())
            .map_err(|refusal| ControlError::new(ErrorCode::InvalidParams, refusal))?;
        self.backend.notify(proposals::notification(&proposal));
        to_value(LinkPolicyProposeResult {
            proposal_id: proposal.id,
            status: "pending",
            expires_at: proposal.expires_at,
            diff: proposal.diff,
        })
    }
}
