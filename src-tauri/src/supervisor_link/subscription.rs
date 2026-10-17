//! Turns the supervisor tree and the agents' output buffers into the link's
//! events. Pure: the caller hands in the tree and a way to read output, so the
//! diffing is tested without a socket or an app.

use super::protocol::SubscribeParams;
use crate::control_socket::protocol::AgentSummary;
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
    fn of(agent: &AgentSummary) -> Self {
        Self {
            status: serde_json::to_string(&agent.info.status).unwrap_or_default(),
            name: agent.info.name.clone(),
            current_task: agent.info.current_task.clone(),
            project_path: agent.info.project_path.clone(),
            repo_path: agent.info.repo_path.clone(),
        }
    }
}

#[derive(Debug)]
pub struct Subscription {
    /// `None`: the whole tree, agents that join later included.
    agent_ids: Option<BTreeSet<String>>,
    output: bool,
    known: BTreeMap<String, Fingerprint>,
    /// Per agent, the output offset the next `agent.output` starts at.
    offsets: BTreeMap<String, u64>,
}

impl Subscription {
    /// The baseline is the tree as the subscribe response shows it: nothing in
    /// it is announced again, and output starts where it stands now unless the
    /// client named an offset to continue from.
    pub fn start(params: &SubscribeParams, tree: &[AgentSummary]) -> Self {
        let mut subscription = Self {
            agent_ids: params
                .agent_ids
                .as_ref()
                .map(|ids| ids.iter().cloned().collect()),
            output: params.output.unwrap_or(true),
            known: BTreeMap::new(),
            offsets: BTreeMap::new(),
        };
        let since = params.since_offsets.clone().unwrap_or_default();
        for agent in tree {
            let id = &agent.info.id;
            if !subscription.covers(id) {
                continue;
            }
            subscription
                .known
                .insert(id.clone(), Fingerprint::of(agent));
            let from = since.get(id).copied().unwrap_or(agent.output_bytes);
            subscription.offsets.insert(id.clone(), from);
        }
        subscription
    }

    pub fn covers(&self, agent_id: &str) -> bool {
        self.agent_ids
            .as_ref()
            .map_or(true, |ids| ids.contains(agent_id))
    }

    /// The events since the last poll, in the order they should go out: list
    /// changes first, so an agent is announced before its first output.
    pub fn poll(
        &mut self,
        tree: &[AgentSummary],
        read_since: impl Fn(&str, u64) -> Option<Value>,
    ) -> Vec<(&'static str, Value)> {
        let mut events = Vec::new();
        let covered: Vec<&AgentSummary> = tree
            .iter()
            .filter(|agent| self.covers(&agent.info.id))
            .collect();

        for agent in &covered {
            let id = &agent.info.id;
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

        let present: BTreeSet<&str> = covered.iter().map(|a| a.info.id.as_str()).collect();
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
                let id = &agent.info.id;
                let since = self.offsets.get(id).copied().unwrap_or(0);
                if agent.output_bytes <= since {
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
