//! IDE-owned stall detection. See docs/design-stall-watchdog.md for the
//! deliberately conservative process/output heuristics and configuration.
use super::protocol::SendInputParams;
use super::Dispatcher;
use crate::agents::awaiting_input::awaits_input;
use crate::agents::progress_output::STALL_NUDGE;
use crate::agents::{AgentInfo, AgentStatus};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StallMetrics {
    pub idle_for_ms: Option<u64>,
    pub stalled_since_ms: Option<u64>,
}

struct Watch {
    generation: u64,
    changed: Instant,
    metrics: StallMetrics,
    nudged: bool,
    warned: Option<Instant>,
    escalated: bool,
    pending: Option<String>,
    attempts: u8,
}

#[derive(Default)]
pub(super) struct Watchdog {
    entries: HashMap<String, Watch>,
}

pub(super) fn timeout() -> Duration {
    timeout_from_minutes(std::env::var("AURIC_AGENT_STALL_MINUTES").ok().as_deref())
}

fn timeout_from_minutes(value: Option<&str>) -> Duration {
    let minutes = value
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|minutes| (1..=10080).contains(minutes))
        .unwrap_or(15);
    Duration::from_secs(minutes * 60)
}

impl Dispatcher {
    pub(super) fn stall_metrics(&self, id: &str) -> StallMetrics {
        self.watchdog
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .get(id)
            .map(|w| w.metrics.clone())
            .unwrap_or_default()
    }

    /// The background pingback thread calls this independently of model turns.
    /// Injected monotonic and wall clocks make boundary tests instantaneous.
    pub(super) fn watchdog_tick_at(
        &self,
        now: Instant,
        epoch_ms: u64,
        timeout: Duration,
        busy: &HashSet<String>,
    ) {
        let agents = self.backend.agents();
        let mut watchdog = self.watchdog.lock().unwrap_or_else(|e| e.into_inner());
        watchdog
            .entries
            .retain(|id, _| agents.iter().any(|a| &a.id == id));
        for agent in &agents {
            let Some(parent) = agent.spawned_by_agent_id.as_deref() else {
                continue;
            };
            if agent.status != AgentStatus::Running || self.run_results.get(&agent.id).is_some() {
                watchdog.entries.remove(&agent.id);
                continue;
            }
            let generation = self.buffers.progress_generation(&agent.id);
            let watch = watchdog
                .entries
                .entry(agent.id.clone())
                .or_insert_with(|| Watch {
                    generation,
                    changed: now,
                    metrics: StallMetrics::default(),
                    nudged: false,
                    warned: None,
                    escalated: false,
                    pending: None,
                    attempts: 0,
                });
            let waiting = !agent.headless
                && self
                    .buffers
                    .read(&agent.id, 4096, None)
                    .is_some_and(|slice| awaits_input(&slice.text));
            if generation != watch.generation
                || busy.contains(&agent.id)
                || waiting
                || self.human_drafting(&agent.id)
            {
                watch.generation = generation;
                watch.changed = now;
                watch.warned = None;
                watch.escalated = false;
                watch.pending = None;
                watch.metrics.stalled_since_ms = None;
            }
            let idle = now.saturating_duration_since(watch.changed);
            watch.metrics.idle_for_ms = Some(idle.as_millis() as u64);
            if idle < timeout {
                continue;
            }
            watch.metrics.stalled_since_ms.get_or_insert(
                epoch_ms.saturating_sub(idle.saturating_sub(timeout).as_millis() as u64),
            );
            if watch.warned.is_none() {
                watch.warned = Some(now);
                let action = if agent.headless {
                    "headless: no input possible; read output and decide whether to stop, restart or ask the human".to_string()
                } else if !watch.nudged {
                    watch.nudged = true; // Reserve before IO: a failed write is never retried.
                    match self.send_input(SendInputParams {
                        agent_id: agent.id.clone(),
                        text: STALL_NUDGE.into(),
                        enter: true,
                    }) {
                        Ok(_) => "one status check sent; do not nudge again".into(),
                        Err(error) => format!(
                            "status check failed: {}; do not retry the nudge",
                            error.message
                        ),
                    }
                } else {
                    "already nudged in this run; read output and decide; do not nudge again".into()
                };
                watch.pending = Some(format!("[AuricIDE] Stalled: {} ({}). {action}. This notice comes from the IDE, not from the human.", agent.id, agent.name));
                watch.attempts = 0;
            } else if !watch.escalated
                && watch
                    .warned
                    .is_some_and(|warned| now.saturating_duration_since(warned) >= timeout)
            {
                watch.escalated = true;
                let text = format!("[AuricIDE] Stall escalated: {} ({}) is still unchanged after another inactivity interval. Read its output and decide with the human; do not nudge again.", agent.id, agent.name);
                self.stall_notify(agent, &text);
                watch.pending = Some(text);
                watch.attempts = 0;
            }
            if !self.human_drafting(parent) {
                if let Some(text) = watch.pending.as_deref() {
                    if self.ping_supervisor_text(parent, text) {
                        watch.pending = None;
                    } else {
                        watch.attempts += 1;
                        if watch.attempts >= 3 {
                            if !watch.escalated {
                                self.stall_notify(
                                    agent,
                                    &format!("Supervisor pingback failed after 3 attempts. {text}"),
                                );
                            }
                            watch.pending = None;
                        }
                    }
                }
            }
        }
    }

    fn stall_notify(&self, agent: &AgentInfo, text: &str) {
        self.backend
            .notify(crate::notifications::NotificationInput {
                uid: None,
                project_path: agent.project_path.clone(),
                project_name: None,
                source: "agent".into(),
                origin: Some("stall-watchdog".into()),
                kind: Some("info".into()),
                severity: Some("warning".into()),
                title: format!("Agent stalled: {}", agent.name),
                body: Some(text.into()),
                actions: None,
                dedupe_key: Some(format!("stall-watchdog:{}", agent.id)),
                ref_kind: Some("agent".into()),
                ref_id: Some(agent.id.clone()),
                expires_at: None,
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watchdog_configuration_defaults_and_validates_minutes() {
        for value in [
            None,
            Some(""),
            Some("0"),
            Some("-1"),
            Some("NaN"),
            Some("10081"),
        ] {
            assert_eq!(timeout_from_minutes(value), Duration::from_secs(900));
        }
        assert_eq!(timeout_from_minutes(Some("2")), Duration::from_secs(120));
    }
}
