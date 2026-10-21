//! `jobs.create` end to end against a fake frontend and a real repository:
//! the policy check, the spawn as the frontend gets it, progress, the result
//! on the branch, the counter and cancelling. No agent CLI runs.

use super::*;
use crate::providers::ModelOption;
use crate::supervisor::policy::{ProjectRules, SupervisorPolicy};
use crate::supervisor_link::policy::JobLimits;
use crate::supervisor_link::test_support::Project;

struct Setup {
    h: Harness,
    p: Project,
    worktree: PathBuf,
    _place: tempfile::TempDir,
}

fn model(value: &str, rank: Option<i64>) -> ModelOption {
    ModelOption {
        value: value.into(),
        label: value.into(),
        rank,
        ..Default::default()
    }
}

/// A project open to supervisors and the link, with instructions, an
/// `.auric/project.db` and a worktree the "frontend" made for agent-7.
fn setup(limits: JobLimits) -> Setup {
    let p = Project::new();
    let repo = p.init_repo();
    p.write(
        "docs/agents/draw.md",
        "Draw the diagram the payload asks for.\n",
    );
    p.write("docs/system.diagram.json", r#"{"v":1}"#);
    let base = p.commit_all(&repo, "first");
    p.write(".auric/project.db", "");
    let head = repo.find_commit(base).unwrap();
    let branch = repo.branch("auric/diagram-draw-1", &head, false).unwrap();
    let place = tempfile::tempdir().unwrap();
    let worktree = place.path().canonicalize().unwrap().join("wt");
    let mut options = git2::WorktreeAddOptions::new();
    options.reference(Some(branch.get()));
    repo.worktree("diagram-draw-1", &worktree, Some(&options))
        .unwrap();

    let h = harness(fleet());
    let mut policy = p.policy();
    policy.jobs = limits;
    *h.host.policy.lock().unwrap() = policy;
    let mut supervisor = SupervisorPolicy::default();
    supervisor.projects.insert(
        p.path().into(),
        ProjectRules {
            allowed: true,
            max_running: 5,
            ..ProjectRules::default()
        },
    );
    *h.backend.policy.lock().unwrap() = supervisor;
    h.backend.offered.lock().unwrap().insert(
        "claude".into(),
        vec![
            model("big", Some(3)),
            model("unranked", None),
            model("small", Some(1)),
        ],
    );
    *h.backend.reply.lock().unwrap() = Some(FrontendReply {
        ok: true,
        result: Some(json!({ "agentId": "agent-7" })),
        error: None,
    });
    h.backend.agents.lock().unwrap().push(AgentInfo {
        project_path: Some(p.path().into()),
        repo_path: Some(worktree.to_str().unwrap().into()),
        status: AgentStatus::Running,
        headless: true,
        ..agent("agent-7", AgentRole::Worker, None)
    });
    Setup {
        h,
        p,
        worktree,
        _place: place,
    }
}

fn create(s: &Setup, payload: Value) -> Result<Value, LinkError> {
    let line = json!({
        "v": 1, "id": 1, "method": "jobs.create",
        "params": { "project": s.p.path(), "kind": "diagram.draw", "payload": payload }
    });
    ask(&s.h.link, &line.to_string())
}

fn set_status(s: &Setup, status: AgentStatus) {
    for agent in s.h.backend.agents.lock().unwrap().iter_mut() {
        if agent.id == "agent-7" {
            agent.status = status.clone();
        }
    }
}

fn subscribed(s: &Setup) -> Subscription {
    let reply = s.h.link.handle(
        parse_message(r#"{"v":1,"id":1,"method":"events.subscribe"}"#)
            .unwrap()
            .1,
    );
    let Some(Install::Set(subscription)) = reply.install else {
        panic!("subscribe installs a subscription");
    };
    *subscription
}

#[test]
fn a_job_runs_headless_in_its_worktree_on_the_smallest_ranked_model() {
    let s = setup(JobLimits::default());
    let mut events = subscribed(&s);
    let started = create(&s, json!({ "focus": "auth" })).unwrap();
    assert_eq!(started["agentId"], "agent-7");
    assert_eq!(started["branch"], "auric/diagram-draw-1");
    assert_eq!(started["model"], "small");
    assert_eq!(started["provider"], "claude");

    let request = s.h.backend.requests.lock().unwrap()[0].clone();
    assert_eq!(request.method, "spawn");
    let params = &request.params;
    assert_eq!(params["headless"], true);
    assert_eq!(params["worktree"], true);
    assert_eq!(params["runSource"], "supervisor");
    assert_eq!(params["role"], "worker");
    assert!(params.get("spawnedByAgentId").is_none());
    let prompt = params["prompt"].as_str().unwrap();
    assert!(prompt.contains("docs/agents/draw.md"));
    assert!(prompt.contains("\"focus\": \"auth\""));

    let names: Vec<&str> = events
        .poll_jobs(s.h.link.jobs())
        .iter()
        .map(|e| e.0)
        .collect();
    assert_eq!(names, vec!["job.started"]);
    // The job's agent is part of the tree the client sees.
    assert!(s
        .h
        .link
        .tree()
        .iter()
        .any(|agent| agent.summary.info.id == "agent-7"));
}

#[test]
fn progress_then_the_result_on_the_branch_then_a_notification() {
    let s = setup(JobLimits::default());
    let started = create(&s, json!("draw it")).unwrap();
    let job_id = started["jobId"].as_str().unwrap().to_string();
    let mut events = subscribed(&s);

    std::fs::write(s.worktree.join("docs/auth.diagram.json"), r#"{"nodes":[]}"#).unwrap();
    s.h.link.tick_jobs(jobs::now_ms());
    let progress = events.poll_jobs(s.h.link.jobs());
    assert_eq!(progress.len(), 1);
    assert_eq!(progress[0].0, "job.progress");
    assert_eq!(progress[0].1["changed"], json!(["docs/auth.diagram.json"]));
    s.h.link.tick_jobs(jobs::now_ms());
    assert!(
        events.poll_jobs(s.h.link.jobs()).is_empty(),
        "no change, no event"
    );

    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let finished = events.poll_jobs(s.h.link.jobs());
    assert_eq!(finished[0].0, "job.finished");
    let job = &finished[0].1["job"];
    assert_eq!(job["jobId"], job_id.as_str());
    assert_eq!(job["status"], "finished");
    assert_eq!(job["documents"][0]["id"], "docs/auth.diagram.json");
    assert_eq!(job["documents"][0]["created"], true);
    let commit = job["commit"].as_str().unwrap();

    // The preview reads the branch and says it is not merged.
    let preview = ask(
        &s.h.link,
        &json!({ "v": 1, "id": 2, "method": "documents.get", "params": {
            "project": s.p.path(), "type": "diagram", "id": "docs/auth.diagram.json", "rev": commit
        }})
        .to_string(),
    )
    .unwrap();
    assert_eq!(preview["merged"], false);
    assert_eq!(preview["document"], json!({ "nodes": [] }));
    assert!(
        !s.p.root.join("docs/auth.diagram.json").exists(),
        "the human's checkout is untouched"
    );

    let notified = s.h.host.notified.lock().unwrap();
    assert_eq!(notified.len(), 1);
    assert!(notified[0].title.contains("finished"));

    let listed = ask(
        &s.h.link,
        r#"{"v":1,"id":3,"method":"jobs.list","params":{"status":"finished"}}"#,
    )
    .unwrap();
    assert_eq!(listed["jobs"][0]["jobId"], job_id.as_str());
}

#[test]
fn an_agent_that_changes_nothing_fails_the_job() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let job = &s.h.link.jobs().list(None, None, 1)[0];
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(
        job.error.as_ref().unwrap().code,
        jobs::JobErrorCode::NoChanges
    );
}

#[test]
fn the_counter_refuses_past_the_limit_and_says_which() {
    let s = setup(JobLimits {
        daily_limit: 1,
        per_project_daily_limit: None,
    });
    create(&s, Value::Null).unwrap();
    let refused = create(&s, Value::Null).unwrap_err();
    assert_eq!(refused.code, "quota_exceeded");
    assert_eq!(refused.reason.as_deref(), Some("daily_limit"));
    assert_eq!(
        s.h.backend.requests.lock().unwrap().len(),
        1,
        "no second spawn"
    );
}

#[test]
fn a_kind_the_project_does_not_list_is_refused_before_anything_starts() {
    let s = setup(JobLimits::default());
    let line = json!({
        "v": 1, "id": 1, "method": "jobs.create",
        "params": { "project": s.p.path(), "kind": "shell.run", "payload": "rm -rf /" }
    });
    let refused = ask(&s.h.link, &line.to_string()).unwrap_err();
    assert_eq!(refused.code, "job_kind_not_allowed");
    assert!(s.h.backend.requests.lock().unwrap().is_empty());
    assert!(
        s.h.link.jobs().list(None, None, 10).is_empty(),
        "nothing counted"
    );
}

#[test]
fn the_supervisor_policy_decides_whether_a_job_may_start() {
    let s = setup(JobLimits::default());
    *s.h.backend.policy.lock().unwrap() = SupervisorPolicy::default();
    let refused = create(&s, Value::Null).unwrap_err();
    assert_eq!(refused.code, "supervisor_denied");
    assert_eq!(refused.reason.as_deref(), Some("project_not_listed"));

    let s = setup(JobLimits::default());
    s.h.backend
        .offered
        .lock()
        .unwrap()
        .insert("claude".into(), vec![model("unranked", None)]);
    let refused = create(&s, Value::Null).unwrap_err();
    assert_eq!(refused.code, "supervisor_denied");
    assert_eq!(refused.reason.as_deref(), Some("no_ranked_model"));
    assert!(s.h.backend.requests.lock().unwrap().is_empty());
}

#[test]
fn cancel_stops_the_agent_and_the_job_ends_as_cancelled() {
    let s = setup(JobLimits::default());
    let job_id = create(&s, Value::Null).unwrap()["jobId"]
        .as_str()
        .unwrap()
        .to_string();
    let cancelled = ask(
        &s.h.link,
        &json!({ "v": 1, "id": 2, "method": "jobs.cancel", "params": { "jobId": job_id } })
            .to_string(),
    )
    .unwrap();
    assert_eq!(cancelled["cancelled"], true);
    let kill = s.h.backend.requests.lock().unwrap().last().unwrap().clone();
    assert_eq!(kill.method, "kill");
    assert_eq!(kill.params["agentId"], "agent-7");

    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-7");
    s.h.link.tick_jobs(jobs::now_ms());
    let job = s.h.link.jobs().get(&job_id).unwrap();
    assert_eq!(job.error.unwrap().code, jobs::JobErrorCode::Cancelled);

    let again = ask(
        &s.h.link,
        &json!({ "v": 1, "id": 3, "method": "jobs.cancel", "params": { "jobId": job_id } })
            .to_string(),
    )
    .unwrap();
    assert_eq!(again["cancelled"], false);
    let unknown = ask(
        &s.h.link,
        r#"{"v":1,"id":4,"method":"jobs.cancel","params":{"jobId":"job-x"}}"#,
    )
    .unwrap_err();
    assert_eq!(unknown.code, "unknown_job");
}

#[test]
fn a_cancel_is_repeated_while_the_agent_still_runs() {
    let s = setup(JobLimits::default());
    let job_id = create(&s, Value::Null).unwrap()["jobId"]
        .as_str()
        .unwrap()
        .to_string();
    // The first kill reaches an agent that is still starting and keeps running.
    *s.h.backend.kill_leaves_agent.lock().unwrap() = true;
    ask(
        &s.h.link,
        &json!({ "v": 1, "id": 2, "method": "jobs.cancel", "params": { "jobId": job_id } })
            .to_string(),
    )
    .unwrap();
    let kills = |s: &Setup| {
        s.h.backend
            .requests
            .lock()
            .unwrap()
            .iter()
            .filter(|request| request.method == "kill")
            .count()
    };
    let before = kills(&s);
    s.h.link.tick_jobs(jobs::now_ms());
    assert_eq!(kills(&s), before + 1, "the tick kills again");
    assert_eq!(
        s.h.link.jobs().get(&job_id).unwrap().status,
        JobStatus::Running
    );

    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let job = s.h.link.jobs().get(&job_id).unwrap();
    assert_eq!(job.error.unwrap().code, jobs::JobErrorCode::Cancelled);
}

#[test]
fn a_job_whose_project_leaves_the_policy_is_stopped() {
    let s = setup(JobLimits::default());
    let job_id = create(&s, Value::Null).unwrap()["jobId"]
        .as_str()
        .unwrap()
        .to_string();
    s.h.host.policy.lock().unwrap().projects.clear();

    s.h.link.tick_jobs(jobs::now_ms());
    let kill = s.h.backend.requests.lock().unwrap().last().unwrap().clone();
    assert_eq!(kill.method, "kill");
    assert_eq!(kill.params["agentId"], "agent-7");

    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let job = s.h.link.jobs().get(&job_id).unwrap();
    assert_eq!(job.status, JobStatus::Failed);
    let error = job.error.unwrap();
    assert_eq!(error.code, jobs::JobErrorCode::Cancelled);
    assert!(
        error.message.contains("no longer shared"),
        "{}",
        error.message
    );
}

#[test]
fn a_job_whose_kind_leaves_the_policy_is_stopped() {
    let s = setup(JobLimits::default());
    let job_id = create(&s, Value::Null).unwrap()["jobId"]
        .as_str()
        .unwrap()
        .to_string();
    for config in s.h.host.policy.lock().unwrap().projects.values_mut() {
        config.job_kinds.clear();
    }
    s.h.link.tick_jobs(jobs::now_ms());
    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let error = s.h.link.jobs().get(&job_id).unwrap().error.unwrap();
    assert_eq!(error.code, jobs::JobErrorCode::Cancelled);
    assert!(
        error.message.contains("no longer allowed"),
        "{}",
        error.message
    );
}

fn book_end(s: &Setup, status: AgentStatus, exit_code: Option<i32>) {
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-7");
    s.h.run_results.record(
        crate::agents::run_results::RunResult::from_finish(
            "agent-7",
            status,
            exit_code,
            None,
            || None,
            jobs::now_ms(),
        ),
        None,
    );
}

fn job_error(s: &Setup) -> Option<jobs::JobError> {
    s.h.link.jobs().list(None, None, 1)[0].error.clone()
}

#[test]
fn an_agent_that_exits_with_an_error_fails_the_job_as_agent_failed() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    // A crashed agent leaves the list at once; only its booked result remains.
    book_end(&s, AgentStatus::Error, Some(1));
    s.h.link.tick_jobs(jobs::now_ms());
    let error = job_error(&s).expect("the job failed");
    assert_eq!(error.code, jobs::JobErrorCode::AgentFailed);
}

#[test]
fn work_committed_before_a_crash_does_not_make_the_job_finished() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    std::fs::write(s.worktree.join("docs/auth.diagram.json"), r#"{"nodes":[]}"#).unwrap();
    book_end(&s, AgentStatus::Error, Some(1));
    s.h.link.tick_jobs(jobs::now_ms());
    let job = &s.h.link.jobs().list(None, None, 1)[0];
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(
        job.error.as_ref().unwrap().code,
        jobs::JobErrorCode::AgentFailed
    );
    assert!(job.commit.is_some(), "the branch still names what was done");
}

#[test]
fn an_agent_killed_from_outside_fails_the_job_as_agent_failed() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    // agents.kill or the Stop button: a result with no exit code.
    book_end(&s, AgentStatus::Idle, None);
    s.h.link.tick_jobs(jobs::now_ms());
    let error = job_error(&s).expect("the job failed");
    assert_eq!(error.code, jobs::JobErrorCode::AgentFailed);
    assert!(error.message.contains("stopped"), "{}", error.message);
}

#[test]
fn a_clean_exit_with_nothing_written_is_still_no_changes() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    book_end(&s, AgentStatus::Idle, Some(0));
    s.h.link.tick_jobs(jobs::now_ms());
    assert_eq!(job_error(&s).unwrap().code, jobs::JobErrorCode::NoChanges);
}

#[test]
fn an_agent_gone_before_its_end_is_booked_is_waited_for() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-7");
    let now = jobs::now_ms();
    s.h.link.tick_jobs(now);
    assert_eq!(
        s.h.link.jobs().list(None, None, 1)[0].status,
        JobStatus::Running,
        "the exit is booked a moment after the agent leaves the list"
    );

    // The end lands before the next tick and decides.
    s.h.run_results.record(
        crate::agents::run_results::RunResult::from_finish(
            "agent-7",
            AgentStatus::Error,
            Some(1),
            None,
            || None,
            now,
        ),
        None,
    );
    s.h.link.tick_jobs(now + 2_000);
    assert_eq!(job_error(&s).unwrap().code, jobs::JobErrorCode::AgentFailed);
}

#[test]
fn an_agent_gone_for_good_with_no_end_booked_closes_after_the_grace() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    s.h.backend
        .agents
        .lock()
        .unwrap()
        .retain(|agent| agent.id != "agent-7");
    let now = jobs::now_ms();
    s.h.link.tick_jobs(now);
    s.h.link
        .tick_jobs(now + crate::supervisor_link::job_runner::VANISHED_GRACE_MS - 1);
    assert_eq!(
        s.h.link.jobs().list(None, None, 1)[0].status,
        JobStatus::Running
    );
    s.h.link
        .tick_jobs(now + crate::supervisor_link::job_runner::VANISHED_GRACE_MS);
    assert_eq!(job_error(&s).unwrap().code, jobs::JobErrorCode::NoChanges);
}

#[test]
fn a_zero_daily_limit_refuses_with_the_reason_disabled() {
    let s = setup(JobLimits {
        daily_limit: 0,
        per_project_daily_limit: None,
    });
    let refused = create(&s, Value::Null).unwrap_err();
    assert_eq!(refused.code, "quota_exceeded");
    assert_eq!(refused.reason.as_deref(), Some("disabled"));
    assert!(
        refused.message.contains("switched off"),
        "{}",
        refused.message
    );
    assert!(s.h.backend.requests.lock().unwrap().is_empty(), "no spawn");
}

#[test]
fn a_global_kind_puts_its_instructions_into_the_prompt_without_the_path() {
    let s = setup(JobLimits::default());
    let app = tempfile::tempdir().unwrap();
    let dir = app.path().join("job-kinds");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("draw.md"), "Draw it the shared way.\n").unwrap();
    {
        let mut policy = s.h.host.policy.lock().unwrap();
        policy.job_kinds_dir = Some(dir.clone());
        let config = policy.projects.values_mut().next().unwrap();
        config.job_kinds[0].instructions = Some("docs/agents/missing.md".into());
        config.job_kinds[0].global_instructions = Some("draw.md".into());
    }
    create(&s, json!({ "focus": "auth" })).unwrap();
    let request = s.h.backend.requests.lock().unwrap()[0].clone();
    let prompt = request.params["prompt"].as_str().unwrap().to_string();
    assert!(prompt.contains("Draw it the shared way."), "{prompt}");
    assert!(
        !prompt.contains(dir.to_str().unwrap()),
        "no global path in the prompt"
    );
    let text = prompt.find("Draw it the shared way.").unwrap();
    let payload = prompt.find("\"focus\": \"auth\"").unwrap();
    assert!(text < payload, "the instructions come before the payload");
}

#[test]
fn a_project_limit_of_zero_switches_jobs_off_there_only() {
    let s = setup(JobLimits::default());
    let project = s.p.path().to_string();
    s.h.host
        .policy
        .lock()
        .unwrap()
        .project_daily_limits
        .insert(project, 0);
    let refused = create(&s, Value::Null).unwrap_err();
    assert_eq!(refused.code, "quota_exceeded");
    assert_eq!(refused.reason.as_deref(), Some("disabled"));
    assert!(
        refused.message.contains("its daily limit is 0"),
        "{}",
        refused.message
    );
    assert!(s.h.backend.requests.lock().unwrap().is_empty(), "no spawn");
}

fn create_for(s: &Setup, key: &str) -> Result<Value, LinkError> {
    let line = json!({
        "v": 1, "id": 1, "method": "jobs.create",
        "params": { "project": s.p.path(), "kind": "diagram.draw", "payload": null,
                    "supervisor": key }
    });
    ask(&s.h.link, &line.to_string())
}

#[test]
fn a_job_for_a_supervisor_records_it_and_pings_whoever_carries_the_key_at_the_end() {
    let s = setup(JobLimits::default());
    s.h.backend.agents.lock().unwrap()[0].supervisor_key = Some("mail-triage".into());
    assert_eq!(
        create_for(&s, "docs").unwrap_err().code,
        "unknown_supervisor"
    );
    assert!(
        s.h.backend.requests.lock().unwrap().is_empty(),
        "nothing started"
    );

    let started = create_for(&s, "mail-triage").unwrap();
    let job_id = started["jobId"].as_str().unwrap().to_string();
    let job = s.h.link.jobs().get(&job_id).unwrap();
    assert_eq!(
        job.requested_by,
        Some(jobs::RequestedBy {
            key: "mail-triage".into(),
            agent_id: "agent-1".into()
        })
    );

    // The supervisor was resumed meanwhile: a new id under the same key.
    {
        let mut agents = s.h.backend.agents.lock().unwrap();
        agents[0].id = "agent-11".into();
    }
    std::fs::write(s.worktree.join("docs/auth.diagram.json"), r#"{"nodes":[]}"#).unwrap();
    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let written = s.h.backend.written.lock().unwrap().clone();
    assert_eq!(written.len(), 1, "{written:?}");
    assert_eq!(written[0].0, "agent-11");
    assert!(written[0].1.contains(&job_id), "{}", written[0].1);
    assert!(written[0].1.contains("finished"), "{}", written[0].1);
    assert!(
        !written[0].1.contains("  "),
        "one space between words: {}",
        written[0].1
    );
    assert_eq!(
        s.h.host.notified.lock().unwrap().len(),
        1,
        "the inbox still hears of it"
    );
}

#[test]
fn a_job_nobody_asked_for_pings_no_supervisor() {
    let s = setup(JobLimits::default());
    create(&s, Value::Null).unwrap();
    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    assert!(s.h.backend.written.lock().unwrap().is_empty());
    assert_eq!(s.h.link.jobs().list(None, None, 1)[0].requested_by, None);
}

#[test]
fn a_supervisor_subscription_hears_its_own_jobs_progress_and_end_only() {
    let s = setup(JobLimits::default());
    s.h.backend.agents.lock().unwrap()[0].supervisor_key = Some("mail-triage".into());
    let subscribe = |filter: &str| {
        let reply = s.h.link.handle(
            parse_message(&format!(
                r#"{{"v":1,"id":1,"method":"events.subscribe","params":{{"supervisors":["{filter}"]}}}}"#
            ))
            .unwrap()
            .1,
        );
        let Some(Install::Set(subscription)) = reply.install else {
            panic!("subscribe installs a subscription");
        };
        *subscription
    };
    let mut mine = subscribe("mail-triage");
    let mut other = subscribe("night-shift");
    create_for(&s, "mail-triage").unwrap();
    std::fs::write(s.worktree.join("docs/auth.diagram.json"), r#"{"nodes":[]}"#).unwrap();
    s.h.link.tick_jobs(jobs::now_ms());
    set_status(&s, AgentStatus::Idle);
    s.h.link.tick_jobs(jobs::now_ms());
    let names: Vec<&str> = mine
        .poll_jobs(s.h.link.jobs())
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    assert_eq!(names, vec!["job.started", "job.progress", "job.finished"]);
    assert!(other.poll_jobs(s.h.link.jobs()).is_empty());
}
