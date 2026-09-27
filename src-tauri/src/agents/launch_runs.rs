//! What an agent started for a launch request (MCP `request_agent_launch`)
//! tells the inbox, so the asking agent can read it back via `get_agent_run`.
//!
//! The backend writes the status because only the backend sees every moment
//! that matters, in order: the spawn, the exit, a kill, and the agents a
//! previous session left behind. The frontend used to write it, and lost it
//! whenever a run ended before the store had registered the agent, or when
//! the one write failed. It now only adds the summary it derives from the
//! logs (`src/lib/agents/launchRunTracking.ts`).

use super::types::AgentInfo;
use crate::agent_persistence::PersistedAgent;
use crate::notifications::AgentLaunchRunInput;
use std::time::Duration;

/// Waits before the second, third and fourth attempt. A locked inbox is
/// already waited out by the connection's busy timeout; what is left is
/// rarer (a full disk, a file being replaced) and gets a few seconds.
pub const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(200),
    Duration::from_secs(1),
    Duration::from_secs(5),
];

fn input(request_uid: &str, agent_id: &str, status: &str) -> AgentLaunchRunInput {
    AgentLaunchRunInput {
        request_uid: request_uid.to_string(),
        agent_id: agent_id.to_string(),
        agent_name: None,
        provider: None,
        model: None,
        status: status.to_string(),
        summary: None,
        error: None,
        summary_only: false,
    }
}

/// The `running` record for a freshly spawned agent, if it serves a request.
pub fn started(launch_request_uid: Option<&str>, info: &AgentInfo) -> Option<AgentLaunchRunInput> {
    let uid = launch_request_uid?;
    Some(AgentLaunchRunInput {
        agent_name: Some(info.name.clone()),
        provider: Some(info.provider.clone()),
        model: Some(info.model.clone()),
        ..input(uid, &info.id, "running")
    })
}

/// The verdict for a process that exited by itself.
pub fn ended(request_uid: &str, agent_id: &str, exit_code: i32) -> AgentLaunchRunInput {
    if exit_code == 0 {
        return input(request_uid, agent_id, "completed");
    }
    AgentLaunchRunInput {
        error: Some(format!("The agent exited with code {exit_code}")),
        ..input(request_uid, agent_id, "failed")
    }
}

pub fn killed(request_uid: &str, agent_id: &str) -> AgentLaunchRunInput {
    input(request_uid, agent_id, "killed")
}

/// Runs the previous session left behind: their processes died with it.
pub fn interrupted(agents: &[PersistedAgent]) -> Vec<AgentLaunchRunInput> {
    agents
        .iter()
        .filter_map(|agent| {
            let uid = agent.launch_request_uid.as_deref()?;
            Some(input(uid, &agent.id, "interrupted"))
        })
        .collect()
}

/// Agents the last session left behind whose run already has its verdict:
/// they ended, only letting go of their anchor did not land. Offering them
/// for resume would start a finished run again (review r3).
pub fn settled(agents: &[PersistedAgent], is_final: &dyn Fn(&str, &str) -> bool) -> Vec<String> {
    agents
        .iter()
        .filter(|agent| {
            agent
                .launch_request_uid
                .as_deref()
                .is_some_and(|uid| is_final(uid, &agent.id))
        })
        .map(|agent| agent.id.clone())
        .collect()
}

/// Refuses to resume an agent whose run already has its verdict.
pub fn refuse_finished(
    agent: &PersistedAgent,
    is_final: &dyn Fn(&str, &str) -> bool,
) -> Result<(), String> {
    match agent.launch_request_uid.as_deref() {
        Some(uid) if is_final(uid, &agent.id) => Err(format!(
            "Agent {} already ended; its run for request {uid} has its verdict",
            agent.id
        )),
        _ => Ok(()),
    }
}

/// Calls `write` until it succeeds, sleeping `delays[i]` before retry `i`.
/// Returns the last error when every attempt failed.
pub fn write_with_retry(
    delays: &[Duration],
    sleep: &dyn Fn(Duration),
    write: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    let mut outcome = write();
    for delay in delays {
        if outcome.is_ok() {
            break;
        }
        sleep(*delay);
        outcome = write();
    }
    outcome
}

/// Waits before the second and third attempt of the `running` record at a
/// spawn: short, because the spawn waits for it.
pub const START_RETRY_DELAYS: [Duration; 2] = [Duration::from_millis(200), Duration::from_secs(1)];

/// Records `running` before the agent is handed out, or aborts it. A run
/// whose start was never stored has no owner the next start could correct,
/// and a verdict could overtake it; so a start that cannot be recorded is not
/// a start (review r2). `abort` ends the process that was already spawned.
pub fn start_or_abort(
    delays: &[Duration],
    sleep: &dyn Fn(Duration),
    write: &mut dyn FnMut() -> Result<(), String>,
    abort: impl FnOnce(),
) -> Result<(), String> {
    write_with_retry(delays, sleep, write).map_err(|error| {
        abort();
        format!("The launch request could not be recorded, so the agent was stopped: {error}")
    })
}

/// `start_or_abort` against the inbox.
pub fn record_start(
    app: &tauri::AppHandle,
    record: &AgentLaunchRunInput,
    abort: impl FnOnce(),
) -> Result<(), String> {
    start_or_abort(
        &START_RETRY_DELAYS,
        &std::thread::sleep,
        &mut || write_to_inbox(app, record),
        abort,
    )
}

/// Writes a run's verdict, then lets go of the agent's restart anchor, in
/// that order. Until the verdict is stored the anchor stays: an IDE that
/// quits in between, or a write that never lands, leaves the agent in the
/// persistence file, and the next start marks its run `interrupted` instead
/// of leaving it `running` for good.
///
/// Letting go is retried like the write: a failed save keeps the anchor
/// (`AgentPersistence::record_exit`), and one that never lands is an error.
pub fn finish(
    delays: &[Duration],
    sleep: &dyn Fn(Duration),
    write: &mut dyn FnMut() -> Result<(), String>,
    release_anchor: &mut dyn FnMut() -> Result<(), String>,
) -> Result<(), String> {
    write_with_retry(delays, sleep, write)?;
    write_with_retry(delays, sleep, release_anchor)
}

fn write_to_inbox(app: &tauri::AppHandle, record: &AgentLaunchRunInput) -> Result<(), String> {
    use tauri::Manager;
    let inbox = app
        .try_state::<crate::notifications::NotificationsState>()
        .ok_or_else(|| "The inbox is unavailable".to_string())?;
    let conn = inbox
        .conn
        .lock()
        .map_err(|_| "The inbox is unavailable".to_string())?;
    crate::notifications::record_launch_run_impl(&conn, record)
}

fn report(record: &AgentLaunchRunInput, outcome: Result<(), String>) {
    if let Err(error) = outcome {
        eprintln!(
            "Launch run {} ({}): could not record '{}': {error}",
            record.request_uid, record.agent_id, record.status
        );
    }
}

/// Writes `record` on a thread of its own, with retries: the caller is a
/// spawn or a restart and must not wait on the inbox.
pub fn record(app: &tauri::AppHandle, record: AgentLaunchRunInput) {
    let app = app.clone();
    std::thread::spawn(move || {
        let outcome = write_with_retry(&RETRY_DELAYS, &std::thread::sleep, &mut || {
            write_to_inbox(&app, &record)
        });
        report(&record, outcome);
    });
}

/// The end of an agent: its verdict for the request it served, if any, and
/// then its restart anchor (see `finish`), on a thread of its own.
pub fn end(app: &tauri::AppHandle, agent_id: &str, verdict: Option<AgentLaunchRunInput>) {
    let Some(verdict) = verdict else {
        if let Err(error) = super::persistence_record_exit(app, agent_id) {
            eprintln!("Agent persistence: {error}");
        }
        return;
    };
    let app = app.clone();
    let agent_id = agent_id.to_string();
    std::thread::spawn(move || {
        let outcome = finish(
            &RETRY_DELAYS,
            &std::thread::sleep,
            &mut || write_to_inbox(&app, &verdict),
            &mut || super::persistence_record_exit(&app, &agent_id),
        );
        report(&verdict, outcome);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn info() -> AgentInfo {
        AgentInfo {
            id: "agent-4".to_string(),
            name: "Worker".to_string(),
            model: "gpt-5".to_string(),
            provider: "codex".to_string(),
            status: super::super::types::AgentStatus::Running,
            current_task: Some("t".to_string()),
            started_at: 1,
            last_activity_at: None,
            project_path: None,
            repo_path: Some("/repo".to_string()),
            spawned_by_ticket_id: None,
            spawned_by_goal_id: None,
        }
    }

    #[test]
    fn a_spawn_for_a_request_is_recorded_as_running_with_its_identity() {
        let record = started(Some("req-1"), &info()).expect("a record");
        assert_eq!(record.request_uid, "req-1");
        assert_eq!(record.agent_id, "agent-4");
        assert_eq!(record.status, "running");
        assert_eq!(record.provider.as_deref(), Some("codex"));
        assert_eq!(record.model.as_deref(), Some("gpt-5"));
    }

    #[test]
    fn a_spawn_without_a_request_records_nothing() {
        assert!(started(None, &info()).is_none());
    }

    #[test]
    fn an_exit_is_completed_or_failed_by_its_code() {
        assert_eq!(ended("req-1", "agent-4", 0).status, "completed");
        let failed = ended("req-1", "agent-4", 1);
        assert_eq!(failed.status, "failed");
        assert!(failed.error.unwrap().contains('1'));
    }

    #[test]
    fn only_agents_that_served_a_request_are_marked_interrupted() {
        let mut served: PersistedAgent = serde_json::from_value(serde_json::json!({
            "id": "agent-2", "name": "a", "model": "m", "provider": "codex", "task": "t",
            "cwd": null, "permissionMode": null, "startedAt": 1,
        }))
        .unwrap();
        let plain = served.clone();
        served.launch_request_uid = Some("req-1".to_string());

        let records = interrupted(&[served, plain]);

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].request_uid, "req-1");
        assert_eq!(records[0].agent_id, "agent-2");
        assert_eq!(records[0].status, "interrupted");
    }

    /// Fault injection: the first two writes fail, the third lands.
    #[test]
    fn a_failed_write_is_retried_until_it_lands() {
        let calls = Cell::new(0);
        let slept = RefCell::new(Vec::new());
        let outcome = write_with_retry(&RETRY_DELAYS, &|d| slept.borrow_mut().push(d), &mut || {
            calls.set(calls.get() + 1);
            if calls.get() < 3 {
                Err("disk I/O error".to_string())
            } else {
                Ok(())
            }
        });
        assert_eq!(outcome, Ok(()));
        assert_eq!(calls.get(), 3);
        assert_eq!(*slept.borrow(), RETRY_DELAYS[..2].to_vec());
    }

    #[test]
    fn a_write_that_never_lands_gives_up_with_the_last_error() {
        let calls = Cell::new(0);
        let outcome = write_with_retry(&RETRY_DELAYS, &|_| (), &mut || {
            calls.set(calls.get() + 1);
            Err(format!("attempt {}", calls.get()))
        });
        assert_eq!(outcome, Err("attempt 4".to_string()));
    }

    /// Review r1, fault injection: the verdict never lands and the IDE quits
    /// right after. The restart must still find the agent and mark its run
    /// `interrupted`; it must never stay `running`.
    #[test]
    fn a_verdict_that_never_lands_leaves_the_run_interrupted_after_a_restart() {
        use crate::agent_persistence::AgentPersistence;
        use crate::notifications::{self, NotificationInput};

        let dir = tempfile::tempdir().unwrap();
        let anchors = dir.path().join("active-agents.json");
        let inbox = notifications::init_db(&dir.path().join("notifications.db")).unwrap();
        let mut request: NotificationInput = serde_json::from_value(serde_json::json!({
            "uid": "req-1", "source": "agent", "origin": "request_agent_launch",
            "title": "Agent requested", "dedupeKey": "agent-launch:req-1",
            "refKind": "goal", "refId": "goal-1", "projectPath": "/repo",
        }))
        .unwrap();
        request.actions = None;
        let mut inbox = inbox;
        notifications::dispatch_impl(&mut inbox, &request).unwrap();

        let mut persistence = AgentPersistence::load(Some(anchors.clone()));
        let mut agent: PersistedAgent = serde_json::from_value(serde_json::json!({
            "id": "agent-4", "name": "Worker", "model": "gpt-5", "provider": "codex",
            "task": "t", "cwd": "/repo", "permissionMode": null, "startedAt": 1,
        }))
        .unwrap();
        agent.launch_request_uid = Some("req-1".to_string());
        persistence.record_spawn(agent).unwrap();
        notifications::record_launch_run_impl(&inbox, &started(Some("req-1"), &info()).unwrap())
            .unwrap();

        let outcome = finish(
            &RETRY_DELAYS,
            &|_| (),
            &mut || Err("disk I/O error".to_string()),
            &mut || persistence.record_exit("agent-4"),
        );
        assert!(outcome.is_err());

        // Restart.
        let left_behind = AgentPersistence::load(Some(anchors)).interrupted();
        for record in interrupted(&left_behind) {
            notifications::record_launch_run_impl(&inbox, &record).unwrap();
        }
        let status: String = inbox
            .query_row(
                "SELECT status FROM agent_launch_runs WHERE request_uid = 'req-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "interrupted");
    }

    #[test]
    fn a_verdict_that_lands_lets_go_of_the_anchor() {
        let released = Cell::new(false);
        let outcome = finish(&RETRY_DELAYS, &|_| (), &mut || Ok(()), &mut || {
            released.set(true);
            Ok(())
        });
        assert_eq!(outcome, Ok(()));
        assert!(released.get());
    }

    /// Review r2, fault injection: the start cannot be recorded. The spawned
    /// process is ended and the spawn fails, instead of running unrecorded.
    #[test]
    fn a_start_that_cannot_be_recorded_is_aborted() {
        let calls = Cell::new(0);
        let aborted = Cell::new(false);
        let outcome = start_or_abort(
            &START_RETRY_DELAYS,
            &|_| (),
            &mut || {
                calls.set(calls.get() + 1);
                Err("database is locked".to_string())
            },
            || aborted.set(true),
        );
        assert!(outcome.unwrap_err().contains("database is locked"));
        assert!(aborted.get());
        assert_eq!(calls.get(), 3);
    }

    #[test]
    fn a_recorded_start_is_not_aborted() {
        let aborted = Cell::new(false);
        let outcome = start_or_abort(&START_RETRY_DELAYS, &|_| (), &mut || Ok(()), || {
            aborted.set(true)
        });
        assert_eq!(outcome, Ok(()));
        assert!(!aborted.get());
    }

    /// Review r3, fault injection: the verdict is stored, but letting go of
    /// the anchor fails. It is retried until it lands; one that never lands
    /// is reported.
    #[test]
    fn letting_go_of_the_anchor_is_retried_and_a_final_failure_reported() {
        let tries = Cell::new(0);
        let outcome = finish(&RETRY_DELAYS, &|_| (), &mut || Ok(()), &mut || {
            tries.set(tries.get() + 1);
            if tries.get() < 3 {
                Err("disk full".to_string())
            } else {
                Ok(())
            }
        });
        assert_eq!(outcome, Ok(()));
        assert_eq!(tries.get(), 3);

        let outcome = finish(&RETRY_DELAYS, &|_| (), &mut || Ok(()), &mut || {
            Err("disk full".to_string())
        });
        assert_eq!(outcome, Err("disk full".to_string()));
    }

    /// Review r3, the whole chain: the verdict is stored, letting go of the
    /// anchor fails for good, the IDE restarts. No finished agent is offered
    /// for resume, and the run keeps its verdict.
    #[test]
    fn a_finished_agent_whose_anchor_stayed_is_not_offered_after_a_restart() {
        use crate::agent_persistence::AgentPersistence;
        use crate::notifications::{self, NotificationInput};

        let dir = tempfile::tempdir().unwrap();
        let anchors = dir.path().join("active-agents.json");
        let mut inbox = notifications::init_db(&dir.path().join("notifications.db")).unwrap();
        let request: NotificationInput = serde_json::from_value(serde_json::json!({
            "uid": "req-1", "source": "agent", "origin": "request_agent_launch",
            "title": "Agent requested", "dedupeKey": "agent-launch:req-1",
            "refKind": "goal", "refId": "goal-1", "projectPath": "/repo",
        }))
        .unwrap();
        notifications::dispatch_impl(&mut inbox, &request).unwrap();
        let mut persistence = AgentPersistence::load(Some(anchors.clone()));
        let mut agent: PersistedAgent = serde_json::from_value(serde_json::json!({
            "id": "agent-4", "name": "Worker", "model": "gpt-5", "provider": "codex",
            "task": "t", "cwd": "/repo", "permissionMode": null, "startedAt": 1,
        }))
        .unwrap();
        agent.launch_request_uid = Some("req-1".to_string());
        persistence.record_spawn(agent).unwrap();
        notifications::record_launch_run_impl(&inbox, &started(Some("req-1"), &info()).unwrap())
            .unwrap();
        std::fs::create_dir(anchors.with_extension("json.tmp")).unwrap();

        let outcome = finish(
            &RETRY_DELAYS,
            &|_| (),
            &mut || notifications::record_launch_run_impl(&inbox, &ended("req-1", "agent-4", 0)),
            &mut || persistence.record_exit("agent-4"),
        );
        assert!(outcome.is_err());

        // Restart, with the save still failing (review r4).
        let mut restarted = AgentPersistence::load(Some(anchors.clone()));
        let ghost = restarted.interrupted()[0].clone();
        let is_final = |uid: &str, agent: &str| {
            notifications::launch_run_is_final_for(&inbox, uid, agent).unwrap()
        };
        let ids = settled(&restarted.interrupted(), &is_final);
        assert!(restarted.settle(&ids).is_err());
        for record in interrupted(&restarted.interrupted()) {
            notifications::record_launch_run_impl(&inbox, &record).unwrap();
        }

        // Not offered, not resumable, verdict kept.
        assert!(restarted.interrupted().is_empty());
        assert!(refuse_finished(&ghost, &is_final).is_err());
        let status: String = inbox
            .query_row(
                "SELECT status FROM agent_launch_runs WHERE request_uid = 'req-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "completed");

        // Once saving works again, the file is cleaned for good.
        std::fs::remove_dir(anchors.with_extension("json.tmp")).unwrap();
        restarted.save().unwrap();
        assert!(AgentPersistence::load(Some(anchors))
            .interrupted()
            .is_empty());
    }

    #[test]
    fn an_agent_without_a_verdict_may_be_resumed() {
        let mut agent: PersistedAgent = serde_json::from_value(serde_json::json!({
            "id": "agent-2", "name": "a", "model": "m", "provider": "codex", "task": "t",
            "cwd": null, "permissionMode": null, "startedAt": 1,
        }))
        .unwrap();
        assert!(refuse_finished(&agent, &|_, _| true).is_ok());
        agent.launch_request_uid = Some("req-1".to_string());
        assert!(refuse_finished(&agent, &|_, _| false).is_ok());
        assert!(refuse_finished(&agent, &|_, _| true).is_err());
    }
}
