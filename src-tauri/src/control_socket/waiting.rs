//! `mark_waiting` / `clear_waiting`: a supervisor parks one of its running
//! agents on purpose (an interactive agent waiting for a deploy or a human), so
//! the stall watchdog stops nudging and repeating notices for it. The contract
//! is `docs/design-agent-control.md`, "Waiting on purpose".
//!
//! A mark ends by itself at `until`, when the agent prints new output, when it
//! raises a question or shows a prompt, and when it finishes or disappears;
//! normal stall detection then starts a fresh inactivity window.

use super::protocol::*;
use super::stall_watchdog::StallMetrics;
use super::{to_value, Dispatcher, Outcome};
use crate::agent_waiting::{self, WaitingMark, WaitingMarks};
use crate::agents::{AgentInfo, AgentStatus};
use std::sync::MutexGuard;

pub(super) fn supervisors_only() -> ControlError {
    ControlError::new(
        ErrorCode::OutsideSupervisorScope,
        "mark_waiting and clear_waiting are for supervisors: a mark belongs to the supervisor that parked its own agent",
    )
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

impl Dispatcher {
    pub(super) fn marks(&self) -> MutexGuard<'_, WaitingMarks> {
        let mut marks = self.waiting.lock().unwrap_or_else(|e| e.into_inner());
        marks.ensure_loaded(self.backend.app_data_dir().as_deref(), now_ms());
        marks
    }

    /// Saves and announces a change made through `marks`.
    fn marks_changed(&self, marks: &WaitingMarks) {
        marks.persist(self.backend.app_data_dir().as_deref());
        self.backend.waiting_changed();
    }

    pub(super) fn mark_waiting(&self, supervisor: &str, params: MarkWaitingParams) -> Outcome {
        self.ensure_child(supervisor, &params.agent_id)?;
        let running = self
            .find_agent(&params.agent_id)
            .is_some_and(|agent| agent.status == AgentStatus::Running)
            && self.run_results.get(&params.agent_id).is_none();
        if !running {
            return Err(ControlError::new(
                ErrorCode::InvalidParams,
                format!(
                    "{} is not running; only a running agent can be marked as waiting",
                    params.agent_id
                ),
            ));
        }
        let reason = agent_waiting::check_reason(&params.reason)
            .map_err(|message| ControlError::new(ErrorCode::InvalidParams, message))?;
        let now = now_ms();
        let until_ms = agent_waiting::resolve_until(params.until.as_deref(), now)
            .map_err(|message| ControlError::new(ErrorCode::InvalidParams, message))?;
        let mark = WaitingMark {
            agent_id: params.agent_id.clone(),
            supervisor_id: supervisor.to_string(),
            reason,
            until_ms,
            marked_at_ms: now,
            baseline_generation: Some(self.buffers.progress_generation(&params.agent_id)),
            baseline_questions: Some(self.questions.count(&params.agent_id)),
        };
        let result = MarkWaitingResult {
            agent_id: mark.agent_id.clone(),
            reason: mark.reason.clone(),
            until: mark.until_iso(),
        };
        let mut marks = self.marks();
        marks.set(mark);
        self.marks_changed(&marks);
        to_value(result)
    }

    pub(super) fn clear_waiting(&self, supervisor: &str, params: AgentIdParams) -> Outcome {
        self.ensure_child(supervisor, &params.agent_id)?;
        let mut marks = self.marks();
        let cleared = marks.remove(&params.agent_id);
        if cleared {
            self.marks_changed(&marks);
        }
        to_value(ClearWaitingResult {
            agent_id: params.agent_id,
            cleared,
        })
    }

    /// `metrics` with the agent's mark on it, for `list_agents`.
    pub(super) fn waiting_view(&self, agent_id: &str, mut metrics: StallMetrics) -> StallMetrics {
        let marks = self.marks();
        if let Some(mark) = marks.get(agent_id).filter(|mark| mark.until_ms > now_ms()) {
            metrics.waiting_reason = Some(mark.reason.clone());
            metrics.waiting_until = Some(mark.until_iso());
        }
        metrics
    }

    /// Drops the marks of agents that are gone, finished or no longer running.
    pub(super) fn waiting_prune(&self, agents: &[AgentInfo]) {
        let mut marks = self.marks();
        let changed = marks.retain(|mark| {
            agents.iter().any(|agent| {
                agent.id == mark.agent_id
                    && agent.status == AgentStatus::Running
                    && self.run_results.get(&agent.id).is_none()
            })
        });
        if changed {
            self.marks_changed(&marks);
        }
    }

    /// Whether the watchdog must leave `agent_id` alone this tick. A mark that
    /// has run out, or whose agent printed, asked or showed a prompt since, is
    /// removed here and the answer is `false`.
    pub(super) fn waiting_holds(
        &self,
        agent_id: &str,
        generation: u64,
        shows_prompt: bool,
        epoch_ms: u64,
    ) -> bool {
        let mut marks = self.marks();
        let questions = self.questions.count(agent_id);
        let Some(mark) = marks.get_mut(agent_id) else {
            return false;
        };
        let ended = epoch_ms >= mark.until_ms
            || shows_prompt
            || questions > *mark.baseline_questions.get_or_insert(questions)
            || generation != *mark.baseline_generation.get_or_insert(generation);
        if ended {
            marks.remove(agent_id);
            self.marks_changed(&marks);
        }
        !ended
    }
}
