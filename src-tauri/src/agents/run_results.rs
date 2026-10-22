//! What a finished agent left behind, for `await_result` on the control
//! socket (`docs/design-agent-control.md`, "await_result").
//!
//! A bounded list of the last `RUN_RESULTS_KEPT` results plus a condvar, so a
//! caller can wait for a run to end without polling. Filled in `manager.rs`
//! where a run's exit (or kill) is known. Each result remembers the supervisor
//! that started the agent, so a supervisor's children stay readable after the
//! supervisor itself ended, until its card is cleared
//! (`agent_run_results_forget`), and the agent as it was listed, so the
//! supervisor's `list_agents` still shows it. A supervisor's finished child is
//! also handed to every subscriber, which is how the supervisor hears of it
//! (`control_socket/pingback.rs`).

use super::types::{AgentInfo, AgentRole, AgentStatus};
use crate::agent_usage::claude::CliResult;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Condvar, Mutex, MutexGuard};
use std::time::Instant;

/// How many finished runs are kept (`limits.runResultsKept`).
pub const RUN_RESULTS_KEPT: usize = 200;
/// How much of the console a result carries when the CLI stated no answer
/// (`limits.consoleTailAnswerBytes`).
pub const CONSOLE_TAIL_ANSWER_BYTES: u64 = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunResultSource {
    /// The CLI's own result object (headless Claude).
    CliResult,
    /// The end of the cleaned console.
    ConsoleTail,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub agent_id: String,
    /// `idle` or `error`, never a live status.
    pub status: AgentStatus,
    /// `None` for a kill: the process was ended, it did not exit.
    pub exit_code: Option<i32>,
    pub answer: Option<String>,
    pub is_error: bool,
    pub source: RunResultSource,
    pub finished_at: u64,
    pub cost_usd: Option<f64>,
}

impl RunResult {
    /// The result of a run that ended with `status`. The CLI's answer wins
    /// where there is one; otherwise `console_tail` is asked for the end of
    /// the console, and a blank one is no answer.
    pub fn from_finish(
        agent_id: &str,
        status: AgentStatus,
        exit_code: Option<i32>,
        cli_result: Option<&CliResult>,
        console_tail: impl FnOnce() -> Option<String>,
        finished_at: u64,
    ) -> Self {
        let failed = status == AgentStatus::Error;
        match cli_result {
            Some(cli) => Self {
                agent_id: agent_id.to_string(),
                status,
                exit_code,
                answer: Some(cli.answer.clone()),
                is_error: cli.is_error || failed,
                source: RunResultSource::CliResult,
                finished_at,
                cost_usd: cli.cost_usd(),
            },
            None => Self {
                agent_id: agent_id.to_string(),
                status,
                exit_code,
                answer: console_tail().filter(|text| !text.trim().is_empty()),
                is_error: failed,
                source: RunResultSource::ConsoleTail,
                finished_at,
                cost_usd: None,
            },
        }
    }
}

struct Entry {
    result: RunResult,
    /// The supervisor that started the agent, if one did.
    parent: Option<String>,
    /// The agent as the manager listed it while it ran; `None` where the
    /// recorder had no listing at hand.
    agent: Option<AgentInfo>,
}

/// A finished agent a supervisor started, as handed to subscribers.
#[derive(Debug, Clone)]
pub struct FinishedChild {
    pub supervisor_id: String,
    pub agent: AgentInfo,
    pub result: RunResult,
}

pub struct RunResults {
    entries: Mutex<VecDeque<Entry>>,
    changed: Condvar,
    capacity: usize,
    subscribers: Mutex<Vec<mpsc::Sender<FinishedChild>>>,
    session_end_subscribers: Mutex<Vec<mpsc::Sender<AgentInfo>>>,
}

impl Default for RunResults {
    fn default() -> Self {
        Self::with_capacity(RUN_RESULTS_KEPT)
    }
}

pub type RunResultsState = Arc<RunResults>;

pub fn new_run_results_state() -> RunResultsState {
    Arc::new(RunResults::default())
}

impl RunResults {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
            changed: Condvar::new(),
            capacity: capacity.max(1),
            subscribers: Mutex::new(Vec::new()),
            session_end_subscribers: Mutex::new(Vec::new()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, VecDeque<Entry>> {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A result without the agent's listing, as tests book one.
    #[cfg(test)]
    pub fn record(&self, result: RunResult, parent: Option<String>) {
        self.insert(Entry {
            result,
            parent,
            agent: None,
        });
    }

    /// Books a run the manager listed: keeps the listing beside the result
    /// and, for a supervisor's child, tells every subscriber.
    pub fn record_finished(&self, result: RunResult, agent: AgentInfo) {
        let parent = agent.spawned_by_agent_id.clone();
        let session_end = (agent.role == AgentRole::Supervisor).then(|| agent.clone());
        let child = parent.clone().map(|supervisor_id| FinishedChild {
            supervisor_id,
            agent: agent.clone(),
            result: result.clone(),
        });
        let inserted = self.insert(Entry {
            result,
            parent,
            agent: Some(agent),
        });
        if let (true, Some(ended)) = (inserted, session_end) {
            self.session_end_subscribers
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|subscriber| subscriber.send(ended.clone()).is_ok());
        }
        if let (true, Some(child)) = (inserted, child) {
            self.subscribers
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|subscriber| subscriber.send(child.clone()).is_ok());
        }
    }

    /// Keeps the first result recorded for an agent: a kill books its verdict
    /// before the output pump notices the process is gone, and that verdict
    /// stands. Wakes every waiter. `false` when the agent already had one.
    fn insert(&self, entry: Entry) -> bool {
        let mut entries = self.lock();
        if entries
            .iter()
            .any(|kept| kept.result.agent_id == entry.result.agent_id)
        {
            return false;
        }
        entries.push_back(entry);
        while entries.len() > self.capacity {
            entries.pop_front();
        }
        drop(entries);
        self.changed.notify_all();
        true
    }

    /// Every supervisor's child that finishes from now on.
    pub fn subscribe(&self) -> mpsc::Receiver<FinishedChild> {
        let (sender, receiver) = mpsc::channel();
        self.subscribers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(sender);
        receiver
    }

    /// Every supervisor session that ends from now on, with the agent as it
    /// was listed. Where a Project Manager's memory is checked.
    pub fn subscribe_session_ends(&self) -> mpsc::Receiver<AgentInfo> {
        let (sender, receiver) = mpsc::channel();
        self.session_end_subscribers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(sender);
        receiver
    }

    /// The finished agents `supervisor_id` started whose result is still
    /// kept, newest first, each listed with the status it ended in.
    pub fn finished_children_of(&self, supervisor_id: &str) -> Vec<AgentInfo> {
        self.lock()
            .iter()
            .rev()
            .filter(|entry| entry.parent.as_deref() == Some(supervisor_id))
            .filter_map(|entry| {
                let mut agent = entry.agent.clone()?;
                agent.status = entry.result.status.clone();
                Some(agent)
            })
            .collect()
    }

    /// Every finished agent whose result is kept with its listing, newest
    /// first, each with the status it ended in.
    pub fn finished_agents(&self) -> Vec<AgentInfo> {
        self.lock()
            .iter()
            .rev()
            .filter_map(|entry| {
                let mut agent = entry.agent.clone()?;
                agent.status = entry.result.status.clone();
                Some(agent)
            })
            .collect()
    }

    /// A resumed supervisor takes over the kept results of the children its
    /// run's earlier supervisors started. Returns how many moved.
    pub fn adopt_children(&self, adoption: &crate::supervisor::several::Adoption) -> usize {
        let mut moved = 0;
        for entry in self.lock().iter_mut() {
            if adoption.apply(&mut entry.parent) {
                moved += 1;
            }
            if let Some(agent) = entry.agent.as_mut() {
                adoption.apply(&mut agent.spawned_by_agent_id);
            }
        }
        moved
    }

    /// Lets go of one agent's result. `false` when none was kept.
    pub fn forget(&self, agent_id: &str) -> bool {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|entry| entry.result.agent_id != agent_id);
        before != entries.len()
    }

    pub fn get(&self, agent_id: &str) -> Option<RunResult> {
        self.lock()
            .iter()
            .find(|entry| entry.result.agent_id == agent_id)
            .map(|entry| entry.result.clone())
    }

    /// The supervisor that started a finished agent.
    pub fn parent_of(&self, agent_id: &str) -> Option<String> {
        self.lock()
            .iter()
            .find(|entry| entry.result.agent_id == agent_id)
            .and_then(|entry| entry.parent.clone())
    }

    /// The agent's result as soon as there is one, or `None` once `deadline`
    /// passes. Holds no lock while it sleeps.
    pub fn wait_for(&self, agent_id: &str, deadline: Instant) -> Option<RunResult> {
        let mut entries = self.lock();
        loop {
            if let Some(entry) = entries.iter().find(|e| e.result.agent_id == agent_id) {
                return Some(entry.result.clone());
            }
            let left = deadline.checked_duration_since(Instant::now())?;
            entries = self
                .changed
                .wait_timeout(entries, left)
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .0;
        }
    }

    /// Lets go of the results of every agent `supervisor_id` started. Called
    /// when the supervisor's card is cleared; until then they stay readable,
    /// even after the supervisor ended.
    pub fn forget_children_of(&self, supervisor_id: &str) -> usize {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|entry| entry.parent.as_deref() != Some(supervisor_id));
        before - entries.len()
    }
}

/// The frontend clears a supervisor's card: its children's results go with it.
#[tauri::command]
pub fn agent_run_results_forget(
    supervisor_id: String,
    results: tauri::State<'_, RunResultsState>,
) -> usize {
    results.forget_children_of(&supervisor_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn result(id: &str) -> RunResult {
        RunResult::from_finish(
            id,
            AgentStatus::Idle,
            Some(0),
            None,
            || Some("done\n".into()),
            1,
        )
    }

    #[test]
    fn limits_match_the_contract() {
        let fixtures: serde_json::Value =
            serde_json::from_str(crate::control_socket::protocol::tests::FIXTURES).unwrap();
        let limits = &fixtures["limits"];
        assert_eq!(limits["runResultsKept"], RUN_RESULTS_KEPT);
        assert_eq!(limits["consoleTailAnswerBytes"], CONSOLE_TAIL_ANSWER_BYTES);
        let sources: Vec<serde_json::Value> =
            [RunResultSource::CliResult, RunResultSource::ConsoleTail]
                .iter()
                .map(|source| serde_json::to_value(source).unwrap())
                .collect();
        assert_eq!(
            serde_json::Value::Array(sources),
            fixtures["runResultSources"]
        );
    }

    #[test]
    fn the_cli_answer_wins_over_the_console() {
        let line = include_str!("../agent_usage/fixtures/claude-result.json");
        let cli = crate::agent_usage::claude::parse_result(line.trim()).unwrap();
        let from_cli = RunResult::from_finish(
            "agent-5",
            AgentStatus::Idle,
            Some(0),
            Some(&cli),
            || panic!("the console is not read when the CLI answered"),
            7,
        );
        assert_eq!(from_cli.source, RunResultSource::CliResult);
        assert_eq!(from_cli.answer.as_deref(), Some(cli.answer.as_str()));
        assert_eq!(from_cli.cost_usd, cli.cost_usd());
        assert!(!from_cli.is_error);
    }

    #[test]
    fn without_a_cli_answer_the_console_tail_is_the_answer_and_blank_is_none() {
        let failed = RunResult::from_finish(
            "agent-6",
            AgentStatus::Error,
            Some(1),
            None,
            || Some("Error: could not reach the model".into()),
            9,
        );
        assert_eq!(failed.source, RunResultSource::ConsoleTail);
        assert!(failed.is_error);
        assert_eq!(failed.cost_usd, None);
        let blank = RunResult::from_finish(
            "a",
            AgentStatus::Idle,
            None,
            None,
            || Some("  \n".into()),
            9,
        );
        assert_eq!(blank.answer, None);
    }

    #[test]
    fn the_first_result_stands_and_the_oldest_falls_out_past_the_cap() {
        let results = RunResults::with_capacity(2);
        results.record(result("a"), None);
        let mut second = result("a");
        second.status = AgentStatus::Error;
        results.record(second, None);
        assert_eq!(results.get("a").unwrap().status, AgentStatus::Idle);

        results.record(result("b"), None);
        results.record(result("c"), None);
        assert!(results.get("a").is_none(), "evicted");
        assert!(results.get("b").is_some() && results.get("c").is_some());
    }

    #[test]
    fn a_waiter_wakes_when_the_result_lands_and_times_out_otherwise() {
        let results = Arc::new(RunResults::default());
        let started = Instant::now();
        assert!(results
            .wait_for("x", started + Duration::from_millis(30))
            .is_none());
        assert!(started.elapsed() >= Duration::from_millis(30));

        let writer = results.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            writer.record(result("x"), None);
        });
        let started = Instant::now();
        let got = results.wait_for("x", started + Duration::from_secs(10));
        handle.join().unwrap();
        assert!(got.is_some());
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "woken, not timed out"
        );
    }

    #[test]
    fn a_supervisors_children_are_forgotten_together_and_others_stay() {
        let results = RunResults::default();
        results.record(result("c1"), Some("sup".into()));
        results.record(result("c2"), Some("sup".into()));
        results.record(result("other"), Some("sup-2".into()));
        results.record(result("plain"), None);
        assert_eq!(results.parent_of("c1").as_deref(), Some("sup"));
        assert_eq!(results.forget_children_of("sup"), 2);
        assert!(results.get("c1").is_none());
        assert!(results.get("other").is_some() && results.get("plain").is_some());
    }

    fn child(id: &str, parent: Option<&str>) -> AgentInfo {
        let mut agent = crate::control_socket::protocol::tests::sample_agent();
        agent.id = id.into();
        agent.spawned_by_agent_id = parent.map(Into::into);
        agent
    }

    #[test]
    fn a_finished_child_is_listed_with_its_end_status_newest_first() {
        let results = RunResults::default();
        results.record_finished(result("c1"), child("c1", Some("sup")));
        let mut failed = result("c2");
        failed.status = AgentStatus::Error;
        results.record_finished(failed, child("c2", Some("sup")));
        results.record_finished(result("other"), child("other", Some("sup-2")));
        results.record(result("unlisted"), Some("sup".into()));
        let listed: Vec<(String, AgentStatus)> = results
            .finished_children_of("sup")
            .into_iter()
            .map(|agent| (agent.id, agent.status))
            .collect();
        assert_eq!(
            listed,
            vec![
                ("c2".to_string(), AgentStatus::Error),
                ("c1".to_string(), AgentStatus::Idle)
            ]
        );
        assert!(results.forget("c1"));
        assert!(!results.forget("c1"));
        assert_eq!(results.finished_children_of("sup").len(), 1);
    }

    #[test]
    fn a_resumed_supervisor_takes_over_the_kept_results_of_its_run() {
        let results = RunResults::default();
        let mut old = child("sup-old", None);
        old.role = crate::agents::AgentRole::Supervisor;
        results.record_finished(result("sup-old"), old);
        results.record_finished(result("c1"), child("c1", Some("sup-old")));
        results.record_finished(result("c2"), child("c2", Some("sup-other")));
        results.record(result("c3"), Some("sup-old".into()));
        let adoption = crate::supervisor::several::Adoption {
            from_ids: vec!["sup-old".into()],
            to_id: "sup-new".into(),
        };
        assert_eq!(results.adopt_children(&adoption), 2);
        assert_eq!(results.parent_of("c1").as_deref(), Some("sup-new"));
        assert_eq!(results.parent_of("c3").as_deref(), Some("sup-new"));
        assert_eq!(results.parent_of("c2").as_deref(), Some("sup-other"));
        assert_eq!(
            results.finished_children_of("sup-new")[0]
                .spawned_by_agent_id
                .as_deref(),
            Some("sup-new"),
            "the kept listing follows too"
        );
        let finished: Vec<String> = results
            .finished_agents()
            .into_iter()
            .map(|agent| agent.id)
            .collect();
        assert_eq!(
            finished,
            vec!["c2", "c1", "sup-old"],
            "newest first, listed ones only"
        );
    }

    #[test]
    fn subscribers_hear_of_a_supervisors_children_once() {
        let results = RunResults::default();
        let heard = results.subscribe();
        results.record_finished(result("c1"), child("c1", Some("sup")));
        results.record_finished(result("c1"), child("c1", Some("sup")));
        results.record_finished(result("plain"), child("plain", None));
        let got: Vec<FinishedChild> = heard.try_iter().collect();
        assert_eq!(got.len(), 1, "a repeat and a parentless run are not news");
        assert_eq!(got[0].supervisor_id, "sup");
        assert_eq!(got[0].agent.id, "c1");
        drop(heard);
        results.record_finished(result("c3"), child("c3", Some("sup")));
        assert!(
            results.subscribers.lock().unwrap().is_empty(),
            "a gone subscriber is dropped"
        );
    }

    #[test]
    fn subscribers_hear_when_a_supervisor_session_ends_once() {
        let results = RunResults::default();
        let heard = results.subscribe_session_ends();
        let mut supervisor = child("sup", None);
        supervisor.role = crate::agents::AgentRole::Supervisor;
        results.record_finished(result("sup"), supervisor.clone());
        results.record_finished(result("sup"), supervisor);
        results.record_finished(result("worker"), child("worker", Some("sup")));
        let ended: Vec<String> = heard.try_iter().map(|agent| agent.id).collect();
        assert_eq!(
            ended,
            vec!["sup".to_string()],
            "a repeat and a worker are not news"
        );
    }
}
