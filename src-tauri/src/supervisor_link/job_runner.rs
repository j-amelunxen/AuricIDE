//! `jobs.create`, `jobs.cancel` and the tick that follows running jobs to
//! their end (`docs/design-supervisor-link.md`, "Jobs").

use super::documents::{self, head_commit, open_root_repo, read_contained, visible_project};
use super::jobs::{self, check_quota, quota_message, Collected, JobError, JobErrorCode, JobRecord};
use super::policy::{is_relative_file, JobKind, LinkPolicy};
use super::protocol::{CreateJobParams, JobStatus, LinkError};
use super::{notification, short, to_value, Link};
use crate::agents::AgentStatus;
use crate::control_socket::protocol::{AgentIdParams, Request};
use crate::control_socket::LinkSpawn;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;

fn new_job_id() -> String {
    let hex: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(12)
        .collect();
    format!("job-{hex}")
}

/// Steps 1 and 2 of `jobs.create`: a visible project, a kind it lists, the
/// kind's instructions file, a repository with a commit. Answers the
/// project's canonical path, the kind and what the kind may write.
fn checked_kind(
    policy: &LinkPolicy,
    params: &CreateJobParams,
) -> Result<(String, JobKind, Vec<String>), LinkError> {
    let (root, config) = visible_project(policy, &params.project)?;
    let project = documents::path_string(&root);
    let Some(kind) = config.job_kind(&params.kind) else {
        let known: Vec<&str> = config.job_kinds.iter().map(|k| k.kind.as_str()).collect();
        return Err(LinkError::new(
            "job_kind_not_allowed",
            format!(
                "job kind \"{}\" is not allowed in {project} (allowed: {})",
                params.kind,
                if known.is_empty() {
                    "none".to_string()
                } else {
                    known.join(", ")
                }
            ),
        ));
    };
    if !is_relative_file(&kind.instructions) || read_contained(&root, &kind.instructions)?.is_none()
    {
        return Err(LinkError::invalid_params(format!(
            "the instructions of job kind \"{}\" ({}) are not a file in {project}",
            kind.kind, kind.instructions
        )));
    }
    let repo = open_root_repo(&root)?;
    head_commit(&repo, &root)?;
    drop(repo);
    let writes = config.writes_of(kind);
    Ok((project, kind.clone(), writes))
}

/// A running job's record right after its agent started. Branch, worktree
/// and base stay empty when the agent did not get a worktree of its own.
fn started_record(
    job_id: String,
    project: String,
    kind: String,
    payload: Value,
    spawned: LinkSpawn,
    now: u64,
) -> JobRecord {
    let head = spawned
        .repo_path
        .as_deref()
        .filter(|path| Path::new(path) != Path::new(&project))
        .and_then(|path| jobs::worktree_head(Path::new(path)));
    JobRecord {
        job_id,
        project,
        kind,
        payload,
        status: JobStatus::Running,
        agent_id: spawned.agent_id,
        provider: spawned.provider,
        model: spawned.model,
        branch: head.as_ref().map(|(branch, _)| branch.clone()),
        worktree: head.as_ref().and(spawned.repo_path),
        base: head.map(|(_, commit)| commit),
        created_at: now,
        finished_at: None,
        commit: None,
        changed: Vec::new(),
        documents: Vec::new(),
        files: Vec::new(),
        other_files: Vec::new(),
        error: None,
        cancel_requested: false,
        cancel_reason: None,
    }
}

/// How a job's agent ended, as the tick sees it.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    Exited,
    Failed,
}

impl Link {
    /// Step 3: room under the counter, or `quota_exceeded` naming the limit.
    fn check_room(&self, policy: &LinkPolicy, project: &str, now: u64) -> Result<(), LinkError> {
        let (in_window, in_project) = self.jobs.count_in_window(project, now);
        if let Err(reason) = check_quota(&policy.jobs, in_window, in_project) {
            let mut error = LinkError::new(
                "quota_exceeded",
                quota_message(reason, &policy.jobs, &self.jobs, project, now),
            );
            error.reason = Some(reason.to_string());
            return Err(error);
        }

        Ok(())
    }

    /// Starts one job: visible project, a configured kind, a repository with
    /// a commit, room under the counter, then the agent under the supervisor
    /// policy. Nothing is counted for a request that is refused before the
    /// agent starts.
    pub(super) fn create_job(
        &self,
        policy: &LinkPolicy,
        params: CreateJobParams,
    ) -> Result<Value, LinkError> {
        let (project, kind, writes) = checked_kind(policy, &params)?;
        let _creating = self
            .create_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = jobs::now_ms();
        self.check_room(policy, &project, now)?;

        let job_id = new_job_id();
        let prompt = jobs::prompt(
            &job_id,
            &kind.kind,
            &kind.instructions,
            &writes,
            &params.payload,
        );
        let link_agents: BTreeSet<String> = self.jobs.agent_ids().into_iter().collect();
        let spawned = self
            .dispatcher
            .spawn_for_link(
                &project,
                prompt,
                format!("{} {job_id}", kind.kind),
                &link_agents,
            )
            .map_err(LinkError::from)?;
        let agent_id = spawned.agent_id.clone();
        let mut job = started_record(
            job_id.clone(),
            project,
            kind.kind.clone(),
            params.payload,
            spawned,
            now,
        );
        if job.worktree.is_none() {
            // Without its own worktree the agent would write into the
            // human's checkout. It is stopped, and the job counts: it started.
            let _ = self
                .dispatcher
                .dispatch_external(Request::Kill(AgentIdParams { agent_id }));
            job.status = JobStatus::Failed;
            job.finished_at = Some(now);
            job.error = Some(JobError {
                code: JobErrorCode::Internal,
                message: "the agent did not get a worktree of its own and was stopped".into(),
            });
        }
        self.jobs.start(job.clone(), now);
        if job.status == JobStatus::Failed {
            self.jobs.update(&job.job_id, now, |stored| {
                Some(("job.failed", json!({ "job": stored })))
            });
            return Err(LinkError::new(
                "internal",
                "the job's agent did not get a worktree",
            ));
        }
        to_value(json!({
            "jobId": job.job_id,
            "agentId": job.agent_id,
            "branch": job.branch,
            "base": job.base,
            "provider": job.provider,
            "model": job.model,
        }))
    }

    /// Stops a running job's agent; the next tick books it as `cancelled`.
    /// A job that already ended answers `cancelled: false` with its status.
    pub(super) fn cancel_job(&self, job_id: &str) -> Result<Value, LinkError> {
        let Some(job) = self.jobs.get(job_id) else {
            return Err(LinkError::new("unknown_job", format!("no job {job_id}")));
        };
        if job.status != JobStatus::Running {
            return Ok(json!({ "jobId": job_id, "cancelled": false, "status": job.status }));
        }
        self.request_cancel(&job, None);
        Ok(json!({ "jobId": job_id, "cancelled": true, "status": "running" }))
    }

    /// Marks the job cancelled and stops its agent. The kill is repeated by
    /// every tick while the agent still runs, so a cancel that lands while
    /// the agent is still starting is not lost.
    fn request_cancel(&self, job: &JobRecord, reason: Option<String>) {
        self.jobs.update(&job.job_id, jobs::now_ms(), |stored| {
            stored.cancel_requested = true;
            if stored.cancel_reason.is_none() {
                stored.cancel_reason = reason;
            }
            None
        });
        self.kill_agent(&job.agent_id);
    }

    fn kill_agent(&self, agent_id: &str) {
        // An agent that already stopped is fine: the tick ends the job either way.
        let _ = self
            .dispatcher
            .dispatch_external(Request::Kill(AgentIdParams {
                agent_id: agent_id.to_string(),
            }));
    }

    /// Why a running job may not go on: its project is no longer shared or
    /// no longer lists its kind. The link must not keep acting in a project
    /// the human withdrew.
    fn withdrawn(policy: &LinkPolicy, job: &JobRecord) -> Option<String> {
        let Some((_, config)) = policy.project(&job.project) else {
            return Some(format!(
                "{} is no longer shared with the supervisor link; the job was stopped",
                job.project
            ));
        };
        if config.job_kind(&job.kind).is_none() {
            return Some(format!(
                "job kind \"{}\" is no longer allowed in {}; the job was stopped",
                job.kind, job.project
            ));
        }
        None
    }

    /// Looks at every running job once: progress while its agent runs, the
    /// result once it stopped.
    pub fn tick_jobs(&self, now: u64) {
        let running = self.jobs.running();
        if running.is_empty() {
            return;
        }
        let policy = self.host.policy();
        let agents = self.dispatcher.summaries();
        for job in running {
            let status = agents
                .iter()
                .find(|agent| agent.info.id == job.agent_id)
                .map(|agent| agent.info.status.clone());
            match status {
                Some(AgentStatus::Running | AgentStatus::Queued) => {
                    if let Some(reason) = Self::withdrawn(&policy, &job) {
                        self.request_cancel(&job, Some(reason));
                    } else if job.cancel_requested {
                        self.kill_agent(&job.agent_id);
                    } else {
                        self.job_progress(&job, now);
                    }
                }
                Some(AgentStatus::Error) => self.finish_job(&job, Ending::Failed, now),
                // Idle, or the card was cleared: the run is over.
                _ => self.finish_job(&job, Ending::Exited, now),
            }
        }
    }

    fn job_progress(&self, job: &JobRecord, now: u64) {
        let (Some(worktree), Some(base)) = (&job.worktree, &job.base) else {
            return;
        };
        let policy = self.host.policy();
        let Some((_, config)) = policy.project(&job.project) else {
            return;
        };
        let Some(kind) = config.job_kind(&job.kind) else {
            return;
        };
        let Ok(changed) = jobs::changed_since(Path::new(worktree), base) else {
            return;
        };
        let changed = jobs::writable(changed, &config.writes_of(kind));
        if changed == job.changed {
            return;
        }
        self.jobs.update(&job.job_id, now, |stored| {
            stored.changed = changed;
            Some((
                "job.progress",
                json!({
                    "jobId": stored.job_id,
                    "project": stored.project,
                    "kind": stored.kind,
                    "agentId": stored.agent_id,
                    "branch": stored.branch,
                    "changed": stored.changed,
                    "elapsedMs": now.saturating_sub(stored.created_at),
                }),
            ))
        });
    }

    /// What the branch holds, after committing what the agent left in the
    /// paths it may write. `Err` is a message for an `internal` failure.
    fn collect_job(&self, job: &JobRecord) -> Result<Collected, String> {
        let (Some(worktree), Some(base)) = (&job.worktree, &job.base) else {
            return Err("the job has no worktree".into());
        };
        let policy = self.host.policy();
        let Some((_, config)) = policy.project(&job.project) else {
            return Err(format!(
                "{} is no longer shared with the supervisor link",
                job.project
            ));
        };
        let writes = config
            .job_kind(&job.kind)
            .map(|kind| config.writes_of(kind))
            .unwrap_or_default();
        let worktree = Path::new(worktree);
        let message = format!(
            "{}: {} (left uncommitted by the agent)",
            job.kind, job.job_id
        );
        jobs::commit_leftovers(worktree, &writes, &message).map_err(|error| error.message)?;
        jobs::collect(worktree, base, config, &writes).map_err(|error| error.message)
    }

    fn finish_job(&self, job: &JobRecord, ending: Ending, now: u64) {
        let collected = self.collect_job(job);
        let error = match (&collected, job.cancel_requested, ending) {
            (_, true, _) => Some((
                JobErrorCode::Cancelled,
                job.cancel_reason
                    .clone()
                    .unwrap_or_else(|| "cancelled over the supervisor link".to_string()),
            )),
            (Err(message), _, _) => Some((JobErrorCode::Internal, message.clone())),
            (Ok(found), _, _) if !found.invalid.is_empty() => {
                Some((JobErrorCode::DocumentInvalid, found.invalid.join("; ")))
            }
            (Ok(_), _, Ending::Failed) => Some((
                JobErrorCode::AgentFailed,
                "the agent ended with an error".to_string(),
            )),
            (Ok(found), _, Ending::Exited) if found.changed.is_empty() => Some((
                JobErrorCode::NoChanges,
                "the agent ended without changing a file it may write".to_string(),
            )),
            _ => None,
        };
        let mut ended = None;
        self.jobs.update(&job.job_id, now, |stored| {
            if let Ok(found) = collected {
                stored.commit = Some(found.commit);
                stored.changed = found.changed;
                stored.documents = found.documents;
                stored.files = found.files;
                stored.other_files = found.other_files;
            }
            stored.finished_at = Some(now);
            let name = match error {
                Some((code, message)) => {
                    stored.status = JobStatus::Failed;
                    stored.error = Some(JobError { code, message });
                    "job.failed"
                }
                None => {
                    stored.status = JobStatus::Finished;
                    "job.finished"
                }
            };
            ended = Some(stored.clone());
            Some((name, json!({ "job": stored })))
        });
        if let Some(job) = ended {
            self.host.notify(job_notification(&job));
        }
    }
}

fn job_notification(job: &JobRecord) -> super::NotificationInput {
    let branch = job.branch.as_deref().unwrap_or("(none)");
    let commit = job.commit.as_deref().map(short).unwrap_or("-");
    let outside = if job.other_files.is_empty() {
        String::new()
    } else {
        format!(
            " It also changed {} file(s) outside what it may write; check those before merging.",
            job.other_files.len()
        )
    };
    match &job.error {
        None => notification(
            &job.project,
            format!("Job {} finished: {}", job.kind, job.job_id),
            format!(
                "A supervisor link client asked for it. {} document(s) and {} other file(s) are \
                 on branch {branch} (commit {commit}). Nothing in your working tree changed. \
                 Review the branch in the Git panel, then merge it or delete it.{outside}",
                job.documents.len(),
                job.files.len()
            ),
        ),
        Some(error) => notification(
            &job.project,
            format!("Job {} failed: {}", job.kind, job.job_id),
            format!("{} Branch: {branch}.{outside}", error.message),
        ),
    }
}
