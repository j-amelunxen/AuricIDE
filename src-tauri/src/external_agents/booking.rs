//! One finished run leaves what any run leaves: a row in `pm_agent_usage` and,
//! when the task log is on, a line in `tasks-YYYY-MM.jsonl`.
//!
//! The entry is made final first and marked booked last, so a crash or a locked
//! database in between leaves an entry the next call books. The row id comes
//! from the entry and the insert ignores a row that exists, so that retry
//! cannot book twice.

use super::model::{ExternalAgent, ExternalError, ExternalState, CLOSED_BY_HUMAN};
use super::store;
use crate::agent_usage::record::{CostSource, MatchKind, Outcome, RunKind, RunSource, UsageRecord};
use crate::agent_usage::store as usage_store;
use crate::task_log::{self, TaskLogEntry};
use chrono::{DateTime, SecondsFormat, Utc};
use std::path::Path;
use std::sync::Mutex;

/// One pass at a time, or two calls could both find an entry unbooked and each
/// append a task log line for it.
static BOOKING: Mutex<()> = Mutex::new(());

fn at(ms: u64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(ms as i64).unwrap_or_default()
}

fn rfc3339(ms: u64) -> String {
    at(ms).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn outcome(agent: &ExternalAgent) -> Outcome {
    if agent.closed_by.as_deref() == Some(CLOSED_BY_HUMAN) {
        Outcome::Killed
    } else if agent.state == ExternalState::Failed {
        Outcome::Error
    } else {
        Outcome::Success
    }
}

fn finished_at(agent: &ExternalAgent) -> u64 {
    agent.finished_at.unwrap_or(agent.last_seen_at)
}

fn cost_source(agent: &ExternalAgent) -> CostSource {
    if agent.report.as_ref().is_some_and(|r| r.has_figures()) {
        CostSource::Reported
    } else {
        CostSource::None
    }
}

/// The `pm_agent_usage` row. Absent tokens are 0 because those columns cannot
/// be empty; `cost_source` and the task log line keep "nothing came" apart.
fn usage_row(agent: &ExternalAgent) -> UsageRecord {
    let finished = finished_at(agent);
    let report = agent.report.clone().unwrap_or_default();
    UsageRecord {
        id: format!("external-{}", agent.id),
        agent_id: agent.id.clone(),
        ticket_id: agent.ticket_id.clone(),
        goal_id: agent.goal_id.clone(),
        run_kind: RunKind::resolve(
            None,
            None,
            agent.ticket_id.as_deref(),
            agent.goal_id.as_deref(),
        ),
        run_source: RunSource::External,
        provider: agent.provider.clone(),
        model: agent.model.clone(),
        headless: true,
        session_id: None,
        ticket_status_at_start: None,
        started_at: rfc3339(agent.registered_at),
        finished_at: rfc3339(finished),
        duration_ms: finished.saturating_sub(agent.registered_at) as i64,
        outcome: outcome(agent),
        input_tokens: report.input_tokens.unwrap_or(0),
        output_tokens: report.output_tokens.unwrap_or(0),
        cache_read_tokens: report.cache_read_tokens.unwrap_or(0),
        cache_write_tokens: report.cache_write_tokens.unwrap_or(0),
        reasoning_tokens: 0,
        cost_usd: report.cost_usd,
        cost_source: cost_source(agent),
        match_kind: MatchKind::Exact,
        estimate_cost_usd: None,
        estimate_input_tokens: None,
        estimate_output_tokens: None,
        estimate_cache_read_tokens: None,
        estimate_cache_write_tokens: None,
        unpriced_models: None,
        model_usage_json: None,
        num_turns: None,
        active_ms: report.active_ms.map(|ms| ms as i64),
        on_ms: Some(agent.on_ms(finished) as i64),
        agent_runs: report.agent_runs.map(|runs| runs as i64),
        runtime_partial: report.partial,
        external_id: Some(agent.external_id.clone()),
        external_run_id: agent.run_id.clone(),
        closed_by: agent.closed_by.clone(),
    }
}

/// The task log line. `activeMs` is left out when unknown, never 0.
fn task_line(agent: &ExternalAgent) -> TaskLogEntry {
    let finished = finished_at(agent);
    let report = agent.report.clone().unwrap_or_default();
    TaskLogEntry {
        title: agent.name.clone(),
        agent_id: agent.id.clone(),
        name: agent.name.clone(),
        role: crate::agents::AgentRole::Worker,
        provider: agent.provider.clone(),
        model: agent.model.clone().unwrap_or_default(),
        status: outcome(agent),
        started_at: rfc3339(agent.registered_at),
        finished_at: rfc3339(finished),
        duration_ms: finished.saturating_sub(agent.registered_at) as i64,
        project_path: Some(agent.project_path.clone()),
        cwd: None,
        spawned_by_agent_id: agent.owner_agent_id.clone(),
        ticket_id: agent.ticket_id.clone(),
        goal_id: agent.goal_id.clone(),
        cost_usd: report.cost_usd,
        input_tokens: report.input_tokens,
        output_tokens: report.output_tokens,
        source: Some("external".to_string()),
        external_id: Some(agent.external_id.clone()),
        run_id: agent.run_id.clone(),
        on_ms: Some(agent.on_ms(finished)),
        active_ms: report.active_ms,
        runtime_partial: report.partial,
        agent_runs: report.agent_runs,
        closed_by: agent.closed_by.clone(),
        cost_source: Some(cost_source(agent)),
        cache_read_tokens: report.cache_read_tokens,
        cache_write_tokens: report.cache_write_tokens,
        end_reason: agent
            .end_reason
            .and_then(|reason| serde_json::to_value(reason).ok())
            .and_then(|value| value.as_str().map(str::to_string)),
        corrected: agent
            .corrections
            .iter()
            .any(|correction| correction.was_booked)
            .then_some(true),
    }
}

/// `Ok(Some(row))` when this attempt added the row, `Ok(None)` when an earlier
/// attempt had. A project without a database has nowhere to book yet: that is
/// an error here, so the figures stay in the entry until it can.
fn write_history(app_data: &Path, agent: &ExternalAgent) -> Result<Option<UsageRecord>, String> {
    let project = Path::new(&agent.project_path);
    let conn = usage_store::open_existing(project)?
        .ok_or_else(|| format!("{} has no project database", agent.project_path))?;
    let row = usage_row(agent);
    // A corrected entry replaces its row; anything else is booked once.
    let added = if agent.corrections.is_empty() {
        usage_store::insert_or_ignore(&conn, &row)?
    } else {
        usage_store::insert_or_replace(&conn, &row)?
    };
    task_log::record_external_task_in(app_data, &task_line(agent), at(finished_at(agent)))?;
    Ok(added.then_some(row))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Booked {
    pub project_path: String,
    pub row: UsageRecord,
}

/// Books every final entry not booked yet. Answers the rows it added and
/// whether it marked any entry, and leaves what failed for the next call.
pub fn settle(app_data: &Path, now: u64) -> Result<(Vec<Booked>, bool), ExternalError> {
    let _one_pass = BOOKING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let pending: Vec<ExternalAgent> = store::read(app_data)?
        .agents
        .into_iter()
        .filter(|agent| !agent.is_live() && !agent.booked)
        .collect();
    let mut added = Vec::new();
    let mut marked = false;
    for agent in pending {
        match write_history(app_data, &agent) {
            Ok(row) => {
                store::update(app_data, now, |file| {
                    let entry = file.agents.iter_mut().find(|entry| entry.id == agent.id);
                    let found = entry.is_some();
                    if let Some(entry) = entry {
                        entry.booked = true;
                    }
                    Ok(((), found))
                })?;
                marked = true;
                if let Some(row) = row {
                    added.push(Booked {
                        project_path: agent.project_path.clone(),
                        row,
                    });
                }
            }
            Err(error) => eprintln!("External agents: could not book {}: {error}", agent.id),
        }
    }
    Ok((added, marked))
}
