//! `mark_waiting` / `clear_waiting` and what a mark does to the stall
//! watchdog (`docs/design-agent-control.md`, "Waiting on purpose").

use super::*;
use crate::agents::questions::NewQuestion;

const MIN: u64 = 60_000;

fn real_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn mark(s: &Scope, params: Value) -> Value {
    call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 1, "method": "mark_waiting", "params": params }),
    )
}

fn tick(s: &Scope, t: Instant, since_start: Duration, epoch_ms: u64) {
    s.h.dispatcher.watchdog_tick_at(
        t + since_start,
        epoch_ms,
        Duration::from_secs(900),
        &HashSet::new(),
    );
}

fn stall_messages(s: &Scope) -> usize {
    s.h.backend
        .written
        .lock()
        .unwrap()
        .iter()
        .filter(|(_, text)| text.contains("Stalled") || text.contains("Stall escalated"))
        .count()
}

fn nudges(s: &Scope) -> usize {
    s.h.backend
        .written
        .lock()
        .unwrap()
        .iter()
        .filter(|(id, _)| id == "agent-child")
        .count()
}

#[test]
fn a_marked_agent_gets_no_nudge_and_no_notice() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    let marked = mark(
        &s,
        json!({ "agentId": "agent-child", "reason": "waiting for the deploy" }),
    );
    assert_eq!(marked["ok"], true, "{marked}");
    assert_eq!(marked["result"]["reason"], "waiting for the deploy");
    // Many stall intervals pass, as they would for a parked agent.
    for n in 0..8u32 {
        tick(
            &s,
            t,
            Duration::from_secs(900) * n,
            now + u64::from(n) * 15 * MIN,
        );
    }
    assert_eq!(nudges(&s), 0, "no status check typed into a parked agent");
    assert_eq!(stall_messages(&s), 0, "no stall notice to the supervisor");
    assert!(
        s.h.backend.notified.lock().unwrap().is_empty(),
        "none to the human either"
    );
    let listed = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 2, "method": "list_agents" }),
    );
    let child = listed["result"]["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == "agent-child")
        .unwrap();
    assert_eq!(child["waitingReason"], "waiting for the deploy");
    assert!(child["waitingUntil"].is_string());
    assert!(child.get("stalledSinceMs").map_or(true, Value::is_null));
}

#[test]
fn an_unmarked_sibling_still_stalls() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    s.h.backend.agents.lock().unwrap().push(agent_in(
        "agent-child-2",
        Some("agent-sup"),
        &s.path,
        AgentStatus::Running,
    ));
    assert_eq!(
        mark(&s, json!({ "agentId": "agent-child", "reason": "x" }))["ok"],
        true
    );
    tick(&s, t, Duration::ZERO, now);
    tick(&s, t, Duration::from_secs(900), now + 15 * MIN);
    let written = s.h.backend.written.lock().unwrap().clone();
    assert!(written.iter().any(|(id, _)| id == "agent-child-2"));
    assert!(!written.iter().any(|(id, _)| id == "agent-child"));
}

#[test]
fn the_mark_ends_at_until_and_stall_detection_starts_a_fresh_window() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    mark(
        &s,
        json!({ "agentId": "agent-child", "reason": "deploy", "until": "30m" }),
    );
    tick(&s, t, Duration::ZERO, now);
    tick(&s, t, Duration::from_secs(1500), now + 25 * MIN);
    assert_eq!(nudges(&s), 0, "still parked at 25 minutes");
    // 31 minutes: the mark has run out and is dropped; the window restarts here.
    tick(&s, t, Duration::from_secs(1860), now + 31 * MIN);
    let listed = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 2, "method": "list_agents" }),
    );
    assert!(listed["result"]["agents"][1].get("waitingReason").is_none());
    assert_eq!(nudges(&s), 0, "the new window has not run out yet");
    tick(&s, t, Duration::from_secs(1860 + 900), now + 46 * MIN);
    assert_eq!(nudges(&s), 1, "normal detection resumed");
    assert_eq!(stall_messages(&s), 1);
}

#[test]
fn new_output_ends_the_mark() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    mark(&s, json!({ "agentId": "agent-child", "reason": "deploy" }));
    tick(&s, t, Duration::ZERO, now);
    s.h.buffers
        .append("agent-child", "Deploy finished, continuing.\n");
    tick(&s, t, Duration::from_secs(5), now + 5_000);
    let listed = call_as(
        &s.h,
        &s.supervisor,
        json!({ "id": 2, "method": "list_agents" }),
    );
    assert!(listed["result"]["agents"]
        .as_array()
        .unwrap()
        .iter()
        .all(|a| a.get("waitingReason").is_none()));
    // And a later silence is a stall again.
    tick(&s, t, Duration::from_secs(5 + 900), now + 5_000 + 15 * MIN);
    assert_eq!(nudges(&s), 1);
}

#[test]
fn a_question_ends_the_mark() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    mark(&s, json!({ "agentId": "agent-child", "reason": "human" }));
    tick(&s, t, Duration::ZERO, now);
    s.h.dispatcher
        .questions
        .raise(
            "agent-child",
            NewQuestion {
                question: "Which branch?".into(),
                context: None,
                options: vec![],
                raised_at: 1,
            },
        )
        .unwrap();
    tick(&s, t, Duration::from_secs(5), now + 5_000);
    assert!(s.h.dispatcher.marks().get("agent-child").is_none());
}

#[test]
fn a_finished_agent_loses_its_mark() {
    let s = watchdog_scope();
    let t = Instant::now();
    let now = real_now();
    mark(&s, json!({ "agentId": "agent-child", "reason": "deploy" }));
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .iter_mut()
        .find(|a| a.id == "agent-child")
        .unwrap()
        .status = AgentStatus::Idle;
    tick(&s, t, Duration::ZERO, now);
    assert!(s.h.dispatcher.marks().get("agent-child").is_none());
}

#[test]
fn only_the_owning_supervisor_may_mark_or_clear() {
    let s = watchdog_scope();
    let other = Caller::Supervisor {
        agent_id: "agent-sup-2".into(),
    };
    s.h.backend.agents.lock().unwrap().push(AgentInfo {
        id: "agent-sup-2".into(),
        role: AgentRole::Supervisor,
        ..sample_agent()
    });
    let refused = call_as(
        &s.h,
        &other,
        json!({ "id": 1, "method": "mark_waiting",
                "params": { "agentId": "agent-child", "reason": "mine now" } }),
    );
    assert_eq!(error_code(&refused), "unknown_agent", "{refused}");
    mark(&s, json!({ "agentId": "agent-child", "reason": "deploy" }));
    let cleared = call_as(
        &s.h,
        &other,
        json!({ "id": 1, "method": "clear_waiting", "params": { "agentId": "agent-child" } }),
    );
    assert_eq!(error_code(&cleared), "unknown_agent", "{cleared}");
    assert!(
        s.h.dispatcher.marks().get("agent-child").is_some(),
        "untouched"
    );
    // An agent the human started is not a supervisor's either.
    let human = mark(&s, json!({ "agentId": "agent-human", "reason": "x" }));
    assert_eq!(error_code(&human), "unknown_agent");
    // The owner clears its own mark; clearing twice is an answer, not an error.
    let call = || {
        call_as(
            &s.h,
            &s.supervisor,
            json!({ "id": 1, "method": "clear_waiting", "params": { "agentId": "agent-child" } }),
        )
    };
    assert_eq!(call()["result"]["cleared"], true);
    assert_eq!(call()["result"]["cleared"], false);
}

#[test]
fn outside_clients_and_bad_input_are_refused() {
    let s = watchdog_scope();
    let external = call_as(
        &s.h,
        &Caller::External,
        json!({ "id": 1, "method": "mark_waiting",
                "params": { "agentId": "agent-child", "reason": "x" } }),
    );
    assert_eq!(error_code(&external), "outside_supervisor_scope");
    for params in [
        json!({ "agentId": "agent-child", "reason": "  " }),
        json!({ "agentId": "agent-child", "reason": "x", "until": "25h" }),
        json!({ "agentId": "agent-child", "reason": "x", "until": "yesterday" }),
        json!({ "agentId": "agent-child", "reason": "x", "extra": 1 }),
        json!({ "agentId": " ", "reason": "x" }),
    ] {
        let response = mark(&s, params.clone());
        assert_eq!(
            error_code(&response),
            "invalid_params",
            "{params}: {response}"
        );
    }
    // A finished child cannot be parked.
    let done = mark(&s, json!({ "agentId": "agent-done", "reason": "x" }));
    assert_eq!(error_code(&done), "invalid_params", "{done}");
}

#[test]
fn marks_are_kept_in_the_app_data_folder() {
    let s = watchdog_scope();
    let app = tempfile::tempdir().unwrap();
    *s.h.backend.app_data.lock().unwrap() = Some(app.path().to_path_buf());
    mark(
        &s,
        json!({ "agentId": "agent-child", "reason": "deploy", "until": "1h" }),
    );
    let kept = crate::agent_waiting::read_active(app.path(), real_now());
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].agent_id, "agent-child");
    assert_eq!(kept[0].supervisor_id, "agent-sup");
    assert_eq!(kept[0].reason, "deploy");
}
