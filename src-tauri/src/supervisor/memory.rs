//! A Project Manager's memory as the IDE sees it: what is in `knowledge/`,
//! which rules of our layout it breaks, and what `okf validate` makes of it
//! (`docs/design-project-manager.md`, "Validation and what the IDE shows").
//!
//! Two checks, two owners. The layout check (`layout.rs`) is ours and needs no
//! tool. The okf check (`okf.rs`) runs when okf is on the machine. Rust runs
//! both, never the agent: after a manager session ends, and on demand from the
//! inspector. The result is stored in
//! `<app_data_dir>/managers/<key>/validation.json`.

mod layout;
mod okf;

use super::managers::{
    find_record, list, timestamp_now, ManagerRecord, REGISTRY_FILE_NAME, VALIDATION_FILE_NAME,
};
use super::runs::{resolve_run_dir, runs_root};
use super::{app_data_dir, write_json_atomic};
use crate::agents::run_results::RunResultsState;
use crate::agents::AgentInfo;
use crate::notifications::NotificationInput;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// `memory.maxFindingsInPrompt` in the fixture: the summary carries no more.
const MAX_FINDINGS: usize = 20;
const MANAGERS_DIR_NAME: &str = "managers";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OkfState {
    Ok,
    Findings,
    Missing,
    Outdated,
    Unrecognised,
    Failed,
    Never,
}

impl OkfState {
    fn worked(self) -> bool {
        matches!(self, Self::Ok | Self::Findings)
    }

    fn broke(self) -> bool {
        matches!(
            self,
            Self::Missing | Self::Outdated | Self::Unrecognised | Self::Failed
        )
    }

    fn name(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Findings => "findings",
            Self::Missing => "missing",
            Self::Outdated => "outdated",
            Self::Unrecognised => "unrecognised",
            Self::Failed => "failed",
            Self::Never => "never",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindingSource {
    Layout,
    Okf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFinding {
    pub source: FindingSource,
    pub code: String,
    /// Relative to `knowledge/`, when the finding is about one file.
    pub path: Option<String>,
    /// One sentence of ours. Never tool output.
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerMemorySummary {
    pub concepts: BTreeMap<String, u32>,
    pub deprecated: u32,
    pub newest_change_ms: Option<u64>,
    /// Layout findings first, then okf's; at most [`MAX_FINDINGS`].
    pub findings: Vec<MemoryFinding>,
    pub okf: OkfState,
    pub checked_at: Option<String>,
}

fn compose(
    scan: layout::Scan,
    okf: okf::OkfReading,
    checked_at: Option<String>,
) -> ManagerMemorySummary {
    let mut findings = scan.findings;
    findings.extend(okf.findings);
    findings.truncate(MAX_FINDINGS);
    ManagerMemorySummary {
        concepts: scan.concepts,
        deprecated: scan.deprecated,
        newest_change_ms: scan.newest_change_ms,
        findings,
        okf: okf.state,
        checked_at,
    }
}

// ---- where things live ----

pub struct Places {
    registry: PathBuf,
    runs_root: PathBuf,
    managers_dir: PathBuf,
}

impl Places {
    fn of(app: &tauri::AppHandle) -> Result<Self, String> {
        let data = app_data_dir(app)?;
        Ok(Self {
            registry: data.join(REGISTRY_FILE_NAME),
            runs_root: runs_root(app)?,
            managers_dir: data.join(MANAGERS_DIR_NAME),
        })
    }

    fn validation_file(&self, key: &str) -> PathBuf {
        self.managers_dir.join(key).join(VALIDATION_FILE_NAME)
    }

    fn bundle_of(&self, record: &ManagerRecord) -> Result<PathBuf, String> {
        let run = resolve_run_dir(
            &self.runs_root,
            &self.runs_root.join(&record.run_dir).to_string_lossy(),
        )?;
        Ok(run.join(&layout::layout().bundle_dir))
    }
}

fn read_stored(file: &Path) -> Option<ManagerMemorySummary> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

// ---- the two operations ----

/// The last stored result; before the first check, a fresh layout walk with
/// okf `never`, which stores nothing.
pub async fn memory_of(places: &Places, key: &str) -> Result<ManagerMemorySummary, String> {
    let record = find_record(&places.registry, key)?;
    if let Some(stored) = read_stored(&places.validation_file(key)) {
        return Ok(stored);
    }
    let bundle = places.bundle_of(&record)?;
    let scan = blocking(move || layout::scan(&bundle)).await?;
    Ok(compose(scan, never_checked(), None))
}

pub struct Validation {
    pub manager_name: String,
    pub summary: ManagerMemorySummary,
    /// What okf said the time before, for the regression rule.
    pub previous: OkfState,
}

/// Both checks now, stored.
pub async fn validate_memory(places: &Places, key: &str) -> Result<Validation, String> {
    let record = find_record(&places.registry, key)?;
    let bundle = places.bundle_of(&record)?;
    let reading = okf::validate(&bundle).await;
    store_validation(places, &record, bundle, reading).await
}

/// The layout check, composed with what okf said, stored as the last result.
async fn store_validation(
    places: &Places,
    record: &ManagerRecord,
    bundle: PathBuf,
    reading: okf::OkfReading,
) -> Result<Validation, String> {
    let scan = blocking(move || layout::scan(&bundle)).await?;
    let summary = compose(scan, reading, Some(timestamp_now()));
    let file = places.validation_file(&record.key);
    let previous = read_stored(&file).map_or(OkfState::Never, |stored| stored.okf);
    write_json_atomic(&file, &summary)?;
    Ok(Validation {
        manager_name: record.name.clone(),
        summary,
        previous,
    })
}

/// The check and, when okf stopped working since the last one, the inbox note.
async fn validate_and_announce(
    app: &tauri::AppHandle,
    places: &Places,
    key: &str,
) -> Result<ManagerMemorySummary, String> {
    let done = validate_memory(places, key).await?;
    if is_regression(done.previous, done.summary.okf) {
        notify(
            app,
            &regression_notification(&done.manager_name, done.summary.okf),
        );
    }
    Ok(done.summary)
}

fn never_checked() -> okf::OkfReading {
    okf::OkfReading {
        state: OkfState::Never,
        findings: Vec::new(),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("The memory check was interrupted: {error}"))
}

// ---- the one notification ----

/// A tool that worked and then broke is news; one that was never there is not.
fn is_regression(previous: OkfState, now: OkfState) -> bool {
    previous.worked() && now.broke()
}

fn regression_notification(manager: &str, now: OkfState) -> NotificationInput {
    let cause = match now {
        OkfState::Missing => "okf is no longer found on this machine",
        OkfState::Outdated => "the installed okf is older than the version it is checked against",
        OkfState::Unrecognised => "the installed okf printed something this app cannot read",
        _ => "okf did not finish its check",
    };
    NotificationInput {
        uid: None,
        project_path: None,
        project_name: None,
        source: "system".to_string(),
        origin: Some("machine".to_string()),
        kind: Some("info".to_string()),
        severity: Some("info".to_string()),
        title: "Memory check stopped working".to_string(),
        body: Some(format!(
            "The memory of '{manager}' could not be checked: {cause}. \
             The Project Manager keeps working; Settings > Machine shows how to fix it."
        )),
        actions: None,
        dedupe_key: Some(format!("machine:okf:{}", now.name())),
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    }
}

fn notify(app: &tauri::AppHandle, input: &NotificationInput) {
    let Some(state) = app.try_state::<crate::notifications::NotificationsState>() else {
        return;
    };
    let Ok(mut conn) = state.conn.lock() else {
        return;
    };
    if let Err(error) = crate::notifications::dispatch_impl(&mut conn, input) {
        eprintln!("Project Manager memory: could not record a notification: {error}");
    }
}

// ---- after a session ----

/// The manager an ended supervisor session belonged to: by its key, else by
/// the run folder it worked in.
fn manager_of_session<'a>(
    managers: &'a [ManagerRecord],
    runs_root: &Path,
    agent: &AgentInfo,
) -> Option<&'a ManagerRecord> {
    if let Some(key) = &agent.supervisor_key {
        if let Some(found) = managers.iter().find(|record| &record.key == key) {
            return Some(found);
        }
    }
    let worked_in = Path::new(agent.repo_path.as_deref()?).canonicalize().ok()?;
    managers.iter().find(|record| {
        runs_root
            .join(&record.run_dir)
            .canonicalize()
            .is_ok_and(|run| run == worked_in)
    })
}

async fn check_after_session(app: &tauri::AppHandle, agent: &AgentInfo) {
    let Ok(places) = Places::of(app) else { return };
    let managers = list(&places.registry).managers;
    let Some(record) = manager_of_session(&managers, &places.runs_root, agent) else {
        return;
    };
    if let Err(error) = validate_and_announce(app, &places, &record.key).await {
        eprintln!("Project Manager memory: {error}");
    }
}

/// Listens for the end of supervisor sessions for the app's lifetime.
pub fn start(app: &tauri::AppHandle) {
    let ended = app.state::<RunResultsState>().subscribe_session_ends();
    let app = app.clone();
    std::thread::spawn(move || {
        for agent in ended {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { check_after_session(&app, &agent).await });
        }
    });
}

// ---- Tauri commands ----

#[tauri::command(async)]
pub async fn manager_memory(
    app: tauri::AppHandle,
    key: String,
) -> Result<ManagerMemorySummary, String> {
    memory_of(&Places::of(&app)?, &key).await
}

#[tauri::command(async)]
pub async fn manager_validate(
    app: tauri::AppHandle,
    key: String,
) -> Result<ManagerMemorySummary, String> {
    validate_and_announce(&app, &Places::of(&app)?, &key).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supervisor::managers::promote;
    use serde_json::json;

    struct Setup {
        _dir: tempfile::TempDir,
        places: Places,
        record: ManagerRecord,
    }

    fn setup() -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let runs_root = dir.path().join("runs");
        std::fs::create_dir_all(runs_root.join("2026-10-01_090000")).unwrap();
        let places = Places {
            registry: dir.path().join(REGISTRY_FILE_NAME),
            runs_root: runs_root.clone(),
            managers_dir: dir.path().join(MANAGERS_DIR_NAME),
        };
        let record = promote(
            &places.registry,
            &runs_root,
            "2026-10-01_090000",
            "Release Desk",
            &[],
        )
        .unwrap();
        Setup {
            _dir: dir,
            places,
            record,
        }
    }

    fn reading(state: OkfState, codes: &[&str]) -> okf::OkfReading {
        okf::OkfReading {
            state,
            findings: codes
                .iter()
                .map(|code| MemoryFinding {
                    source: FindingSource::Okf,
                    code: (*code).to_string(),
                    path: None,
                    message: "m".to_string(),
                })
                .collect(),
        }
    }

    fn bundle(setup: &Setup) -> PathBuf {
        setup.places.bundle_of(&setup.record).unwrap()
    }

    #[test]
    fn our_findings_come_first_and_the_summary_stops_at_twenty() {
        let layout_findings = (0..15)
            .map(|n| MemoryFinding {
                source: FindingSource::Layout,
                code: "missing_field".to_string(),
                path: Some(format!("facts/{n}.md")),
                message: "m".to_string(),
            })
            .collect();
        let scan = layout::Scan {
            findings: layout_findings,
            ..Default::default()
        };
        let okf_codes = ["okf_orphan"; 15];
        let summary = compose(scan, reading(OkfState::Findings, &okf_codes), None);
        assert_eq!(summary.findings.len(), 20);
        assert_eq!(summary.findings[14].source, FindingSource::Layout);
        assert_eq!(summary.findings[15].source, FindingSource::Okf);
    }

    #[test]
    fn the_wire_shape_is_what_the_typescript_side_reads() {
        let summary = ManagerMemorySummary {
            concepts: BTreeMap::from([("Decision".to_string(), 2)]),
            deprecated: 1,
            newest_change_ms: Some(1_790_000_000_000),
            findings: vec![MemoryFinding {
                source: FindingSource::Layout,
                code: "missing_field".to_string(),
                path: None,
                message: "m".to_string(),
            }],
            okf: OkfState::Unrecognised,
            checked_at: Some("2026-10-22T10:00:00Z".to_string()),
        };
        assert_eq!(
            serde_json::to_value(&summary).unwrap(),
            json!({
                "concepts": {"Decision": 2},
                "deprecated": 1,
                "newestChangeMs": 1_790_000_000_000_u64,
                "findings": [{"source": "layout", "code": "missing_field", "path": null, "message": "m"}],
                "okf": "unrecognised",
                "checkedAt": "2026-10-22T10:00:00Z",
            })
        );
    }

    #[tokio::test]
    async fn before_the_first_check_memory_is_counted_live_and_okf_is_never() {
        let setup = setup();
        let facts = bundle(&setup).join("facts");
        std::fs::create_dir_all(&facts).unwrap();
        std::fs::write(
            facts.join("a.md"),
            "---\ntype: Fact\ntitle: t\ndescription: d\nstatus: draft\n---\n",
        )
        .unwrap();
        let summary = memory_of(&setup.places, &setup.record.key).await.unwrap();
        assert_eq!(summary.okf, OkfState::Never);
        assert_eq!(summary.checked_at, None);
        assert_eq!(summary.concepts, BTreeMap::from([("Fact".to_string(), 1)]));
        assert!(!setup.places.validation_file(&setup.record.key).exists());
    }

    #[tokio::test]
    async fn a_validation_is_stored_and_memory_answers_with_the_stored_result() {
        let setup = setup();
        let done = store_validation(
            &setup.places,
            &setup.record,
            bundle(&setup),
            reading(OkfState::Ok, &[]),
        )
        .await
        .unwrap();
        assert_eq!(done.previous, OkfState::Never);
        assert_eq!(done.manager_name, "Release Desk");
        assert!(done.summary.checked_at.is_some());
        std::fs::write(
            bundle(&setup).join("facts-new.md"),
            "not counted, only the stored answer is read",
        )
        .unwrap();
        let cached = memory_of(&setup.places, &setup.record.key).await.unwrap();
        assert_eq!(cached, done.summary);
    }

    #[tokio::test]
    async fn the_second_validation_knows_what_okf_said_before() {
        let setup = setup();
        for (state, expected_previous) in [
            (OkfState::Findings, OkfState::Never),
            (OkfState::Missing, OkfState::Findings),
        ] {
            let done = store_validation(
                &setup.places,
                &setup.record,
                bundle(&setup),
                reading(state, &[]),
            )
            .await
            .unwrap();
            assert_eq!(done.previous, expected_previous);
        }
    }

    #[tokio::test]
    async fn an_unknown_key_is_refused_by_both_operations() {
        let setup = setup();
        assert!(memory_of(&setup.places, "nobody").await.is_err());
        assert!(validate_memory(&setup.places, "nobody").await.is_err());
    }

    #[test]
    fn only_a_tool_that_worked_and_then_broke_is_news() {
        use OkfState::*;
        for previous in [Ok, Findings] {
            for now in [Missing, Outdated, Unrecognised, Failed] {
                assert!(is_regression(previous, now), "{previous:?} -> {now:?}");
            }
            assert!(!is_regression(previous, Ok));
            assert!(!is_regression(previous, Findings));
        }
        for previous in [Never, Missing, Outdated, Unrecognised, Failed] {
            for now in [Missing, Outdated, Unrecognised, Failed, Ok] {
                assert!(!is_regression(previous, now), "{previous:?} -> {now:?}");
            }
        }
    }

    #[test]
    fn the_regression_note_is_deduped_per_state_and_says_which_manager() {
        let note = regression_notification("Release Desk", OkfState::Missing);
        assert_eq!(note.dedupe_key.as_deref(), Some("machine:okf:missing"));
        assert_eq!(note.severity.as_deref(), Some("info"));
        assert!(note.body.unwrap().contains("Release Desk"));
        assert_eq!(
            regression_notification("x", OkfState::Failed)
                .dedupe_key
                .as_deref(),
            Some("machine:okf:failed")
        );
    }

    fn session(key: Option<&str>, repo: Option<&Path>) -> AgentInfo {
        let mut agent = crate::control_socket::protocol::tests::sample_agent();
        agent.supervisor_key = key.map(str::to_string);
        agent.repo_path = repo.map(|path| path.to_string_lossy().into_owned());
        agent
    }

    #[test]
    fn a_session_belongs_to_the_manager_by_key_or_by_folder() {
        let setup = setup();
        let managers = vec![setup.record.clone()];
        let root = &setup.places.runs_root;
        let by_key = session(Some(&setup.record.key), None);
        assert_eq!(
            manager_of_session(&managers, root, &by_key).map(|m| &m.key),
            Some(&setup.record.key)
        );
        let run = root.join(&setup.record.run_dir);
        let by_folder = session(Some("other"), Some(&run));
        assert_eq!(
            manager_of_session(&managers, root, &by_folder).map(|m| &m.key),
            Some(&setup.record.key)
        );
        let elsewhere = session(None, Some(root));
        assert!(manager_of_session(&managers, root, &elsewhere).is_none());
        assert!(manager_of_session(&managers, root, &session(None, None)).is_none());
    }
}
