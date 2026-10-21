//! Turns the supervisor tree, the agents' output buffers and the job
//! register into the link's events. Pure: the caller hands in the tree, a way
//! to read output and the register, so the diffing is tested without a socket
//! or an app.

use super::jobs::{Jobs, RequestedBy};
use super::protocol::SubscribeParams;
use super::subtree::{Coverage, Filter, JobRef};
use super::LinkAgent;
use crate::agents::AgentInfo;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// What `agent.updated` reacts to. `lastActivityAt` and `outputBytes` are left
/// out on purpose: they move with every line, and output has its own event.
#[derive(Debug, Clone, PartialEq)]
struct Fingerprint {
    status: String,
    name: String,
    current_task: Option<String>,
    project_path: Option<String>,
    repo_path: Option<String>,
}

impl Fingerprint {
    fn of(agent: &LinkAgent) -> Self {
        let info = &agent.summary.info;
        Self {
            status: serde_json::to_string(&info.status).unwrap_or_default(),
            name: info.name.clone(),
            current_task: info.current_task.clone(),
            project_path: info.project_path.clone(),
            repo_path: info.repo_path.clone(),
        }
    }
}

/// The job register as the subtree filter reads it: each job's agent and
/// the supervisor it was created for.
pub type Requesters = [(String, Option<RequestedBy>)];

fn coverage_of(filter: &Filter, tree: &[LinkAgent], requesters: &Requesters) -> Coverage {
    let agents: Vec<AgentInfo> = tree
        .iter()
        .map(|agent| agent.summary.info.clone())
        .collect();
    let jobs: Vec<JobRef> = requesters
        .iter()
        .map(|(agent_id, requested_by)| JobRef {
            agent_id,
            requested_by: requested_by.as_ref(),
        })
        .collect();
    filter.coverage(&agents, &jobs)
}

#[derive(Debug)]
pub struct Subscription {
    /// No filter: the whole tree, agents that join later included. With
    /// `supervisors`, their subtrees as they stand at each poll.
    filter: Filter,
    coverage: Coverage,
    output: bool,
    known: BTreeMap<String, Fingerprint>,
    /// Per agent, the output offset the next `agent.output` starts at.
    offsets: BTreeMap<String, u64>,
    /// `None`: no `job.*` events. Otherwise the last register event sent.
    job_cursor: Option<u64>,
}

impl Subscription {
    /// The baseline is the tree as the subscribe response shows it: nothing in
    /// it is announced again, and output starts where it stands now unless the
    /// client named an offset to continue from.
    pub fn start(
        params: &SubscribeParams,
        tree: &[LinkAgent],
        requesters: &Requesters,
        job_cursor: u64,
    ) -> Self {
        let filter = Filter {
            agent_ids: params
                .agent_ids
                .as_ref()
                .map(|ids| ids.iter().cloned().collect()),
            supervisors: params.supervisors.clone(),
        };
        let mut subscription = Self {
            coverage: coverage_of(&filter, tree, requesters),
            filter,
            output: params.output.unwrap_or(true),
            known: BTreeMap::new(),
            offsets: BTreeMap::new(),
            job_cursor: params.jobs.unwrap_or(true).then_some(job_cursor),
        };
        let since = params.since_offsets.clone().unwrap_or_default();
        for agent in tree {
            let id = &agent.summary.info.id;
            if !subscription.covers(id) {
                continue;
            }
            subscription
                .known
                .insert(id.clone(), Fingerprint::of(agent));
            let from = since.get(id).copied().unwrap_or(agent.summary.output_bytes);
            subscription.offsets.insert(id.clone(), from);
        }
        subscription
    }

    /// The register's events since the last call, when jobs are subscribed:
    /// all of them, or with `supervisors` those of the jobs they asked for.
    pub fn poll_jobs(&mut self, jobs: &Jobs) -> Vec<(&'static str, Value)> {
        let Some(cursor) = self.job_cursor.as_mut() else {
            return Vec::new();
        };
        let coverage = &self.coverage;
        jobs.events_after(cursor)
            .into_iter()
            .filter(|event| {
                // `job.progress` carries the job id only; the register knows
                // who asked for it.
                let job_id = event
                    .data
                    .get("job")
                    .unwrap_or(&event.data)
                    .get("jobId")
                    .and_then(Value::as_str);
                let requested_by = job_id
                    .and_then(|id| jobs.get(id))
                    .and_then(|job| job.requested_by);
                coverage.covers_job(requested_by.as_ref())
            })
            .map(|event| (event.name, event.data))
            .collect()
    }

    pub fn covers(&self, agent_id: &str) -> bool {
        self.coverage.covers_agent(agent_id)
    }

    /// The events since the last poll, in the order they should go out: list
    /// changes first, so an agent is announced before its first output.
    pub fn poll(
        &mut self,
        tree: &[LinkAgent],
        requesters: &Requesters,
        read_since: impl Fn(&str, u64) -> Option<Value>,
    ) -> Vec<(&'static str, Value)> {
        self.coverage = coverage_of(&self.filter, tree, requesters);
        let mut events = Vec::new();
        let covered: Vec<&LinkAgent> = tree
            .iter()
            .filter(|agent| self.covers(&agent.summary.info.id))
            .collect();

        for agent in &covered {
            let id = &agent.summary.info.id;
            let now = Fingerprint::of(agent);
            match self.known.get(id) {
                None => {
                    events.push(("agent.added", json!({ "agent": agent })));
                    // A newcomer's console is new in full.
                    self.offsets.insert(id.clone(), 0);
                }
                Some(before) if *before != now => {
                    events.push(("agent.updated", json!({ "agent": agent })));
                }
                Some(_) => {}
            }
            self.known.insert(id.clone(), now);
        }

        let present: BTreeSet<&str> = covered.iter().map(|a| a.summary.info.id.as_str()).collect();
        let gone: Vec<String> = self
            .known
            .keys()
            .filter(|id| !present.contains(id.as_str()))
            .cloned()
            .collect();
        for id in gone {
            self.known.remove(&id);
            self.offsets.remove(&id);
            events.push(("agent.removed", json!({ "agentId": id })));
        }

        if self.output {
            for agent in &covered {
                let id = &agent.summary.info.id;
                let since = self.offsets.get(id).copied().unwrap_or(0);
                if agent.summary.output_bytes <= since {
                    continue;
                }
                let Some(chunk) = read_since(id, since) else {
                    continue;
                };
                if let Some(end) = chunk.get("endOffset").and_then(Value::as_u64) {
                    self.offsets.insert(id.clone(), end);
                }
                let empty = chunk
                    .get("text")
                    .and_then(Value::as_str)
                    .map_or(true, str::is_empty);
                if !empty {
                    events.push(("agent.output", chunk));
                }
            }
        }
        events
    }
}
