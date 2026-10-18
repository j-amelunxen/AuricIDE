//! Tells a supervisor that its children finished (`docs/design-agent-control.md`,
//! "Pingback"; machine-checkable half: `callerScope.callers.supervisor.pingback`
//! and the `pingback*` limits in `agentControl.fixtures.json`).
//!
//! A supervisor is an interactive CLI that only acts on input. `await_result`
//! wakes it while it waits on one child, but once it has handed its turn back
//! to the human, nothing told it that a child ended: it learned of it only
//! when asked, and then, finding the agents gone from the live list, guessed
//! the IDE had restarted. So Rust types one notice into its console, the same
//! way `send_input` types into a child.
//!
//! Finishes come in waves (a fan-out of headless children ends within
//! seconds), and every notice is a turn the supervisor takes, so they are
//! batched per supervisor: one notice once its wave has been quiet for
//! `PINGBACK_QUIET`, or `PINGBACK_MAX_DELAY` after its first finish. Either
//! way it waits while the human has a draft in that console
//! (`agents/human_draft.rs`), or the notice would join the draft.

use super::Dispatcher;
use crate::agents::run_results::FinishedChild;
use crate::agents::{AgentRole, AgentStatus};
use std::collections::BTreeMap;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// `limits.pingbackQuietMs`.
pub const PINGBACK_QUIET: Duration = Duration::from_millis(3_000);
/// `limits.pingbackMaxDelayMs`.
pub const PINGBACK_MAX_DELAY: Duration = Duration::from_millis(15_000);
/// How often waiting waves are looked at again.
const TICK: Duration = Duration::from_millis(250);

/// Starts the thread that delivers notices for the app's lifetime. Runs
/// whether or not the socket could be bound: a supervisor's children are
/// this app's agents either way.
pub fn start(dispatcher: Arc<Dispatcher>) {
    let finished = dispatcher.run_results.subscribe();
    std::thread::spawn(move || {
        let mut waves = Waves::new(PINGBACK_QUIET, PINGBACK_MAX_DELAY);
        let mut checked = Instant::now();
        let stall_timeout = super::stall_watchdog::timeout();
        loop {
            match finished.recv_timeout(TICK) {
                Ok(child) => waves.add(child, Instant::now()),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) if waves.is_empty() => return,
                Err(RecvTimeoutError::Disconnected) => std::thread::sleep(TICK),
            }
            if checked.elapsed() >= Duration::from_secs(5) {
                checked = Instant::now();
                let watched: std::collections::HashSet<_> = dispatcher
                    .backend
                    .agents()
                    .into_iter()
                    .filter(|a| {
                        a.status == AgentStatus::Running
                            && a.spawned_by_agent_id.is_some()
                            && dispatcher.run_results.get(&a.id).is_none()
                    })
                    .map(|a| a.id)
                    .collect();
                let roots = dispatcher.backend.agent_pids();
                // Keep other agent roots as ancestry boundaries, but skip all
                // process inspection when no supervised child is running.
                let busy = if roots.values().any(|(id, _)| watched.contains(id)) {
                    // Include all roots: nested supervisors must never lend
                    // their child's activity to the outer agent.
                    super::process_activity::busy_agents(&roots)
                } else {
                    Default::default()
                };
                dispatcher.watchdog_tick_at(
                    Instant::now(),
                    crate::supervisor_link::jobs::now_ms(),
                    stall_timeout,
                    &busy,
                );
            }
            let due = waves.take_due(Instant::now(), |id| dispatcher.human_drafting(id));
            for (supervisor_id, children) in due {
                dispatcher.ping_supervisor(&supervisor_id, &children);
            }
        }
    });
}

struct Wave {
    children: Vec<FinishedChild>,
    first: Instant,
    last: Instant,
}

/// The finishes not yet told, per supervisor.
pub(crate) struct Waves {
    by_supervisor: BTreeMap<String, Wave>,
    quiet: Duration,
    max_delay: Duration,
}

impl Waves {
    pub(crate) fn new(quiet: Duration, max_delay: Duration) -> Self {
        Self {
            by_supervisor: BTreeMap::new(),
            quiet,
            max_delay,
        }
    }

    pub(crate) fn add(&mut self, child: FinishedChild, now: Instant) {
        let wave = self
            .by_supervisor
            .entry(child.supervisor_id.clone())
            .or_insert_with(|| Wave {
                children: Vec::new(),
                first: now,
                last: now,
            });
        wave.last = now;
        wave.children.push(child);
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.by_supervisor.is_empty()
    }

    /// The waves to tell now: quiet or overdue, and their supervisor not
    /// drafting. The rest stay.
    pub(crate) fn take_due(
        &mut self,
        now: Instant,
        drafting: impl Fn(&str) -> bool,
    ) -> Vec<(String, Vec<FinishedChild>)> {
        let due: Vec<String> = self
            .by_supervisor
            .iter()
            .filter(|(_, wave)| {
                now.saturating_duration_since(wave.last) >= self.quiet
                    || now.saturating_duration_since(wave.first) >= self.max_delay
            })
            .map(|(id, _)| id.clone())
            .filter(|id| !drafting(id))
            .collect();
        due.into_iter()
            .filter_map(|id| {
                let wave = self.by_supervisor.remove(&id)?;
                Some((id, wave.children))
            })
            .collect()
    }
}

/// The notice one supervisor gets for its finished children.
pub(crate) fn notice(children: &[FinishedChild]) -> String {
    let listed: Vec<String> = children
        .iter()
        .map(|child| {
            let status = match child.result.status {
                AgentStatus::Error => "error",
                _ => "idle",
            };
            format!("{} \"{}\" ({status})", child.agent.id, child.agent.name)
        })
        .collect();
    format!(
        "[AuricIDE] Finished: {}. Read each result with await_agent_result, remove its \
         worktree with remove_worktree if it ran in one, then clear it with dismiss_agent. \
         This notice comes from the IDE, not from the human.",
        listed.join(", ")
    )
}

impl Dispatcher {
    /// Whether the human is halfway through a message to `agent_id`.
    pub(crate) fn human_drafting(&self, agent_id: &str) -> bool {
        self.backend.human_drafting(agent_id)
    }

    /// Types the notice into the supervisor's console. A supervisor that is
    /// gone, finished, queued or headless gets none; its children stay in its
    /// `list_agents` for whoever asks. `true` when it was told.
    pub(crate) fn ping_supervisor(&self, supervisor_id: &str, children: &[FinishedChild]) -> bool {
        if children.is_empty() {
            return false;
        }
        self.ping_supervisor_text(supervisor_id, &notice(children))
    }

    pub(crate) fn ping_supervisor_text(&self, supervisor_id: &str, text: &str) -> bool {
        let listening = self.find_agent(supervisor_id).is_some_and(|agent| {
            agent.role == AgentRole::Supervisor
                && agent.status == AgentStatus::Running
                && !agent.headless
        });
        if !listening || self.human_drafting(supervisor_id) {
            return false;
        }
        let data = crate::agents::terminal_input::compose_message(
            text,
            true,
            self.buffers.bracketed_paste(supervisor_id),
        );
        match self.backend.write_input(supervisor_id, &data) {
            Ok(()) => true,
            Err(error) => {
                eprintln!("Pingback to {supervisor_id} failed: {error}");
                false
            }
        }
    }
}
