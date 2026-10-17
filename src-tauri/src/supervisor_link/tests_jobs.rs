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
        .any(|agent| agent.info.id == "agent-7"));
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
