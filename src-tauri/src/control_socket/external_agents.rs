//! `external_register`, `external_stop` and `external_list`: how a supervisor
//! tells the IDE about a run it has no process for
//! (`docs/design-external-agents.md`).
//!
//! Supervisor callers only. An entry belongs to the caller's run folder, and
//! that folder comes from its agent record, which the PID walk found, never
//! from a parameter. So an outside client, and through it the supervisor link,
//! has nothing to act as and is refused.
//!
//! One exception, by capability: `external_register` hands its caller a token
//! for the new run (`capability_tokens`), and `external_stop` with that token is
//! accepted from any caller the socket admits, because the process that ends a
//! run (a detached reaper, a timeout) is often not in the supervisor's tree. The
//! token stops that one run and nothing else; it cannot force.

use super::protocol::*;
use super::{to_value, Dispatcher, Outcome};
use crate::capability_tokens::{self, GrantRequest};
use crate::external_agents::model::{
    self, apply_register, apply_stop, display_key, ExternalAgent, Links, Owner, RegisterInput,
    StopBy, TOKEN_ACTION_STOP, TOKEN_DEFAULT_TTL_SECONDS, TOKEN_KIND,
};
use crate::external_agents::revoke_tokens;
use crate::external_agents::{
    resolve_links, settle, store, ExternalError, ExternalRegisterParams, ExternalStopParams,
};
use crate::supervisor::pm_target::PmRefusal;
use crate::supervisor_link::jobs::now_ms;
use std::path::{Path, PathBuf};

pub(super) fn supervisors_only() -> ControlError {
    ControlError::new(
        ErrorCode::OutsideSupervisorScope,
        "external agents are for supervisors: an entry belongs to the caller's run folder",
    )
}

fn control_error(error: ExternalError) -> ControlError {
    let message = error.to_string();
    match error {
        ExternalError::Unreadable(_) => ControlError::new(ErrorCode::RegistryUnreadable, message),
        ExternalError::Storage(_) => ControlError::new(ErrorCode::Internal, message),
        ExternalError::KeyInUse(_) => ControlError::new(ErrorCode::SupervisorDenied, message)
            .with_reason("external_id_in_use"),
        ExternalError::LimitReached => {
            ControlError::new(ErrorCode::SupervisorDenied, message).with_reason("external_limit")
        }
        ExternalError::UnknownKey(_) | ExternalError::UnknownId(_) => {
            ControlError::new(ErrorCode::UnknownAgent, message)
        }
        ExternalError::InvalidParams(_) => ControlError::new(ErrorCode::InvalidParams, message),
        ExternalError::Token(error) => token_error(error),
    }
}

/// `token_denied` with its reason for what is about the token; storage and
/// readability keep their usual codes.
fn token_error(error: capability_tokens::TokenError) -> ControlError {
    use capability_tokens::TokenError;
    let message = error.to_string();
    match error.reason() {
        Some(reason) => ControlError::new(ErrorCode::TokenDenied, message).with_reason(reason),
        None => match error {
            TokenError::Unreadable(_) => ControlError::new(ErrorCode::RegistryUnreadable, message),
            TokenError::InvalidTtl => ControlError::new(ErrorCode::InvalidParams, message),
            _ => ControlError::new(ErrorCode::Internal, message),
        },
    }
}

impl Dispatcher {
    fn external_app_data(&self) -> Result<PathBuf, ControlError> {
        self.backend
            .app_data_dir()
            .ok_or_else(|| ControlError::new(ErrorCode::Internal, "no app data directory"))
    }

    fn external_owner(&self, supervisor: &str) -> Result<Owner, ControlError> {
        let run_dir = self
            .find_agent(supervisor)
            .and_then(|agent| agent.repo_path)
            .ok_or_else(|| {
                ControlError::new(
                    ErrorCode::Internal,
                    format!("{supervisor} has no run folder to own an external run"),
                )
            })?;
        Ok(Owner {
            run_dir,
            agent_id: supervisor.to_string(),
        })
    }

    /// Books what is due and says so. Every call here passes through this, so
    /// a history write that failed gets its next try without a timer.
    fn external_settle(&self, dir: &Path, now: u64) -> Result<(), ControlError> {
        let (booked, marked) = settle(dir, now).map_err(control_error)?;
        for entry in &booked {
            self.backend.usage_recorded(&entry.project_path, &entry.row);
        }
        if marked {
            self.backend.external_agents_changed();
        }
        Ok(())
    }

    /// The same check as `pm_target`, except that the contract answers
    /// `unknown_project` for a project with no database too: a registration
    /// there could never be booked.
    fn external_project(&self, wanted: &str) -> Result<String, ControlError> {
        let wanted = wanted.trim();
        match self.pm_target_of(Some(wanted)) {
            Ok(target) => Ok(target.path),
            Err(PmRefusal::NotInitialized { .. }) => {
                Err(super::supervised::unknown_project(wanted))
            }
            Err(refusal) => Err(super::supervised::pm_refusal(refusal, wanted)),
        }
    }

    /// A stopped key changes nothing, so a ticket deleted since cannot make a
    /// repeat of that registration fail.
    fn external_links(
        &self,
        dir: &Path,
        project: &str,
        params: &ExternalRegisterParams,
    ) -> Result<Links, ControlError> {
        let run_id = params.run_id.as_deref();
        let known_final = store::read(dir)
            .map_err(control_error)?
            .agents
            .iter()
            .any(|a| {
                a.external_id == params.external_id && a.run_id.as_deref() == run_id && !a.is_live()
            });
        if known_final {
            return Ok(Links::default());
        }
        resolve_links(Path::new(project), params)
            .map_err(|message| ControlError::new(ErrorCode::InvalidParams, message))
    }

    pub(super) fn external_register(
        &self,
        supervisor: &str,
        params: ExternalRegisterParams,
    ) -> Outcome {
        let dir = self.external_app_data()?;
        let now = now_ms();
        self.external_settle(&dir, now)?;
        let owner = self.external_owner(supervisor)?;
        let project = self.external_project(&params.project_path)?;
        let links = self.external_links(&dir, &project, &params)?;
        let (answer, touched) = store::update(&dir, now, |file| {
            let was_live = file.agents.iter().any(|agent| {
                agent.external_id == params.external_id
                    && agent.run_id == params.run_id
                    && agent.is_live()
            });
            let answer = apply_register(
                file,
                RegisterInput {
                    params: &params,
                    project_path: &project,
                    links,
                },
                &owner,
                now,
            )?;
            // A stopped key changes nothing; on a live one a sign of life moved
            // `lastSeenAt`.
            let touched = answer.created || was_live;
            Ok(((answer, touched), touched))
        })
        .map_err(control_error)?;
        // Also for a sign of life: a row reading "Stale?" reads the new time.
        if touched {
            self.backend.external_agents_changed();
        }
        let wants_token = answer.created || params.new_token == Some(true);
        let mut token = if wants_token && answer.agent.is_live() {
            Some(self.external_issue_token(&dir, &answer.agent, &params, now)?)
        } else {
            None
        };
        // A stop between the registration and the grant has revoked already;
        // a token issued after it would outlive its run.
        if token.is_some() && !self.external_current(&dir, &answer.agent)?.is_live() {
            revoke_tokens(&dir, &self.external_current(&dir, &answer.agent)?, now);
            token = None;
        }
        to_value(ExternalRegisterResult {
            agent: answer.agent.view(now),
            created: answer.created,
            changed: answer.changed,
            token,
        })
    }

    /// The registration already stands when this runs, so a failure says how
    /// to get a token without registering twice.
    fn external_issue_token(
        &self,
        dir: &Path,
        agent: &ExternalAgent,
        params: &ExternalRegisterParams,
        now: u64,
    ) -> Result<IssuedToken, ControlError> {
        let request = GrantRequest {
            kind: TOKEN_KIND,
            resource_id: &agent.id,
            actions: &[TOKEN_ACTION_STOP],
            owner_run_dir: &agent.owner_run_dir,
            ttl_seconds: params
                .token_ttl_seconds
                .unwrap_or(TOKEN_DEFAULT_TTL_SECONDS),
        };
        let issued = capability_tokens::issue(dir, request, now).map_err(|error| {
            let mut refusal = token_error(error);
            refusal.message = format!(
                "{} is registered, but no token was issued ({}); repeat the call with newToken: true",
                agent.id, refusal.message
            );
            refusal
        })?;
        Ok(IssuedToken {
            token: issued.token,
            kind: issued.grant.kind,
            resource_id: issued.grant.resource_id,
            actions: issued.grant.actions,
            expires_at: issued.grant.expires_at,
        })
    }

    pub(super) fn external_stop(&self, supervisor: &str, params: ExternalStopParams) -> Outcome {
        let owner = self.external_owner(supervisor)?;
        self.external_stop_by(&StopBy::Owner(&owner), &params)
    }

    /// `external_stop` for a token holder, whoever the socket says it is. The
    /// grant names the run; the model checks it against the key in `params`.
    pub(super) fn external_stop_with_token(&self, params: ExternalStopParams) -> Outcome {
        let dir = self.external_app_data()?;
        let token = params
            .token
            .as_ref()
            .ok_or_else(|| ControlError::new(ErrorCode::InvalidParams, "token is required"))?;
        let grant =
            capability_tokens::lookup(&dir, token.expose(), now_ms()).map_err(token_error)?;
        self.external_stop_by(&StopBy::Token(&grant), &params)
    }

    fn external_stop_by(&self, by: &StopBy<'_>, params: &ExternalStopParams) -> Outcome {
        let dir = self.external_app_data()?;
        let now = now_ms();
        self.external_settle(&dir, now)?;
        let answer = store::update(&dir, now, |file| {
            let answer = apply_stop(file, params, by, now)?;
            let touched = !answer.already_stopped || answer.corrected;
            Ok((answer, touched))
        })
        .map_err(control_error)?;
        revoke_tokens(&dir, &answer.agent, now);
        if !answer.already_stopped || answer.corrected {
            self.backend.external_agents_changed();
        }
        self.external_settle(&dir, now)?;
        // Read again: the pass above is what says whether the history took it.
        let agent = self.external_current(&dir, &answer.agent)?;
        to_value(ExternalStopResult {
            booked: agent.booked,
            agent: agent.view(now),
            already_stopped: answer.already_stopped,
        })
    }

    fn external_current(
        &self,
        dir: &Path,
        agent: &ExternalAgent,
    ) -> Result<ExternalAgent, ControlError> {
        store::read(dir)
            .map_err(control_error)?
            .agents
            .into_iter()
            .find(|entry| entry.id == agent.id)
            .ok_or_else(|| {
                let key = display_key(&agent.external_id, agent.run_id.as_deref());
                control_error(model::ExternalError::UnknownKey(key))
            })
    }

    pub(super) fn external_list(&self, supervisor: &str) -> Outcome {
        let dir = self.external_app_data()?;
        let now = now_ms();
        self.external_settle(&dir, now)?;
        let owner = self.external_owner(supervisor)?;
        let file = store::read(&dir).map_err(control_error)?;
        let agents = file
            .agents
            .iter()
            .filter(|agent| owner.holds(agent) && !agent.is_expired(now))
            .map(|agent| agent.view(now))
            .collect();
        to_value(ExternalListResult { agents })
    }
}
