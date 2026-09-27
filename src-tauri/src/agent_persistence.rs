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
    /// Immutable logical project binding. Missing on v1 persistence files.
    #[serde(default)]
    pub project_path: Option<String>,
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
    /// The launch request this agent serves. Kept so a restart can mark the
    /// run `interrupted` and a resume can carry on reporting to it.
    #[serde(default)]
    pub launch_request_uid: Option<String>,
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

    pub fn record_spawn(&mut self, agent: PersistedAgent) -> Result<(), String> {
        self.active.retain(|a| a.id != agent.id);
        self.active.push(agent);
        self.save()
    }

    /// Lets go of an agent's restart anchor. The list without it is saved
    /// first and becomes the state only once that worked: a failed save keeps
    /// the anchor in memory and in the file, so the removal can be retried
    /// and a later save of another agent does not drop it on the side.
    pub fn record_exit(&mut self, agent_id: &str) -> Result<(), String> {
        let remaining: Vec<PersistedAgent> = self
            .active
            .iter()
            .filter(|a| a.id != agent_id)
            .cloned()
            .collect();
        self.write(&self.interrupted, &remaining)?;
        self.active = remaining;
        Ok(())
    }

    /// Renames a persisted agent so a name given in the UI survives a restart.
    /// Reaches both this run's agents and the interrupted ones — an agent
    /// waiting to be resumed is exactly the kind you want to label. Returns
    /// whether an agent with that id was found.
    pub fn rename(&mut self, agent_id: &str, name: &str) -> bool {
        let mut renamed = false;
        for agent in self.active.iter_mut().chain(self.interrupted.iter_mut()) {
            if agent.id == agent_id {
                agent.name = name.to_string();
                renamed = true;
            }
        }
        if renamed {
            self.report(self.save());
        }
        renamed
    }

    pub fn interrupted(&self) -> Vec<PersistedAgent> {
        self.interrupted.clone()
    }

    /// Removes and returns an interrupted agent (for resume).
    /// Drops left-behind agents whose run already has its verdict. Unlike
    /// `take_interrupted`, they leave the list at once, whether or not the
    /// file can be rewritten: an ended agent must never be offered for
    /// resume (review r4). A save that fails is returned; every later
    /// successful save writes the list without them, and until then each
    /// start finds them ended again and drops them again.
    pub fn settle(&mut self, agent_ids: &[String]) -> Result<(), String> {
        let before = self.interrupted.len();
        self.interrupted
            .retain(|agent| !agent_ids.contains(&agent.id));
        if self.interrupted.len() == before {
            return Ok(());
        }
        self.save()
    }

    /// Same rule as `record_exit`: saved first, changed after.
    pub fn take_interrupted(&mut self, agent_id: &str) -> Result<Option<PersistedAgent>, String> {
        let Some(pos) = self.interrupted.iter().position(|a| a.id == agent_id) else {
            return Ok(None);
        };
        let mut remaining = self.interrupted.clone();
        let agent = remaining.remove(pos);
        self.write(&remaining, &self.active)?;
        self.interrupted = remaining;
        Ok(Some(agent))
    }

    pub fn discard_interrupted(&mut self, agent_id: &str) -> Result<bool, String> {
        Ok(self.take_interrupted(agent_id)?.is_some())
    }

    /// For changes to the list of interrupted agents: losing one costs a
    /// resume offer, not a run's status, so it is reported and not retried.
    fn report(&self, outcome: Result<(), String>) {
        if let Err(error) = outcome {
            eprintln!("Agent persistence: {error}");
        }
    }

    /// Writes interrupted + active agents. Interrupted ones stay in the file
    /// until resumed or discarded, so they survive further restarts too.
    ///
    /// Atomic: the file is written beside the target and renamed over it, so
    /// a crash mid-write leaves the previous version, never a torn one. The
    /// file is the restart anchor of every running agent; an error is
    /// returned, never swallowed.
    pub fn save(&self) -> Result<(), String> {
        self.write(&self.interrupted, &self.active)
    }

    fn write(
        &self,
        interrupted: &[PersistedAgent],
        active: &[PersistedAgent],
    ) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let file = PersistenceFile {
            agents: interrupted.iter().chain(active.iter()).cloned().collect(),
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        let json = serde_json::to_string_pretty(&file)
            .map_err(|e| format!("Failed to encode agent persistence: {e}"))?;
        let staged = path.with_extension("json.tmp");
        std::fs::write(&staged, json)
            .map_err(|e| format!("Failed to write {}: {e}", staged.display()))?;
        std::fs::rename(&staged, path)
            .map_err(|e| format!("Failed to replace {}: {e}", path.display()))
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
            project_path: Some("/tmp/repo".to_string()),
            permission_mode: Some("auto".to_string()),
            dangerously_ignore_permissions: false,
            auto_accept_edits: true,
            headless: false,
            started_at: 42,
            spawned_by_ticket_id: None,
            spawned_by_goal_id: Some("goal-1".to_string()),
            launch_request_uid: None,
        }
    }

    /// Blocks the staging file, so the next save fails.
    fn block_saves(path: &std::path::Path) -> PathBuf {
        let staged = path.with_extension("json.tmp");
        std::fs::create_dir(&staged).unwrap();
        staged
    }

    /// Review r3 of goal 10: an exit whose save failed keeps the anchor, in
    /// memory and in the file, so the removal can be retried; once it lands,
    /// a restart finds no agent that already ended.
    #[test]
    fn an_exit_that_could_not_be_saved_keeps_the_anchor_until_a_retry_lands() {
        let path = temp_path("exit-anchor.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1")).unwrap();
        let blocked = block_saves(&path);

        assert!(p.record_exit("agent-1").is_err());
        assert!(p.active.iter().any(|a| a.id == "agent-1"));
        assert_eq!(
            AgentPersistence::load(Some(path.clone()))
                .interrupted()
                .len(),
            1
        );

        std::fs::remove_dir(blocked).unwrap();
        p.record_exit("agent-1").unwrap();
        assert!(AgentPersistence::load(Some(path)).interrupted().is_empty());
    }

    /// The same for taking an interrupted agent out (resume, discard).
    #[test]
    fn taking_an_interrupted_agent_that_could_not_be_saved_keeps_it() {
        let path = temp_path("take-anchor.json");
        AgentPersistence::load(Some(path.clone()))
            .record_spawn(sample_agent("agent-1"))
            .unwrap();
        let mut p = AgentPersistence::load(Some(path.clone()));
        let blocked = block_saves(&path);

        assert!(p.take_interrupted("agent-1").is_err());
        assert!(p.discard_interrupted("agent-1").is_err());
        assert_eq!(p.interrupted().len(), 1);
        assert_eq!(
            AgentPersistence::load(Some(path.clone()))
                .interrupted()
                .len(),
            1
        );

        std::fs::remove_dir(blocked).unwrap();
        assert!(p.discard_interrupted("agent-1").unwrap());
        assert!(AgentPersistence::load(Some(path)).interrupted().is_empty());
    }

    /// Review r1 of goal 10: a failed write of the restart anchor is an error
    /// the caller sees, and never leaves a torn file behind.
    #[test]
    fn a_failed_save_is_reported_and_keeps_the_previous_file() {
        let path = temp_path("anchors.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1")).unwrap();
        let before = std::fs::read_to_string(&path).unwrap();

        // The staging file cannot be created: a directory sits in its place.
        std::fs::create_dir(path.with_extension("json.tmp")).unwrap();
        assert!(p.record_spawn(sample_agent("agent-2")).is_err());

        assert_eq!(std::fs::read_to_string(&path).unwrap(), before);
    }

    /// Goal 10, station 2: a restart must still know which request an
    /// interrupted agent served, and files from before that field still load.
    #[test]
    fn the_launch_request_survives_a_restart_and_older_files_still_load() {
        let path = temp_path("launch-uid.json");
        let mut agent = sample_agent("agent-5");
        agent.launch_request_uid = Some("req-1".to_string());
        AgentPersistence::load(Some(path.clone()))
            .record_spawn(agent)
            .unwrap();

        let restored = AgentPersistence::load(Some(path.clone())).interrupted();
        assert_eq!(restored[0].launch_request_uid.as_deref(), Some("req-1"));

        let old = r#"{"agents":[{"id":"agent-1","name":"a","model":"m","provider":"claude",
            "task":"t","cwd":null,"permissionMode":null,"startedAt":1}]}"#;
        std::fs::write(&path, old).unwrap();
        let restored = AgentPersistence::load(Some(path)).interrupted();
        assert_eq!(restored.len(), 1);
        assert!(restored[0].launch_request_uid.is_none());
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
        p.record_spawn(sample_agent("agent-1")).unwrap();
        p.record_exit("agent-1").unwrap();
        assert!(p.interrupted().is_empty());
    }

    #[test]
    fn test_spawned_agent_survives_a_restart_as_interrupted() {
        let path = temp_path("agents.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1")).unwrap();

        // "Restart": load a fresh instance from the same file.
        let restarted = AgentPersistence::load(Some(path));
        assert_eq!(restarted.interrupted(), vec![sample_agent("agent-1")]);
    }

    #[test]
    fn test_exited_agent_does_not_survive_a_restart() {
        let path = temp_path("agents.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1")).unwrap();
        p.record_spawn(sample_agent("agent-2")).unwrap();
        p.record_exit("agent-1").unwrap();

        let restarted = AgentPersistence::load(Some(path));
        assert_eq!(restarted.interrupted(), vec![sample_agent("agent-2")]);
    }

    #[test]
    fn test_interrupted_agents_survive_further_restarts_until_handled() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1")).unwrap();
        }
        {
            // Second run: agent-1 is interrupted, a new agent spawns and exits.
            let mut p = AgentPersistence::load(Some(path.clone()));
            assert_eq!(p.interrupted().len(), 1);
            p.record_spawn(sample_agent("agent-2")).unwrap();
            p.record_exit("agent-2").unwrap();
        }
        let third = AgentPersistence::load(Some(path));
        assert_eq!(third.interrupted(), vec![sample_agent("agent-1")]);
    }

    #[test]
    fn test_rename_survives_a_restart() {
        let path = temp_path("agents.json");
        let mut p = AgentPersistence::load(Some(path.clone()));
        p.record_spawn(sample_agent("agent-1")).unwrap();

        assert!(p.rename("agent-1", "Docs sweep"));

        let restarted = AgentPersistence::load(Some(path));
        assert_eq!(restarted.interrupted()[0].name, "Docs sweep");
    }

    #[test]
    fn test_rename_reaches_an_interrupted_agent_too() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1")).unwrap();
        }
        let mut second = AgentPersistence::load(Some(path.clone()));
        assert!(second.rename("agent-1", "Renamed while parked"));

        let third = AgentPersistence::load(Some(path));
        assert_eq!(third.interrupted()[0].name, "Renamed while parked");
    }

    #[test]
    fn test_rename_reports_an_unknown_agent() {
        let mut p = AgentPersistence::load(Some(temp_path("agents.json")));
        assert!(!p.rename("agent-404", "Nobody"));
    }

    #[test]
    fn test_take_interrupted_removes_and_returns_the_agent() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1")).unwrap();
        }
        let mut p = AgentPersistence::load(Some(path.clone()));
        let taken = p.take_interrupted("agent-1").unwrap();
        assert_eq!(taken, Some(sample_agent("agent-1")));
        assert!(p.interrupted().is_empty());

        // Removal is persisted.
        let reloaded = AgentPersistence::load(Some(path));
        assert!(reloaded.interrupted().is_empty());
    }

    #[test]
    fn test_take_interrupted_unknown_id_returns_none() {
        let mut p = AgentPersistence::load(Some(temp_path("agents.json")));
        assert_eq!(p.take_interrupted("agent-99").unwrap(), None);
    }

    #[test]
    fn test_discard_interrupted_removes_and_persists() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-1")).unwrap();
        }
        let mut p = AgentPersistence::load(Some(path.clone()));
        assert!(p.discard_interrupted("agent-1").unwrap());
        assert!(!p.discard_interrupted("agent-1").unwrap());

        let reloaded = AgentPersistence::load(Some(path));
        assert!(reloaded.interrupted().is_empty());
    }

    #[test]
    fn test_max_agent_number_over_interrupted_ids() {
        let path = temp_path("agents.json");
        {
            let mut p = AgentPersistence::load(Some(path.clone()));
            p.record_spawn(sample_agent("agent-3")).unwrap();
            p.record_spawn(sample_agent("agent-11")).unwrap();
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
