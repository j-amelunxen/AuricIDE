//! Several supervisors at once (`docs/design-agent-control.md`, "Several
//! supervisors"): the key a client addresses one by, the run folder only one
//! live supervisor may work in, and the children a resumed supervisor takes
//! over from the one before it. Pure, apart from `supervisor.json` in a run
//! folder; the callers hand in the agent lists.
//!
//! The machine-checkable half is `supervisorKeys` in
//! `src/lib/agents/supervisorLink.fixtures.json` and `supervisors` in
//! `src/lib/agents/agentControl.fixtures.json`.

use super::managers::ManagerRecord;
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Fixture `supervisorKeys.maxLength`.
pub const MAX_KEY_LENGTH: usize = 48;
/// Fixture `supervisors.supervisorFileName`: the key, kept in the run folder
/// so a run resumed from the tile or the runs panel keeps its address.
pub const SUPERVISOR_FILE_NAME: &str = "supervisor.json";
/// Fixture `supervisors.resumeAdoptsChildren.event`.
pub const CHILDREN_ADOPTED_EVENT: &str = "supervisor-children-adopted";

/// `^[a-z0-9][a-z0-9-]{0,47}$` (fixture `supervisorKeys.pattern`) and not
/// shaped like an agent id (`reservedPattern`, `^agent-\d+$`): a subscription
/// entry is a key or an id, and must never name two supervisors at once.
pub fn is_valid_key(key: &str) -> bool {
    let reserved = key
        .strip_prefix("agent-")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|byte| byte.is_ascii_digit()));
    !reserved && is_well_formed(key)
}

fn is_well_formed(key: &str) -> bool {
    let lower_or_digit = |byte: &u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    let bytes = key.as_bytes();
    match bytes.split_first() {
        Some((first, rest)) => {
            bytes.len() <= MAX_KEY_LENGTH
                && lower_or_digit(first)
                && rest
                    .iter()
                    .all(|byte| lower_or_digit(byte) || *byte == b'-')
        }
        None => false,
    }
}

/// The sentence fixture `spawnRefusals` maps to `supervisor_key_invalid`.
pub fn key_invalid_message(key: &str) -> String {
    format!(
        "'{key}' is not a valid supervisor key: use 1 to {MAX_KEY_LENGTH} lowercase letters, \
         digits and dashes, starting with a letter or a digit, and not shaped like an agent id \
         (agent-<number>)."
    )
}

/// The sentence fixture `spawnRefusals` maps to `supervisor_key_in_use`.
pub fn key_in_use_message(key: &str, agent_id: &str) -> String {
    format!("'{key}' is already the key of a running supervisor ({agent_id}).")
}

/// The sentence fixture `spawnRefusals` maps to `invalid_params`.
pub const WORKER_KEY_MESSAGE: &str = "Only a supervisor takes a supervisor key.";

/// The sentence fixture `supervisors.runDirInUse.pattern` matches.
pub fn run_dir_in_use_message(dir: &Path, agent_id: &str) -> String {
    let name = dir
        .file_name()
        .map_or_else(|| dir.to_string_lossy(), |name| name.to_string_lossy());
    format!(
        "The run folder {name} is already in use by the running supervisor {agent_id}. \
         Open that supervisor instead of resuming the run again."
    )
}

/// A supervisor whose process still runs. The manager drops an agent when its
/// process ends, so its list holds only these; the status check keeps a
/// finished one handed in from elsewhere (run results) from counting.
pub fn is_live_supervisor(agent: &AgentInfo) -> bool {
    agent.role == AgentRole::Supervisor
        && matches!(agent.status, AgentStatus::Running | AgentStatus::Queued)
}

/// The live supervisor that carries `key`.
pub fn live_supervisor_with_key<'a>(agents: &'a [AgentInfo], key: &str) -> Option<&'a AgentInfo> {
    agents
        .iter()
        .find(|agent| is_live_supervisor(agent) && agent.supervisor_key.as_deref() == Some(key))
}

/// A key that may be handed to a new supervisor: well formed and free.
pub fn check_key(agents: &[AgentInfo], key: &str) -> Result<(), String> {
    if !is_valid_key(key) {
        return Err(key_invalid_message(key));
    }
    match live_supervisor_with_key(agents, key) {
        Some(holder) => Err(key_in_use_message(key, &holder.id)),
        None => Ok(()),
    }
}

fn same_folder(a: &Path, b: &Path) -> bool {
    let canonical = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    a == b || canonical(a) == canonical(b)
}

/// The live supervisor already working in `dir`. A worker that happens to run
/// in the same folder does not hold the run.
pub fn run_dir_holder<'a>(agents: &'a [AgentInfo], dir: &Path) -> Option<&'a AgentInfo> {
    agents.iter().find(|agent| {
        is_live_supervisor(agent)
            && agent
                .repo_path
                .as_deref()
                .is_some_and(|cwd| same_folder(Path::new(cwd), dir))
    })
}

/// The key and run-folder checks again, over the agent list as it stands when
/// the new supervisor is entered into it. `admit_spawn` checked a snapshot
/// taken before the process started; two launches in that gap would both
/// have passed.
pub fn recheck(
    agents: &[AgentInfo],
    key: Option<&str>,
    resumed_run_dir: Option<&str>,
) -> Result<(), String> {
    if let Some(dir) = resumed_run_dir.map(Path::new) {
        if let Some(holder) = run_dir_holder(agents, dir) {
            return Err(run_dir_in_use_message(dir, &holder.id));
        }
    }
    match key {
        Some(key) => check_key(agents, key),
        None => Ok(()),
    }
}

/// Whether a spawn refusal is about another live supervisor (its run folder
/// or its key) and so may succeed once that one ends.
pub fn is_busy_refusal(message: &str) -> bool {
    message.contains("is already in use by the running supervisor")
        || message.contains("is already the key of a running supervisor")
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SupervisorFile {
    key: Option<String>,
}

/// The key `<run_dir>/supervisor.json` names. Missing, unreadable or not a
/// valid key: none.
pub fn read_run_key(run_dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(run_dir.join(SUPERVISOR_FILE_NAME)).ok()?;
    serde_json::from_str::<SupervisorFile>(&text)
        .ok()?
        .key
        .filter(|key| is_valid_key(key))
}

/// Writes `<run_dir>/supervisor.json` for this launch, `null` included, so the
/// file always says what the last supervisor of the run was called.
pub fn write_run_key(run_dir: &Path, key: Option<&str>) -> Result<(), String> {
    let file = SupervisorFile {
        key: key.map(str::to_string),
    };
    let text = serde_json::to_string(&file).map_err(|error| error.to_string())?;
    std::fs::write(run_dir.join(SUPERVISOR_FILE_NAME), text)
        .map_err(|error| format!("Could not write the run's supervisor.json: {error}"))
}

/// The refusal for a resume whose run remembers a key another live
/// supervisor now carries. Still a busy refusal (`is_busy_refusal`), so a
/// restored agent keeps its offer.
pub fn run_key_in_use_message(run_dir: &Path, key: &str, holder: &str) -> String {
    let name = run_dir
        .file_name()
        .map_or_else(|| run_dir.to_string_lossy(), |name| name.to_string_lossy());
    format!(
        "The run folder {name} remembers the key '{key}', but '{key}' is already the key of a \
         running supervisor ({holder}). Stop that supervisor to resume this run under its key."
    )
}

/// The sentence fixture `refusals.manager_key_mismatch` matches.
pub fn manager_key_mismatch_message(dir: &str, name: &str, key: &str) -> String {
    format!(
        "The run folder {dir} belongs to the Project Manager '{name}' and runs only under its key '{key}'."
    )
}

/// The sentence fixture `refusals.manager_archived` matches.
pub fn manager_archived_message(name: &str) -> String {
    format!("The Project Manager '{name}' is archived. Restore it before opening it.")
}

/// A manager's key on a run folder that is not its own: the key is the
/// manager's address, so a stranger must not answer under it.
pub fn manager_key_reserved_message(key: &str, name: &str) -> String {
    format!(
        "The key '{key}' belongs to the Project Manager '{name}' and runs only its own run folder."
    )
}

/// The Project Manager a supervisor launch is for: the owner of the folder it
/// resumes (`resume_folder`, a folder name), else the holder of the key it
/// names, whose folder it then resumes. `None` is an ordinary supervisor.
/// The table is fixture `launchKey`.
pub fn manager_launch<'a>(
    managers: &'a [ManagerRecord],
    resume_folder: Option<&str>,
    own_key: Option<&str>,
) -> Result<Option<&'a ManagerRecord>, String> {
    let owner = resume_folder.and_then(|folder| managers.iter().find(|m| m.run_dir == folder));
    let holder = own_key.and_then(|key| managers.iter().find(|m| m.key == key));
    let manager = match (owner, holder) {
        (Some(owner), _) => owner,
        (None, Some(holder)) if resume_folder.is_some() => {
            return Err(manager_key_reserved_message(&holder.key, &holder.name))
        }
        (None, Some(holder)) => holder,
        (None, None) => return Ok(None),
    };
    if manager.archived_at.is_some() {
        return Err(manager_archived_message(&manager.name));
    }
    match own_key {
        Some(key) if key != manager.key => Err(manager_key_mismatch_message(
            &manager.run_dir,
            &manager.name,
            &manager.key,
        )),
        _ => Ok(Some(manager)),
    }
}

/// Gives the live supervisor working in `run` the key its run just got as a
/// manager, when it had none. It is addressable at once; its process, prompt
/// and children do not change. Answers whether a key was set.
pub fn key_live_supervisor<'a>(
    agents: impl IntoIterator<Item = &'a mut AgentInfo>,
    run: &Path,
    key: &str,
) -> bool {
    let mut agents: Vec<&mut AgentInfo> = agents.into_iter().collect();
    let free = !agents
        .iter()
        .any(|agent| is_live_supervisor(agent) && agent.supervisor_key.as_deref() == Some(key));
    let holder = agents.iter_mut().find(|agent| {
        is_live_supervisor(agent)
            && agent.supervisor_key.is_none()
            && agent
                .repo_path
                .as_deref()
                .is_some_and(|cwd| same_folder(Path::new(cwd), run))
    });
    match holder {
        Some(agent) if free => {
            agent.supervisor_key = Some(key.to_string());
            true
        }
        _ => false,
    }
}

/// The key a supervisor launch ends up with: its own, else, on a resume, the
/// one its run folder remembers.
pub fn launch_key(own: Option<String>, run_dir: &Path, resuming: bool) -> Option<String> {
    own.or_else(|| resuming.then(|| read_run_key(run_dir)).flatten())
}

/// Who a resumed supervisor takes children over from, and its own id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adoption {
    pub from_ids: Vec<String>,
    pub to_id: String,
}

impl Adoption {
    /// Points `spawned_by` at the new supervisor when it named an old one.
    /// `true` when it changed.
    pub fn apply(&self, spawned_by: &mut Option<String>) -> bool {
        let adopted = spawned_by
            .as_deref()
            .is_some_and(|parent| self.from_ids.iter().any(|old| old == parent));
        if adopted {
            *spawned_by = Some(self.to_id.clone());
        }
        adopted
    }
}

/// One earlier agent as a store remembers it: id, role and working folder.
pub struct Earlier<'a> {
    pub id: &'a str,
    pub role: Option<AgentRole>,
    pub cwd: Option<&'a str>,
}

/// The adoption for a supervisor `to_id` that resumed `run_dir`: every earlier
/// supervisor that worked there (`earlier`, from the persisted and the
/// finished agents) plus the one it replaces by name, sorted, itself left
/// out. `None` when there is nobody to take over from.
pub fn adoption_for<'a>(
    run_dir: &Path,
    to_id: &str,
    replaces: Option<&str>,
    earlier: impl IntoIterator<Item = Earlier<'a>>,
) -> Option<Adoption> {
    let mut from_ids: Vec<String> = earlier
        .into_iter()
        .filter(|agent| agent.role == Some(AgentRole::Supervisor))
        .filter(|agent| {
            agent
                .cwd
                .is_some_and(|cwd| same_folder(Path::new(cwd), run_dir))
        })
        .map(|agent| agent.id.to_string())
        .chain(replaces.map(str::to_string))
        .filter(|id| id != to_id)
        .collect();
    from_ids.sort();
    from_ids.dedup();
    (!from_ids.is_empty()).then(|| Adoption {
        from_ids,
        to_id: to_id.to_string(),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::Value;

    fn link_fixtures() -> Value {
        serde_json::from_str(include_str!(
            "../../../src/lib/agents/supervisorLink.fixtures.json"
        ))
        .expect("link fixtures parse")
    }

    fn control_fixtures() -> Value {
        serde_json::from_str(crate::control_socket::protocol::tests::FIXTURES)
            .expect("control fixtures parse")
    }

    fn string(value: &Value) -> Option<String> {
        value.as_str().map(str::to_string)
    }

    /// An agent from a fixture entry (`id`, `role`, `status`, `supervisorKey`,
    /// `spawnedByAgentId`, `repoPath`).
    pub(crate) fn agent_from(value: &Value) -> AgentInfo {
        let status: AgentStatus =
            serde_json::from_value(value["status"].clone()).unwrap_or(AgentStatus::Running);
        AgentInfo {
            id: string(&value["id"]).expect("id"),
            name: string(&value["name"]).unwrap_or_default(),
            role: serde_json::from_value(value["role"].clone()).unwrap_or_default(),
            status,
            supervisor_key: string(&value["supervisorKey"]),
            spawned_by_agent_id: string(&value["spawnedByAgentId"]),
            repo_path: string(&value["repoPath"]),
            ..crate::control_socket::protocol::tests::sample_agent()
        }
    }

    fn agents_from(value: &Value) -> Vec<AgentInfo> {
        value
            .as_array()
            .expect("agents")
            .iter()
            .map(agent_from)
            .collect()
    }

    #[test]
    fn keys_are_valid_exactly_as_the_contract_lists_them() {
        let keys = &link_fixtures()["supervisorKeys"];
        assert_eq!(keys["maxLength"], MAX_KEY_LENGTH);
        for key in keys["valid"].as_array().expect("valid") {
            assert!(is_valid_key(key.as_str().expect("key")), "{key} is valid");
        }
        for key in keys["invalid"].as_array().expect("invalid") {
            assert!(
                !is_valid_key(key.as_str().expect("key")),
                "{key} is invalid"
            );
        }
    }

    #[test]
    fn a_key_is_free_unless_a_live_supervisor_carries_it() {
        let fixture = &control_fixtures()["supervisors"]["keyUniqueness"];
        let live = agents_from(&fixture["live"]);
        for case in fixture["cases"].as_array().expect("cases") {
            let name = case["name"].as_str().expect("name");
            let outcome = match case["key"].as_str() {
                None => Ok(()),
                Some(key) => check_key(&live, key),
            };
            let code = match &outcome {
                Ok(()) => "ok",
                Err(message) if message.contains("is not a valid supervisor key") => {
                    "supervisor_key_invalid"
                }
                Err(message) if message.contains("is already the key of a running supervisor") => {
                    "supervisor_key_in_use"
                }
                Err(message) => panic!("{name}: unexpected {message}"),
            };
            assert_eq!(code, case["expected"], "{name}");
        }
    }

    #[test]
    fn a_run_folder_is_held_by_the_live_supervisor_working_in_it() {
        let fixture = &control_fixtures()["supervisors"]["runDirInUse"];
        let live = agents_from(&fixture["live"]);
        let pattern = fixture["pattern"].as_str().expect("pattern");
        let message = run_dir_in_use_message(Path::new("/r/2026-10-21_090000"), "agent-3");
        assert_eq!(message, fixture["sample"]);
        assert!(message.contains(pattern));
        for case in fixture["cases"].as_array().expect("cases") {
            let dir = Path::new(case["resumeRunDir"].as_str().expect("dir"));
            let outcome = match run_dir_holder(&live, dir) {
                Some(_) => "run_dir_in_use",
                None => "ok",
            };
            assert_eq!(outcome, case["expected"], "{}", case["name"]);
        }
        let mut finished = live.clone();
        finished[0].status = AgentStatus::Idle;
        assert!(
            run_dir_holder(
                &finished,
                Path::new(fixture["cases"][0]["resumeRunDir"].as_str().unwrap())
            )
            .is_none(),
            "a finished supervisor holds nothing"
        );
    }

    #[test]
    fn the_run_folder_remembers_the_key_across_a_resume() {
        for case in control_fixtures()["supervisors"]["supervisorFile"]
            .as_array()
            .expect("cases")
        {
            let name = case["name"].as_str().expect("name");
            let dir = tempfile::tempdir().expect("dir");
            match &case["file"] {
                Value::Null => {}
                Value::String(raw) => {
                    std::fs::write(dir.path().join(SUPERVISOR_FILE_NAME), raw).expect("write")
                }
                file => std::fs::write(dir.path().join(SUPERVISOR_FILE_NAME), file.to_string())
                    .expect("write"),
            }
            let key = launch_key(
                string(&case["key"]),
                dir.path(),
                case["resume"].as_bool().expect("resume"),
            );
            assert_eq!(key, string(&case["expectedKey"]), "{name}");
            write_run_key(dir.path(), key.as_deref()).expect("written");
            let written: Value = serde_json::from_str(
                &std::fs::read_to_string(dir.path().join(SUPERVISOR_FILE_NAME)).expect("read"),
            )
            .expect("json");
            assert_eq!(written, case["written"], "{name}");
        }
    }

    #[test]
    fn the_refusal_sentences_are_the_ones_the_bridge_maps() {
        let fixtures = control_fixtures();
        let sample = |code: &str, pattern: &str| {
            fixtures["spawnRefusals"]
                .as_array()
                .expect("refusals")
                .iter()
                .find(|refusal| refusal["code"] == code && refusal["pattern"] == pattern)
                .and_then(|refusal| refusal["sample"].as_str())
                .unwrap_or_else(|| panic!("no spawnRefusals entry {code}: {pattern}"))
                .to_string()
        };
        assert_eq!(
            key_invalid_message("Mail Triage"),
            sample("supervisor_key_invalid", "is not a valid supervisor key")
        );
        assert_eq!(
            key_in_use_message("mail-triage", "agent-3"),
            sample(
                "supervisor_key_in_use",
                "is already the key of a running supervisor"
            )
        );
        assert_eq!(
            WORKER_KEY_MESSAGE,
            sample("invalid_params", "Only a supervisor takes a supervisor key")
        );
    }

    #[test]
    fn a_resumed_supervisor_adopts_the_children_of_its_run_and_no_others() {
        let fixture = &control_fixtures()["supervisors"]["resumeAdoptsChildren"];
        assert_eq!(fixture["event"], CHILDREN_ADOPTED_EVENT);
        let run_dir = Path::new(fixture["runDir"].as_str().expect("runDir"));
        let to_id = fixture["newSupervisorId"].as_str().expect("new id");
        let earlier: Vec<(String, Option<AgentRole>, Option<String>)> = fixture["persisted"]
            .as_array()
            .expect("persisted")
            .iter()
            .map(|entry| (entry, "cwd"))
            .chain(
                fixture["finished"]
                    .as_array()
                    .expect("finished")
                    .iter()
                    .map(|entry| (entry, "repoPath")),
            )
            .map(|(entry, cwd)| {
                (
                    string(&entry["id"]).expect("id"),
                    serde_json::from_value(entry["role"].clone()).ok(),
                    string(&entry[cwd]),
                )
            })
            .collect();
        let adoption = adoption_for(
            run_dir,
            to_id,
            None,
            earlier.iter().map(|(id, role, cwd)| Earlier {
                id,
                role: *role,
                cwd: cwd.as_deref(),
            }),
        )
        .expect("someone to take over from");
        let expected = &fixture["expected"];
        assert_eq!(
            serde_json::to_value(&adoption.from_ids).expect("ids"),
            expected["adoptedFrom"]
        );
        for store in ["live", "persisted", "finished"] {
            for entry in fixture[store].as_array().expect("store") {
                let id = entry["id"].as_str().expect("id");
                let mut parent = string(&entry["spawnedByAgentId"]);
                adoption.apply(&mut parent);
                assert_eq!(
                    parent,
                    string(&expected[store][id]),
                    "{store} {id} after the resume"
                );
            }
        }
    }

    #[test]
    fn a_launch_that_lost_the_race_is_refused_when_it_is_entered() {
        let run = Path::new("/r/2026-10-21_090000");
        let mut winner = agent_from(&serde_json::json!({
            "id": "agent-3", "role": "supervisor", "status": "running",
            "supervisorKey": "mail-triage", "repoPath": "/r/2026-10-21_090000"
        }));
        let live = [winner.clone()];
        assert!(recheck(&live, Some("mail-triage"), None)
            .unwrap_err()
            .contains("is already the key of a running supervisor"));
        assert!(recheck(&live, None, Some("/r/2026-10-21_090000"))
            .unwrap_err()
            .contains("is already in use by the running supervisor"));
        assert!(recheck(&live, Some("docs"), Some("/r/other")).is_ok());
        assert!(is_busy_refusal(
            &recheck(&live, Some("mail-triage"), None).unwrap_err()
        ));
        assert!(is_busy_refusal(
            &recheck(&live, None, Some("/r/2026-10-21_090000")).unwrap_err()
        ));
        assert!(!is_busy_refusal(&key_invalid_message("X")));
        winner.status = AgentStatus::Error;
        assert!(recheck(&[winner], Some("mail-triage"), Some(run.to_str().unwrap())).is_ok());
    }

    #[test]
    fn the_adoption_event_carries_the_contract_payload() {
        let fixture = &control_fixtures()["supervisors"]["adoptedEvent"];
        assert_eq!(fixture["name"], CHILDREN_ADOPTED_EVENT);
        let adoption = Adoption {
            from_ids: vec!["agent-1".into(), "agent-3".into()],
            to_id: "agent-20".into(),
        };
        assert_eq!(
            serde_json::to_value(&adoption).expect("payload"),
            fixture["payload"]
        );
    }

    #[test]
    fn a_run_whose_key_is_taken_says_so_and_names_the_holder() {
        let message = run_key_in_use_message(Path::new("/r/2026-10-21_090000"), "docs", "agent-3");
        assert!(message.contains("2026-10-21_090000") && message.contains("(agent-3)"));
        assert!(is_busy_refusal(&message));
    }

    fn supervisor_in(folder: &str, key: Option<&str>) -> AgentInfo {
        AgentInfo {
            role: AgentRole::Supervisor,
            supervisor_key: key.map(str::to_string),
            repo_path: Some(folder.to_string()),
            ..crate::control_socket::protocol::tests::sample_agent()
        }
    }

    #[test]
    fn a_live_supervisor_without_a_key_gets_the_one_its_run_was_promoted_under() {
        let mut agents = vec![supervisor_in("/r/a", None), supervisor_in("/r/b", None)];
        assert!(key_live_supervisor(
            agents.iter_mut(),
            Path::new("/r/a"),
            "desk"
        ));
        assert_eq!(agents[0].supervisor_key.as_deref(), Some("desk"));
        assert_eq!(
            agents[1].supervisor_key, None,
            "only the one working in the run"
        );
    }

    #[test]
    fn a_live_supervisor_keeps_a_key_it_has_and_never_shares_one() {
        let mut keyed = vec![supervisor_in("/r/a", Some("old"))];
        assert!(!key_live_supervisor(
            keyed.iter_mut(),
            Path::new("/r/a"),
            "desk"
        ));
        assert_eq!(keyed[0].supervisor_key.as_deref(), Some("old"));
        let mut taken = vec![
            supervisor_in("/r/a", None),
            supervisor_in("/r/b", Some("desk")),
        ];
        assert!(!key_live_supervisor(
            taken.iter_mut(),
            Path::new("/r/a"),
            "desk"
        ));
        assert_eq!(taken[0].supervisor_key, None);
    }

    #[test]
    fn the_supervisor_it_replaces_is_adopted_from_even_when_no_store_remembers_it() {
        let adoption = adoption_for(Path::new("/r/a"), "agent-9", Some("agent-2"), [])
            .expect("the replaced one");
        assert_eq!(adoption.from_ids, vec!["agent-2"]);
        assert!(adoption_for(Path::new("/r/a"), "agent-9", Some("agent-9"), []).is_none());
        assert!(adoption_for(Path::new("/r/a"), "agent-9", None, []).is_none());
    }
}
