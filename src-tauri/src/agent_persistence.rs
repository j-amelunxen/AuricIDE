//! Persists the set of currently running agents to disk so they survive an
//! app restart. The PTY child processes themselves die with the app — what
//! survives is each agent's full spawn configuration. At boot, everything
//! still in the file is from a previous run and therefore *interrupted*;
//! the frontend offers to resume (re-spawn with a continuation task) or
//! discard each one.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Everything needed to show an interrupted agent and re-spawn it later.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAgent {
    pub id: String,
    pub name: String,
    pub model: String,
    pub provider: String,
    pub task: String,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub dangerously_ignore_permissions: bool,
    #[serde(default)]
    pub auto_accept_edits: bool,
    #[serde(default)]
    pub headless: bool,
    pub started_at: u64,
    #[serde(default)]
    pub spawned_by_ticket_id: Option<String>,
    #[serde(default)]
    pub spawned_by_goal_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistenceFile {
    agents: Vec<PersistedAgent>,
}

pub struct AgentPersistence {
    /// None in tests/browser mode — persistence becomes a no-op.
    path: Option<PathBuf>,
    /// Agents from a previous app run (their processes died with the app).
    interrupted: Vec<PersistedAgent>,
    /// Agents running in this app run.
    active: Vec<PersistedAgent>,
}

impl AgentPersistence {
    /// Loads the persistence file. Every entry found belonged to a previous
    /// run — no process can outlive the app — so all of them are interrupted.
    pub fn load(path: Option<PathBuf>) -> Self {
        let interrupted = path
            .as_deref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|content| serde_json::from_str::<PersistenceFile>(&content).ok())
            .map(|file| file.agents)
            .unwrap_or_default();

        Self {
            path,
            interrupted,
            active: Vec::new(),
        }
    }

    /// Highest N over all persisted `agent-N` ids, so the in-memory counter
    /// can be seeded past them and new ids never collide with restored ones.
    pub fn max_agent_number(&self) -> u64 {
        self.interrupted
            .iter()
            .filter_map(|a| a.id.strip_prefix("agent-"))
            .filter_map(|n| n.parse::<u64>().ok())
            .max()
            .unwrap_or(0)
    }

    pub fn record_spawn(&mut self, agent: PersistedAgent) {
        self.active.retain(|a| a.id != agent.id);
        self.active.push(agent);
        self.save();
    }

    pub fn record_exit(&mut self, agent_id: &str) {
        self.active.retain(|a| a.id != agent_id);
        self.save();
    }

    pub fn interrupted(&self) -> Vec<PersistedAgent> {
        self.interrupted.clone()
    }

    /// Removes and returns an interrupted agent (for resume).
    pub fn take_interrupted(&mut self, agent_id: &str) -> Option<PersistedAgent> {
        let pos = self.interrupted.iter().position(|a| a.id == agent_id)?;
        let agent = self.interrupted.remove(pos);
        self.save();
        Some(agent)
    }

    pub fn discard_interrupted(&mut self, agent_id: &str) -> bool {
        let before = self.interrupted.len();
        self.interrupted.retain(|a| a.id != agent_id);
        let removed = self.interrupted.len() != before;
        if removed {
            self.save();
        }
        removed
    }

    /// Writes interrupted + active agents. Interrupted ones stay in the file
    /// until resumed or discarded, so they survive further restarts too.
    fn save(&self) {
        let Some(path) = &self.path else { return };
        let file = PersistenceFile {
            agents: self
                .interrupted
                .iter()
                .chain(self.active.iter())
                .cloned()
                .collect(),
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            let _ = std::fs::write(path, json);
        }
    }
}

pub type AgentPersistenceState = Arc<Mutex<AgentPersistence>>;

pub fn new_agent_persistence_state(path: Option<PathBuf>) -> AgentPersistenceState {
    Arc::new(Mutex::new(AgentPersistence::load(path)))
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_agent(id: &str) -> PersistedAgent {
        PersistedAgent {
            id: id.to_string(),
            name: format!("Agent ({})", id),
            model: "sonnet".to_string(),
            provider: "claude".to_string(),
            task: "do the thing".to_string(),
            cwd: Some("/tmp/repo".to_string()),
            permission_mode: Some("auto".to_string()),
            dangerously_ignore_permissions: false,
            auto_accept_edits: true,
            headless: false,
            started_at: 42,
            spawned_by_ticket_id: None,
            spawned_by_goal_id: Some("goal-1".to_string()),
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = tempfile::tempdir().expect("tempdir");
        // Keep the dir alive by leaking it — fine for tests.
        let path = dir.path().join(name);
        std::mem::forget(dir);
        path
    }

    #[test]
    fn test_load_missing_file_yields_no_interrupted_agents() {
        let p = AgentPersistence::load(Some(temp_path("missing.json")));
        assert!(p.interrupted().is_empty());
    }

    #[test]
    fn test_load_without_path_is_noop() {
        let mut p = AgentPersistence::load(None);
        p.record_spawn(sample_agent("agent-1"));
        p.record_exit("agent-1");
        assert!(p.interrupted().is_empty());
    }

    #[test]
    fn test_spawned_agent_survives_a_restart_as_interrupted() {
        let path = temp_path("agents.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1"));

        // "Restart": load a fresh instance from the same file.
        let restarted = AgentPersistence::load(Some(path));
        assert_eq!(restarted.interrupted(), vec![sample_agent("agent-1")]);
    }

    #[test]
    fn test_exited_agent_does_not_survive_a_restart() {
        let path = temp_path("agents.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1"));
        p.record_spawn(sample_agent("agent-2"));
        p.record_exit("agent-1");

        let restarted = AgentPersistence::load(Some(path));
        assert_eq!(restarted.interrupted(), vec![sample_agent("agent-2")]);
    }

    #[test]
    fn test_interrupted_agents_survive_further_restarts_until_handled() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1"));
        }
        {
            // Second run: agent-1 is interrupted, a new agent spawns and exits.
            let mut p = AgentPersistence::load(Some(path.clone()));
            assert_eq!(p.interrupted().len(), 1);
            p.record_spawn(sample_agent("agent-2"));
            p.record_exit("agent-2");
        }
        let third = AgentPersistence::load(Some(path));
        assert_eq!(third.interrupted(), vec![sample_agent("agent-1")]);
    }

    #[test]
    fn test_take_interrupted_removes_and_returns_the_agent() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1"));
        }
        let mut p = AgentPersistence::load(Some(path.clone()));
        let taken = p.take_interrupted("agent-1");
        assert_eq!(taken, Some(sample_agent("agent-1")));
        assert!(p.interrupted().is_empty());

        // Removal is persisted.
        let reloaded = AgentPersistence::load(Some(path));
        assert!(reloaded.interrupted().is_empty());
    }

    #[test]
    fn test_take_interrupted_unknown_id_returns_none() {
        let mut p = AgentPersistence::load(Some(temp_path("agents.json")));
        assert_eq!(p.take_interrupted("agent-99"), None);
    }

    #[test]
    fn test_discard_interrupted_removes_and_persists() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1"));
        }
        let mut p = AgentPersistence::load(Some(path.clone()));
        assert!(p.discard_interrupted("agent-1"));
        assert!(!p.discard_interrupted("agent-1"));

        let reloaded = AgentPersistence::load(Some(path));
        assert!(reloaded.interrupted().is_empty());
    }

    #[test]
    fn test_max_agent_number_over_interrupted_ids() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-3"));
            p.record_spawn(sample_agent("agent-11"));
        }
        let p = AgentPersistence::load(Some(path));
        assert_eq!(p.max_agent_number(), 11);
    }

    #[test]
    fn test_max_agent_number_defaults_to_zero() {
        let p = AgentPersistence::load(None);
        assert_eq!(p.max_agent_number(), 0);
    }

    #[test]
    fn test_corrupt_file_is_treated_as_empty() {
        let path = temp_path("agents.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{not json").unwrap();
        let p = AgentPersistence::load(Some(path));
        assert!(p.interrupted().is_empty());
    }

    #[test]
    fn test_persisted_agent_serializes_camel_case() {
        let json = serde_json::to_string(&sample_agent("agent-1")).unwrap();
        assert!(json.contains("\"permissionMode\""));
        assert!(json.contains("\"spawnedByGoalId\""));
        assert!(json.contains("\"startedAt\""));
    }
}
