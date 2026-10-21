//! Supervisor subtrees over one agent list: which agents and jobs an
//! `events.subscribe { supervisors }` covers, the topmost supervisor of each
//! agent (`LinkAgent.rootSupervisorId`) and the rows of `supervisors.list`.
//! Pure; the fixture is `subtree` in `src/lib/agents/supervisorLink.fixtures.json`.
//!
//! A chain is followed through `spawnedByAgentId` only while the parent is in
//! the list, so a child whose supervisor's card was cleared has no root. The
//! subtree is computed again on every poll, which is what makes a child
//! started after the subscription part of it.

use super::jobs::RequestedBy;
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

/// One job as the subtree needs it.
pub struct JobRef<'a> {
    pub agent_id: &'a str,
    pub requested_by: Option<&'a RequestedBy>,
}

/// The ancestors of `id` inside `agents`, nearest first, without `id` itself.
/// Stops at a parent missing from the list and at a loop.
fn ancestors<'a>(by_id: &HashMap<&str, &'a AgentInfo>, id: &str) -> Vec<&'a AgentInfo> {
    let mut chain = Vec::new();
    let mut seen = BTreeSet::from([id.to_string()]);
    let mut current = by_id
        .get(id)
        .and_then(|agent| agent.spawned_by_agent_id.as_deref());
    while let Some(parent) = current.and_then(|parent| by_id.get(parent)) {
        if !seen.insert(parent.id.clone()) {
            break;
        }
        chain.push(*parent);
        current = parent.spawned_by_agent_id.as_deref();
    }
    chain
}

fn index(agents: &[AgentInfo]) -> HashMap<&str, &AgentInfo> {
    agents
        .iter()
        .map(|agent| (agent.id.as_str(), agent))
        .collect()
}

/// The topmost supervisor of `id`'s chain; a supervisor's own id for itself
/// when nothing above it is one. `None` when the chain reaches no supervisor.
pub fn root_supervisor_id(agents: &[AgentInfo], id: &str) -> Option<String> {
    let by_id = index(agents);
    let own = by_id
        .get(id)
        .filter(|agent| agent.role == AgentRole::Supervisor)
        .map(|agent| agent.id.clone());
    ancestors(&by_id, id)
        .into_iter()
        .rev()
        .find(|agent| agent.role == AgentRole::Supervisor)
        .map(|agent| agent.id.clone())
        .or(own)
}

/// What one subscription asked for.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Filter {
    /// `None`: no agentIds filter.
    pub agent_ids: Option<BTreeSet<String>>,
    /// `None`: no supervisors filter. Entries are keys or agent ids.
    pub supervisors: Option<Vec<String>>,
}

/// What a filter covers in one agent list.
#[derive(Debug, Clone, PartialEq)]
pub struct Coverage {
    /// `None`: every agent in the list.
    agents: Option<BTreeSet<String>>,
    /// `None`: every job. Otherwise the ids and keys a job's `requestedBy`
    /// must name one of.
    jobs: Option<(BTreeSet<String>, BTreeSet<String>)>,
}

impl Coverage {
    pub fn covers_agent(&self, agent_id: &str) -> bool {
        self.agents
            .as_ref()
            .map_or(true, |covered| covered.contains(agent_id))
    }

    pub fn covers_job(&self, requested_by: Option<&RequestedBy>) -> bool {
        let Some((ids, keys)) = &self.jobs else {
            return true;
        };
        requested_by.is_some_and(|by| ids.contains(&by.agent_id) || keys.contains(&by.key))
    }
}

impl Filter {
    /// No filter is the whole list and every job. `agentIds` alone keeps the
    /// job events unfiltered, as before supervisors were a filter; with
    /// `supervisors`, only the jobs they asked for, and those jobs' agents.
    pub fn coverage(&self, agents: &[AgentInfo], jobs: &[JobRef<'_>]) -> Coverage {
        let Some(entries) = &self.supervisors else {
            return Coverage {
                agents: self.agent_ids.clone(),
                jobs: None,
            };
        };
        let matched: Vec<&AgentInfo> = agents
            .iter()
            .filter(|agent| agent.role == AgentRole::Supervisor)
            .filter(|agent| {
                entries.iter().any(|entry| {
                    *entry == agent.id || agent.supervisor_key.as_deref() == Some(entry.as_str())
                })
            })
            .collect();
        let ids: BTreeSet<String> = entries
            .iter()
            .cloned()
            .chain(matched.iter().map(|agent| agent.id.clone()))
            .collect();
        let keys: BTreeSet<String> = entries
            .iter()
            .cloned()
            .chain(
                matched
                    .iter()
                    .filter_map(|agent| agent.supervisor_key.clone()),
            )
            .collect();
        let roots: BTreeSet<&str> = matched.iter().map(|agent| agent.id.as_str()).collect();
        let by_id = index(agents);
        let mut covered: BTreeSet<String> = self.agent_ids.clone().unwrap_or_default();
        for agent in agents {
            let in_subtree = roots.contains(agent.id.as_str())
                || ancestors(&by_id, &agent.id)
                    .iter()
                    .any(|ancestor| roots.contains(ancestor.id.as_str()));
            if in_subtree {
                covered.insert(agent.id.clone());
            }
        }
        let coverage = Coverage {
            agents: None,
            jobs: Some((ids, keys)),
        };
        for job in jobs {
            if coverage.covers_job(job.requested_by) && by_id.contains_key(job.agent_id) {
                covered.insert(job.agent_id.to_string());
            }
        }
        Coverage {
            agents: Some(covered),
            ..coverage
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildCount {
    pub running: u32,
    pub total: u32,
}

/// One row of `supervisors.list`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkSupervisor {
    pub agent_id: String,
    pub key: Option<String>,
    pub name: String,
    pub status: AgentStatus,
    /// The run folder's name.
    pub run: Option<String>,
    /// The whole subtree below it, grandchildren included; jobs are not
    /// children.
    pub children: ChildCount,
}

/// Every supervisor in `agents`, in list order, with its subtree counted.
pub fn supervisor_list(agents: &[AgentInfo]) -> Vec<LinkSupervisor> {
    let by_id = index(agents);
    let mut counts: BTreeMap<&str, ChildCount> = BTreeMap::new();
    for agent in agents {
        for ancestor in ancestors(&by_id, &agent.id) {
            if ancestor.role != AgentRole::Supervisor {
                continue;
            }
            let count = counts.entry(ancestor.id.as_str()).or_insert(ChildCount {
                running: 0,
                total: 0,
            });
            count.total += 1;
            if agent.status == AgentStatus::Running {
                count.running += 1;
            }
        }
    }
    agents
        .iter()
        .filter(|agent| agent.role == AgentRole::Supervisor)
        .map(|agent| LinkSupervisor {
            agent_id: agent.id.clone(),
            key: agent.supervisor_key.clone(),
            name: agent.name.clone(),
            status: agent.status.clone(),
            run: agent
                .repo_path
                .as_deref()
                .and_then(|path| Path::new(path).file_name())
                .map(|name| name.to_string_lossy().into_owned()),
            children: counts.remove(agent.id.as_str()).unwrap_or(ChildCount {
                running: 0,
                total: 0,
            }),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn fixture() -> Value {
        super::super::protocol::tests::fixtures()["subtree"].clone()
    }

    fn agents_of(value: &Value) -> Vec<AgentInfo> {
        value
            .as_array()
            .map(|list| {
                list.iter()
                    .map(crate::supervisor::several::tests::agent_from)
                    .collect()
            })
            .unwrap_or_default()
    }

    fn strings(value: &Value) -> BTreeSet<String> {
        value
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|entry| entry.as_str().expect("string").to_string())
                    .collect()
            })
            .unwrap_or_default()
    }

    struct Job {
        id: String,
        agent_id: String,
        requested_by: Option<RequestedBy>,
    }

    fn jobs(fixture: &Value) -> Vec<Job> {
        fixture["jobs"]
            .as_array()
            .expect("jobs")
            .iter()
            .map(|job| Job {
                id: job["jobId"].as_str().expect("jobId").to_string(),
                agent_id: job["agentId"].as_str().expect("agentId").to_string(),
                requested_by: serde_json::from_value(job["requestedBy"].clone()).expect("by"),
            })
            .collect()
    }

    #[test]
    fn every_subtree_case_covers_what_the_contract_says() {
        let fixture = fixture();
        let jobs = jobs(&fixture);
        let refs: Vec<JobRef> = jobs
            .iter()
            .map(|job| JobRef {
                agent_id: &job.agent_id,
                requested_by: job.requested_by.as_ref(),
            })
            .collect();
        for case in fixture["cases"].as_array().expect("cases") {
            let name = case["name"].as_str().expect("name");
            let mut agents = agents_of(&fixture["agents"]);
            agents.extend(agents_of(&case["addLater"]));
            let filter = Filter {
                agent_ids: case.get("agentIds").map(strings),
                supervisors: Some(strings(&case["supervisors"]).into_iter().collect()),
            };
            let coverage = filter.coverage(&agents, &refs);
            let covered: BTreeSet<String> = agents
                .iter()
                .filter(|agent| coverage.covers_agent(&agent.id))
                .map(|agent| agent.id.clone())
                .collect();
            assert_eq!(covered, strings(&case["agents"]), "{name}: agents");
            let covered_jobs: BTreeSet<String> = jobs
                .iter()
                .filter(|job| coverage.covers_job(job.requested_by.as_ref()))
                .map(|job| job.id.clone())
                .collect();
            assert_eq!(covered_jobs, strings(&case["jobs"]), "{name}: jobs");
        }
    }

    #[test]
    fn without_supervisors_the_filter_is_what_it_was() {
        let fixture = fixture();
        let agents = agents_of(&fixture["agents"]);
        let everything = Filter::default().coverage(&agents, &[]);
        assert!(agents
            .iter()
            .all(|agent| everything.covers_agent(&agent.id)));
        assert!(everything.covers_job(None));
        let by_id = Filter {
            agent_ids: Some(BTreeSet::from(["agent-2".to_string()])),
            supervisors: None,
        }
        .coverage(&agents, &[]);
        assert!(by_id.covers_agent("agent-2") && !by_id.covers_agent("agent-1"));
        assert!(
            by_id.covers_job(None),
            "agentIds alone does not filter jobs"
        );
    }

    #[test]
    fn each_agent_names_the_topmost_supervisor_of_its_chain() {
        let fixture = fixture();
        let agents = agents_of(&fixture["agents"]);
        for (id, expected) in fixture["rootSupervisorIds"].as_object().expect("roots") {
            assert_eq!(
                root_supervisor_id(&agents, id),
                expected.as_str().map(str::to_string),
                "{id}"
            );
        }
    }

    #[test]
    fn the_supervisor_list_counts_whole_subtrees() {
        let fixture = fixture();
        let mut agents = agents_of(&fixture["agents"]);
        agents.extend(agents_of(&fixture["finished"]));
        assert_eq!(
            serde_json::to_value(supervisor_list(&agents)).expect("list"),
            fixture["list"]
        );
    }

    #[test]
    fn a_parent_loop_ends_the_walk() {
        let looped = vec![
            crate::supervisor::several::tests::agent_from(&json!({
                "id": "a", "role": "worker", "spawnedByAgentId": "b"
            })),
            crate::supervisor::several::tests::agent_from(&json!({
                "id": "b", "role": "worker", "spawnedByAgentId": "a"
            })),
        ];
        assert_eq!(root_supervisor_id(&looped, "a"), None);
        assert!(supervisor_list(&looped).is_empty());
    }
}
