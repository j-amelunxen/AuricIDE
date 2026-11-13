//! `jobs.create`, `jobs.cancel` and the tick that follows running jobs to
//! their end (`docs/design-supervisor-link.md`, "Jobs").

use super::documents::{self, head_commit, open_root_repo, visible_project};
use super::instructions::{self, Instructions};
use super::jobs::{self, check_quota, quota_message, Collected, JobError, JobErrorCode, JobRecord};
use super::policy::{JobKind, LinkPolicy};
use super::protocol::{CreateJobParams, JobStatus, LinkError};
use super::{notification, short, to_value, Link};
use crate::agents::AgentStatus;
use crate::control_socket::protocol::{AgentIdParams, ErrorCode, Request};
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

/// What steps 1 and 2 of `jobs.create` settled.
struct CheckedKind {
    /// The project's canonical path.
    project: String,
    kind: JobKind,
    instructions: Instructions,
    /// What the kind may write.
    writes: Vec<String>,
}

/// Steps 1 and 2 of `jobs.create`: a visible project, a kind it lists, the
/// kind's instructions (the project's file, else the global one), a
/// repository with a commit.
fn checked_kind(policy: &LinkPolicy, params: &CreateJobParams) -> Result<CheckedKind, LinkError> {
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
    let instructions =
        instructions::resolve(kind, &root, &project, policy.job_kinds_dir.as_deref())
            .map_err(|unusable| LinkError::invalid_params(unusable.0))?;
    let repo = open_root_repo(&root)?;
    head_commit(&repo, &root)?;
    drop(repo);
    let writes = config.writes_of(kind);
    Ok(CheckedKind {
        project,
        kind: kind.clone(),
        instructions,
        writes,
    })
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
        requested_by: None,
        cancel_reason: None,
    }
}

/// How a job's agent ended, as the tick sees it.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Ending {
    Exited,
    /// A non-zero exit.
    Failed,
    /// Stopped from outside (`agents.kill`, the Stop button), not by the job.
    Killed,
}

/// How long a job's agent may be missing from the list with no end booked
/// before the job is closed anyway. The manager drops a process from the list
/// first and books its exit a moment later; a tick landing in between waits.
pub(super) const VANISHED_GRACE_MS: u64 = 10_000;

impl Link {
    /// Step 3: room under the counter, or `quota_exceeded` naming the limit.
    fn check_room(&self, policy: &LinkPolicy, project: &str, now: u64) -> Result<(), LinkError> {
        let (in_window, in_project) = self.jobs.count_in_window(project, now);
        let limits = policy.limits_for(project);
        if let Err(reason) = check_quota(&limits, in_window, in_project) {
            let mut error = LinkError::new(
                "quota_exceeded",
                quota_message(reason, &limits, &self.jobs, project, now),
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
        let requested_by = match params.supervisor.as_deref() {
            Some(key) => Some(jobs::RequestedBy {
                key: key.to_string(),
                agent_id: self.supervisor_for_key(key)?.id,
            }),
            None => None,
        };
        let CheckedKind {
            project,
            kind,
            instructions,
            writes,
        } = checked_kind(policy, &params)?;
        let _creating = self
            .create_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = crate::json_store::now_ms();
        self.check_room(policy, &project, now)?;

        let job_id = new_job_id();
        let prompt = jobs::prompt(&job_id, &kind.kind, &instructions, &writes, &params.payload);
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
        let mut job = started_record(
            job_id.clone(),
            project,
            kind.kind.clone(),
            params.payload,
            spawned,
            now,
        );
        job.requested_by = requested_by;
        let unsafe_launch = job.worktree.is_none();
        // Count the launched agent and persist its stop intent before asking
        // the frontend. A failed stop must remain visible to later ticks.
        job.cancel_requested = unsafe_launch;
        self.jobs.start(job.clone(), now);
        if unsafe_launch {
            let stop = match self.stop_job_agent(&job) {
                Ok(()) => "stop requested; the next tick will observe its ending".to_string(),
                Err(error) => format!(
                    "stop failed ({}: {}); stopping will be retried",
                    error.code, error.message
                ),
            };
            return Err(LinkError::new(
                "internal",
                format!(
                    "job {} agent {} did not get a worktree of its own; {stop}",
                    job.job_id, job.agent_id
                ),
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
        self.request_cancel(&job, None).map_err(|mut error| {
            error.message = format!(
                "cancellation requested for job {} agent {}; stop failed: {}; \
                 stopping will be retried",
                job.job_id, job.agent_id, error.message
            );
            error
        })?;
        Ok(json!({ "jobId": job_id, "cancelled": true, "status": "running" }))
    }

    /// Marks the job cancelled and stops its agent. The kill is repeated by
    /// every tick while the agent still runs, so a cancel that lands while
    /// the agent is still starting is not lost.
    fn request_cancel(&self, job: &JobRecord, reason: Option<String>) -> Result<(), LinkError> {
        let mut running = false;
        self.jobs
            .update(&job.job_id, crate::json_store::now_ms(), |stored| {
                if stored.status != JobStatus::Running {
                    return None;
                }
                running = true;
                stored.cancel_requested = true;
                if stored.cancel_reason.is_none() {
                    stored.cancel_reason = reason;
                }
                None
            });
        if !running {
            return Ok(());
        }
        self.stop_job_agent(job)
    }

    fn kill_agent(&self, agent_id: &str) -> Result<(), LinkError> {
        let outcome = self
            .dispatcher
            .dispatch_external(Request::Kill(AgentIdParams {
                agent_id: agent_id.to_string(),
            }));
        let live = self.dispatcher.summaries().iter().any(|agent| {
            agent.info.id == agent_id
                && matches!(
                    agent.info.status,
                    AgentStatus::Running | AgentStatus::Queued
                )
        });
        match outcome {
            Ok(_) if live => Err(LinkError::new(
                "internal",
                format!("the IDE reported {agent_id} killed, but it is still running or queued"),
            )),
            Ok(_) => Ok(()),
            // Only the typed already-gone cases are benign, and never while
            // the backend still lists a live agent under the same id.
            Err(error)
                if !live
                    && matches!(
                        error.code,
                        ErrorCode::UnknownAgent | ErrorCode::AgentNotRunning
                    ) =>
            {
                Ok(())
            }
            Err(error) => Err(LinkError::from(error)),
        }
    }

    fn stop_job_agent(&self, job: &JobRecord) -> Result<(), LinkError> {
        let outcome = self.kill_agent(&job.agent_id);
        let mut failures = self.stop_failures.lock().unwrap_or_else(|p| p.into_inner());
        if !self
            .jobs
            .get(&job.job_id)
            .is_some_and(|stored| stored.status == JobStatus::Running)
        {
            failures.remove(&job.job_id);
            return outcome;
        }
        let Err(error) = &outcome else {
            failures.remove(&job.job_id);
            return outcome;
        };
        let changed = failures.get(&job.job_id) != Some(error);
        failures.insert(job.job_id.clone(), error.clone());
        drop(failures);
        eprintln!(
            "Supervisor link: could not stop job {} agent {}: {}: {}; will retry",
            job.job_id, job.agent_id, error.code, error.message
        );
        if changed {
            self.host.notify(notification(
                &job.project,
                format!("Could not stop job {}", job.job_id),
                format!(
                    "Agent {} may still be running. {}: {}. AuricIDE will retry the stop; \
                     the job remains running until its ending is observed.",
                    job.agent_id, error.code, error.message
                ),
            ));
        }
        outcome
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
            let listed = agents
                .iter()
                .find(|agent| agent.info.id == job.agent_id)
                .map(|agent| agent.info.status.clone());
            if let Some(AgentStatus::Running | AgentStatus::Queued) = listed {
                if let Some(reason) = Self::withdrawn(&policy, &job) {
                    if self.request_cancel(&job, Some(reason)).is_err() {
                        // stop_job_agent reported it; the persisted intent
                        // remains for the next tick.
                        continue;
                    }
                } else if job.cancel_requested || job.worktree.is_none() {
                    if self.request_cancel(&job, None).is_err() {
                        continue;
                    }
                } else {
                    self.job_progress(&job, now);
                }
                continue;
            }
            let ending = self.ending_of(&job.agent_id).or(match listed {
                Some(AgentStatus::Error) => Some(Ending::Failed),
                Some(_) => Some(Ending::Exited),
                None => None,
            });
            match ending {
                Some(ending) => self.finish_job(&job, ending, now),
                // How it ended does not matter for a cancelled job, and past
                // the grace nothing will say any more (a result evicted, a
                // card cleared long ago): booked as an ordinary exit.
                None if job.cancel_requested
                    || self.missing_for(&job.agent_id, now) >= VANISHED_GRACE_MS =>
                {
                    self.finish_job(&job, Ending::Exited, now)
                }
                None => {}
            }
        }
    }

    /// How a stopped agent ended, from what the IDE booked when it stopped:
    /// the run result (no exit code is a kill), else the status its output
    /// buffer was closed with. `None` while nothing is booked yet. The agent
    /// list cannot answer this: a finished agent leaves it at once.
    fn ending_of(&self, agent_id: &str) -> Option<Ending> {
        if let Some(result) = self.dispatcher.run_result(agent_id) {
            return Some(match (result.status, result.exit_code) {
                (_, None) => Ending::Killed,
                (AgentStatus::Error, Some(_)) => Ending::Failed,
                _ => Ending::Exited,
            });
        }
        match self.dispatcher.final_status(agent_id)? {
            AgentStatus::Error => Some(Ending::Failed),
            _ => Some(Ending::Exited),
        }
    }

    /// For how long the tick has found `agent_id` gone with no end booked.
    fn missing_for(&self, agent_id: &str, now: u64) -> u64 {
        let mut vanished = self
            .vanished
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        now.saturating_sub(*vanished.entry(agent_id.to_string()).or_insert(now))
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
        self.vanished
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&job.agent_id);
        let collected = self.collect_job(job);
        let mut ended = None;
        self.jobs.update(&job.job_id, now, |stored| {
            // A simultaneous tick can hold the same old running snapshot.
            // Only the first terminal update publishes an ending and notice.
            if stored.status != JobStatus::Running {
                return None;
            }
            let error = match (&collected, stored.cancel_requested, ending) {
                // This Option records whether the launch obtained its own
                // worktree, not whether that directory still exists now.
                (_, _, _) if stored.worktree.is_none() => Some((
                    JobErrorCode::Internal,
                    "the agent did not get a worktree of its own".to_string(),
                )),
                (_, true, _) => Some((
                    JobErrorCode::Cancelled,
                    stored
                        .cancel_reason
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
                (Ok(_), _, Ending::Killed) => Some((
                    JobErrorCode::AgentFailed,
                    "the agent was stopped before it finished".to_string(),
                )),
                (Ok(found), _, Ending::Exited) if found.changed.is_empty() => Some((
                    JobErrorCode::NoChanges,
                    "the agent ended without changing a file it may write".to_string(),
                )),
                _ => None,
            };
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
        self.stop_failures
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&job.job_id);
        if let Some(job) = ended {
            self.host.notify(job_notification(&job));
            self.ping_requester(&job);
        }
    }

    /// Tells the supervisor that asked for the job that it ended, in its
    /// console like a finished child. Whoever carries the key now is told
    /// first, so a resumed supervisor hears of it; else the agent that asked,
    /// if it still runs. Nobody listening: the inbox notification stands.
    fn ping_requester(&self, job: &JobRecord) {
        let Some(by) = &job.requested_by else {
            return;
        };
        let target = self
            .dispatcher
            .supervisor_by_key(&by.key)
            .map_or_else(|| by.agent_id.clone(), |supervisor| supervisor.id);
        self.dispatcher
            .ping_supervisor_text(&target, &job_notice(job));
    }
}

/// The notice the requesting supervisor gets when its job ends.
fn job_notice(job: &JobRecord) -> String {
    let branch = job.branch.as_deref().unwrap_or("(none)");
    let outcome = match &job.error {
        None => format!(
            "finished: {} document(s) and {} other file(s) on branch {branch}",
            job.documents.len(),
            job.files.len()
        ),
        Some(error) => format!("failed: {}", error.message),
    };
    format!(
        "[AuricIDE] Job {} {} you asked for {outcome}. The human reviews and merges the \
         branch. This notice comes from the IDE, not from the human.",
        job.kind, job.job_id
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{output_buffer::OutputBuffers, run_results::RunResults};
    use crate::control_socket::{tests::FakeBackend, Dispatcher, PendingRequests};
    use crate::supervisor_link::{jobs::Jobs, LinkHost, NotificationInput};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[derive(Default)]
    struct Host(Mutex<Vec<NotificationInput>>);

    impl LinkHost for Host {
        fn policy(&self) -> LinkPolicy {
            LinkPolicy::default()
        }
        fn notify(&self, input: NotificationInput) {
            self.0.lock().unwrap().push(input);
        }
    }

    #[test]
    fn a_stale_finish_snapshot_cannot_publish_a_second_terminal_event_or_notice() {
        let dispatcher = Arc::new(Dispatcher::new(
            Arc::new(FakeBackend::default()),
            Arc::new(OutputBuffers::default()),
            Arc::new(PendingRequests::default()),
            Arc::new(RunResults::default()),
            Duration::from_millis(1),
        ));
        let host = Arc::new(Host::default());
        let link = Link::with_jobs(dispatcher, host.clone(), Arc::new(Jobs::default()));
        let mut job = started_record(
            "job-stale".into(),
            "/project".into(),
            "diagram.draw".into(),
            Value::Null,
            LinkSpawn {
                agent_id: "agent-7".into(),
                provider: "claude".into(),
                model: "small".into(),
                repo_path: None,
            },
            1,
        );
        job.worktree = Some("/missing-worktree".into());
        job.base = Some("missing-base".into());
        link.jobs.start(job.clone(), 1);
        link.request_cancel(&job, None).unwrap();
        let mut cursor = link.jobs.cursor();
        link.finish_job(&job, Ending::Exited, 2);
        link.finish_job(&job, Ending::Exited, 3);
        assert_eq!(link.jobs.events_after(&mut cursor).len(), 1);
        assert_eq!(host.0.lock().unwrap().len(), 1);
        assert_eq!(link.jobs.get(&job.job_id).unwrap().finished_at, Some(2));
        let ended = link.jobs.get(&job.job_id).unwrap();
        link.request_cancel(&job, Some("late withdrawal".into()))
            .unwrap();
        assert_eq!(link.jobs.get(&job.job_id).unwrap(), ended);
        assert_eq!(
            link.jobs.get(&job.job_id).unwrap().error.unwrap().code,
            JobErrorCode::Cancelled,
            "cancellation after the snapshot wins over the collector error"
        );
    }
}
