//! A Project Manager's memory as the IDE sees it: what is in `knowledge/`,
//! which rules of our layout it breaks, and what `okf validate` makes of it.
//!
//! Two checks, two owners. The layout check (`layout.rs`) is ours and needs no
//! tool. The okf check (`okf.rs`) runs when okf is on the machine. Rust runs
//! both, never the agent: after a manager session ends, and on demand from the
//! inspector. The result is stored in
//! `<app_data_dir>/managers/<key>/validation.json`.

mod layout;
mod okf;

pub use layout::LastSession;

use super::managers::{
    find_record, list, record_session_noted, resolve_manager_run, timestamp_now, ManagerRecord,
    REGISTRY_FILE_NAME, VALIDATION_FILE_NAME,
};
use super::runs::runs_root;
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
    /// The newest session note the manager wrote; absent in results stored
    /// before it existed.
    #[serde(default)]
    pub last_session: Option<LastSession>,
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
        last_session: scan.last_session,
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
        let run = resolve_manager_run(&self.runs_root, &record.run_dir)?;
        Ok(run.join(&layout::layout().bundle_dir))
    }
}

/// The summary as written to disk, with the identity of the manager it was
/// made for. A key can be given out again after a removal; the identity is what
/// keeps the next manager from inheriting the old one's findings.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredValidation {
    run_dir: String,
    promoted_at: String,
    #[serde(flatten)]
    summary: ManagerMemorySummary,
}

fn read_stored(file: &Path, record: &ManagerRecord) -> Option<ManagerMemorySummary> {
    let stored: StoredValidation = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (stored.run_dir == record.run_dir && stored.promoted_at == record.promoted_at)
        .then_some(stored.summary)
}

/// Removes the stored results of managers that are no longer in the registry.
fn prune_orphaned_validations(places: &Places, kept_keys: &[&str]) {
    let Ok(entries) = std::fs::read_dir(&places.managers_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let is_orphan = entry
            .file_name()
            .to_str()
            .is_some_and(|name| !kept_keys.contains(&name));
        if is_orphan && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

// ---- the two operations ----

/// The last stored result; before the first check, a fresh layout walk with
/// okf `never`, which stores nothing.
pub async fn memory_of(places: &Places, key: &str) -> Result<ManagerMemorySummary, String> {
    let record = find_record(&places.registry, key)?;
    // A manager whose folder is gone still has its stored result to show.
    let bundle = places.bundle_of(&record);
    let fresh_session = match &bundle {
        Ok(bundle) => {
            let bundle = bundle.clone();
            blocking(move || layout::last_session(&bundle)).await?
        }
        Err(_) => None,
    };
    if let Some(mut stored) = read_stored(&places.validation_file(key), &record) {
        // Where the manager stands must not wait for the next check.
        stored.last_session = fresh_session;
        return Ok(stored);
    }
    let bundle = bundle?;
    let scan = blocking(move || layout::scan(&bundle)).await?;
    Ok(compose(scan, never_checked(), None))
}

/// How many problems a check found, before the cap on what is listed.
/// `scan_truncated` is no problem of the memory, only of the walk, and says
/// the count is a floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProblemCount {
    pub count: usize,
    pub at_least: bool,
}

fn count_problems(
    layout_findings: &[MemoryFinding],
    okf_findings: &[MemoryFinding],
) -> ProblemCount {
    let truncated = |finding: &&MemoryFinding| finding.code == layout::SCAN_TRUNCATED;
    ProblemCount {
        count: layout_findings.iter().filter(|f| !truncated(f)).count() + okf_findings.len(),
        at_least: layout_findings.iter().any(|f| truncated(&f)),
    }
}

pub struct Validation {
    pub manager_name: String,
    pub summary: ManagerMemorySummary,
    pub problems: ProblemCount,
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
    let problems = count_problems(&scan.findings, &reading.findings);
    let summary = compose(scan, reading, Some(timestamp_now()));
    let file = places.validation_file(&record.key);
    let previous = read_stored(&file, record).map_or(OkfState::Never, |stored| stored.okf);
    let stored = StoredValidation {
        run_dir: record.run_dir.clone(),
        promoted_at: record.promoted_at.clone(),
        summary,
    };
    write_json_atomic(&file, &stored)?;
    let summary = stored.summary;
    Ok(Validation {
        manager_name: record.name.clone(),
        summary,
        problems,
        previous,
    })
}

/// The check and, when okf stopped working since the last one, the inbox note.
async fn validate_and_announce(
    app: &tauri::AppHandle,
    places: &Places,
    key: &str,
) -> Result<Validation, String> {
    let done = validate_memory(places, key).await?;
    if is_regression(done.previous, done.summary.okf) {
        notify(
            app,
            &regression_notification(&done.manager_name, done.summary.okf),
        );
    }
    Ok(done)
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

fn rfc3339_ms(text: &str) -> Option<u64> {
    let parsed = chrono::DateTime::parse_from_rfc3339(text).ok()?;
    u64::try_from(parsed.timestamp_millis()).ok()
}

/// Fixture `sessionEnd`: one quiet note per ended session, saying what the
/// manager wrote down, or plainly that it wrote nothing. A session is
/// identified by its start, which both ways of finding out that it ended
/// know, so it counts once.
fn session_end_notification(
    manager: &ManagerRecord,
    note: Option<&str>,
    problems: ProblemCount,
    session_started_ms: u64,
) -> NotificationInput {
    let mut body = match note.map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => text.to_string(),
        None => format!(
            "{} ended this session without writing a session note.",
            manager.name
        ),
    };
    let found = match (problems.count, problems.at_least) {
        (0, false) => None,
        (1, false) => Some("1 problem".to_string()),
        (count, false) => Some(format!("{count} problems")),
        (1, true) => Some("at least 1 problem".to_string()),
        (count, true) => Some(format!("at least {count} problems")),
    };
    if let Some(found) = found {
        body.push_str(&format!(" The memory check found {found}."));
    }
    NotificationInput {
        uid: None,
        project_path: None,
        project_name: None,
        source: "system".to_string(),
        origin: Some("manager".to_string()),
        kind: Some("info".to_string()),
        severity: Some("info".to_string()),
        title: format!("{} finished a session", manager.name),
        body: Some(body),
        actions: Some(serde_json::json!([{
            "id": format!("open-manager:{}", manager.key),
            "kind": "open-manager",
            "label": format!("Open {}", manager.name),
            "managerKey": manager.key,
            "managerName": manager.name,
        }])),
        dedupe_key: Some(format!(
            "manager-session:{}:{session_started_ms}",
            manager.key
        )),
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

/// When a session began: the start the registry booked for it, the one thing
/// the exit path and the catch-up share; for an entry that predates the
/// booking, the process's own start.
fn session_started_ms(record: &ManagerRecord, agent: &AgentInfo) -> u64 {
    record
        .session
        .as_ref()
        .and_then(|book| rfc3339_ms(&book.started_at))
        .unwrap_or(agent.started_at / 1000 * 1000)
}

/// Whether the registry already has this session's note booked.
fn is_noted(record: &ManagerRecord, started_ms: u64) -> bool {
    record.session.as_ref().is_some_and(|book| {
        book.noted_at.as_deref() == Some(book.started_at.as_str())
            && rfc3339_ms(&book.started_at) == Some(started_ms)
    })
}

/// The check of a session that ended, then its one note, then the booking
/// that it has had it.
async fn finish_session(
    app: &tauri::AppHandle,
    places: &Places,
    record: &ManagerRecord,
    started_ms: u64,
) {
    if is_noted(record, started_ms) {
        return;
    }
    let done = match validate_and_announce(app, places, &record.key).await {
        Ok(done) => done,
        Err(error) => return eprintln!("Project Manager memory: {error}"),
    };
    let note = match places.bundle_of(record) {
        Ok(bundle) => blocking(move || layout::session_note_since(&bundle, started_ms))
            .await
            .unwrap_or_default(),
        Err(_) => None,
    };
    notify(
        app,
        &session_end_notification(record, note.as_deref(), done.problems, started_ms),
    );
    if let Some(book) = &record.session {
        if rfc3339_ms(&book.started_at) == Some(started_ms) {
            if let Err(error) =
                record_session_noted(&places.registry, &record.key, &book.started_at)
            {
                eprintln!("Project Manager memory: {error}");
            }
        }
    }
}

async fn check_after_session(app: &tauri::AppHandle, agent: &AgentInfo) {
    let Ok(places) = Places::of(app) else { return };
    let managers = list(&places.registry).managers;
    let Some(record) = manager_of_session(&managers, &places.runs_root, agent) else {
        return;
    };
    finish_session(app, &places, record, session_started_ms(record, agent)).await;
}

/// Managers with a session that has no note booked: an app quit, a crash or
/// a power cut ends a session without the exit path. An entry without a
/// booked session is not caught up. Run at app start, before anything is
/// restored, so no manager is live. Pairs each with its session start.
fn unnoted_sessions(places: &Places, managers: &[ManagerRecord]) -> Vec<(ManagerRecord, u64)> {
    managers
        .iter()
        .filter(|record| record.archived_at.is_none())
        .filter_map(|record| {
            let started = rfc3339_ms(&record.session.as_ref()?.started_at)?;
            places.bundle_of(record).ok()?;
            (!is_noted(record, started)).then(|| (record.clone(), started))
        })
        .collect()
}

/// Listens for the end of supervisor sessions for the app's lifetime, and
/// catches up on the ones that ended while the app was not listening.
pub fn start(app: &tauri::AppHandle) {
    if let Ok(places) = Places::of(app) {
        let registry = list(&places.registry);
        if registry.error.is_none() {
            let keys: Vec<&str> = registry.managers.iter().map(|m| m.key.as_str()).collect();
            prune_orphaned_validations(&places, &keys);
            for (record, started_ms) in unnoted_sessions(&places, &registry.managers) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(places) = Places::of(&app) {
                        finish_session(&app, &places, &record, started_ms).await;
                    }
                });
            }
        }
    }
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
    let done = validate_and_announce(&app, &Places::of(&app)?, &key).await?;
    Ok(done.summary)
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
            last_session: Some(LastSession {
                title: "Sync".to_string(),
                description: "Agreed.".to_string(),
                at_ms: 1_790_000_000_001,
                path: "sessions/sync.md".to_string(),
            }),
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
                "lastSession": {"title": "Sync", "description": "Agreed.", "atMs": 1_790_000_000_001_u64, "path": "sessions/sync.md"},
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
    async fn the_last_session_is_read_fresh_even_when_a_stored_result_exists() {
        let setup = setup();
        store_validation(
            &setup.places,
            &setup.record,
            bundle(&setup),
            reading(OkfState::Ok, &[]),
        )
        .await
        .unwrap();
        assert_eq!(
            memory_of(&setup.places, &setup.record.key)
                .await
                .unwrap()
                .last_session,
            None
        );

        let sessions = bundle(&setup).join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        std::fs::write(
            sessions.join("new.md"),
            "---\ntype: Session\ntitle: T\ndescription: Just written.\nstatus: stable\n---\n",
        )
        .unwrap();

        let summary = memory_of(&setup.places, &setup.record.key).await.unwrap();
        assert_eq!(summary.last_session.unwrap().description, "Just written.");
        assert_eq!(
            summary.okf,
            OkfState::Ok,
            "the rest stays the stored result"
        );
        assert!(summary.checked_at.is_some());
    }

    #[tokio::test]
    async fn a_manager_that_reuses_a_removed_ones_key_does_not_inherit_its_findings() {
        let setup = setup();
        store_validation(
            &setup.places,
            &setup.record,
            bundle(&setup),
            reading(OkfState::Findings, &["okf_orphan"]),
        )
        .await
        .unwrap();
        let file = setup.places.validation_file(&setup.record.key);
        assert!(read_stored(&file, &setup.record).is_some());
        let other_run = ManagerRecord {
            run_dir: "2026-10-02_090000".to_string(),
            ..setup.record.clone()
        };
        assert!(read_stored(&file, &other_run).is_none());
        let promoted_later = ManagerRecord {
            promoted_at: "2099-01-01T00:00:00Z".to_string(),
            ..setup.record.clone()
        };
        assert!(read_stored(&file, &promoted_later).is_none());
    }

    #[test]
    fn stored_results_of_managers_that_are_gone_are_deleted() {
        let setup = setup();
        for key in ["kept", "gone"] {
            let file = setup.places.validation_file(key);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "{}").unwrap();
        }
        prune_orphaned_validations(&setup.places, &["kept"]);
        assert!(setup.places.validation_file("kept").exists());
        assert!(!setup.places.validation_file("gone").exists());
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

    fn desk() -> ManagerRecord {
        let setup = setup();
        setup.record
    }

    const NO_PROBLEMS: ProblemCount = ProblemCount {
        count: 0,
        at_least: false,
    };

    fn problems(count: usize, at_least: bool) -> ProblemCount {
        ProblemCount { count, at_least }
    }

    #[test]
    fn a_note_written_during_the_session_is_the_body() {
        let note =
            session_end_notification(&desk(), Some("Agreed the cadence."), NO_PROBLEMS, 1_000);
        assert_eq!(note.title, "Release Desk finished a session");
        assert_eq!(note.body.as_deref(), Some("Agreed the cadence."));
        assert_eq!(note.kind.as_deref(), Some("info"));
        assert_eq!(note.source, "system");
        assert_eq!(
            note.actions,
            Some(json!([{
                "id": "open-manager:release-desk",
                "kind": "open-manager",
                "label": "Open Release Desk",
                "managerKey": "release-desk",
                "managerName": "Release Desk",
            }]))
        );
    }

    #[test]
    fn no_note_or_an_empty_one_says_so_plainly_and_never_starts_with_a_space() {
        let expected = "Release Desk ended this session without writing a session note.";
        for note in [None, Some(""), Some("   ")] {
            let body = session_end_notification(&desk(), note, NO_PROBLEMS, 1_000)
                .body
                .unwrap();
            assert_eq!(body, expected, "{note:?}");
            let with_problems = session_end_notification(&desk(), note, problems(2, false), 1_000)
                .body
                .unwrap();
            assert!(!with_problems.starts_with(' '), "{with_problems:?}");
        }
    }

    #[test]
    fn memory_problems_are_counted_after_either_body_and_a_truncated_scan_says_at_least() {
        let body = |note, found| {
            session_end_notification(&desk(), note, found, 1_000)
                .body
                .unwrap()
        };
        assert_eq!(
            body(Some("Agreed."), problems(1, false)),
            "Agreed. The memory check found 1 problem."
        );
        assert_eq!(
            body(None, problems(35, false)),
            "Release Desk ended this session without writing a session note. The memory check found 35 problems."
        );
        assert_eq!(
            body(Some("Agreed."), problems(10_000, true)),
            "Agreed. The memory check found at least 10000 problems."
        );
    }

    #[test]
    fn problems_are_counted_before_the_cap_and_without_the_truncation_marker() {
        let finding = |code: &str| MemoryFinding {
            source: FindingSource::Layout,
            code: code.to_string(),
            path: None,
            message: "m".to_string(),
        };
        let mut found: Vec<MemoryFinding> = (0..30).map(|_| finding("missing_field")).collect();
        assert_eq!(count_problems(&found, &[]), problems(30, false));
        found.insert(0, finding(layout::SCAN_TRUNCATED));
        let okf = [finding("okf_orphan"), finding("okf_orphan")];
        assert_eq!(count_problems(&found, &okf), problems(32, true));
    }

    #[test]
    fn a_session_is_identified_by_its_start_so_it_is_one_note_whichever_way_it_is_found() {
        let key = |started| {
            session_end_notification(&desk(), None, NO_PROBLEMS, started)
                .dedupe_key
                .unwrap()
        };
        assert_eq!(key(1_000), "manager-session:release-desk:1000");
        assert_ne!(key(1_000), key(2_000));
    }

    fn session_started(record: &mut ManagerRecord, at: &str, noted: bool) {
        record.session = Some(super::super::managers::SessionBook {
            started_at: at.to_string(),
            noted_at: noted.then(|| at.to_string()),
        });
    }

    #[tokio::test]
    async fn a_session_the_exit_path_never_saw_is_caught_up_even_after_a_check_during_it() {
        let mut setup = setup();
        let started = rfc3339_ms("2026-10-23T09:00:00Z").unwrap();

        // No session booked (an entry from before the booking): not caught up.
        assert!(unnoted_sessions(&setup.places, &[setup.record.clone()]).is_empty());

        session_started(&mut setup.record, "2026-10-23T09:00:00Z", false);
        let found = unnoted_sessions(&setup.places, &[setup.record.clone()]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].1, started);

        // An on-demand validate while the session ran, then a crash.
        store_validation(
            &setup.places,
            &setup.record,
            bundle(&setup),
            reading(OkfState::Ok, &[]),
        )
        .await
        .unwrap();
        assert_eq!(
            unnoted_sessions(&setup.places, &[setup.record.clone()]).len(),
            1
        );

        session_started(&mut setup.record, "2026-10-23T09:00:00Z", true);
        assert!(unnoted_sessions(&setup.places, &[setup.record.clone()]).is_empty());
    }

    #[test]
    fn archived_managers_and_managers_without_a_folder_are_not_caught_up() {
        let mut setup = setup();
        session_started(&mut setup.record, "2026-10-23T09:00:00Z", false);
        let archived = ManagerRecord {
            archived_at: Some("2026-10-23T10:00:00Z".to_string()),
            ..setup.record.clone()
        };
        assert!(unnoted_sessions(&setup.places, &[archived]).is_empty());
        std::fs::remove_dir_all(setup.places.runs_root.join(&setup.record.run_dir)).unwrap();
        assert!(unnoted_sessions(&setup.places, &[setup.record.clone()]).is_empty());
    }

    fn row_count(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM notifications", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn both_paths_book_the_same_session_under_one_key_and_one_row() {
        let mut setup = setup();
        session_started(&mut setup.record, "2026-10-23T09:00:00Z", false);
        let mut agent = session(Some("release-desk"), None);
        agent.started_at = 1_792_746_000_321;

        let exit_start = session_started_ms(&setup.record, &agent);
        let (_, catch_up_start) = unnoted_sessions(&setup.places, &[setup.record.clone()])
            .pop()
            .unwrap();
        assert_eq!(exit_start, catch_up_start);

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::notifications::run_migrations(&conn).unwrap();
        for start in [exit_start, catch_up_start] {
            let note = session_end_notification(&setup.record, None, NO_PROBLEMS, start);
            crate::notifications::dispatch_impl(&mut conn, &note).unwrap();
        }
        assert_eq!(row_count(&conn), 1);
    }

    #[test]
    fn a_restored_session_is_its_own_session_with_its_own_note() {
        let mut setup = setup();
        let agent = session(Some("release-desk"), None);
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::notifications::run_migrations(&conn).unwrap();
        for started_at in ["2026-10-23T09:00:00Z", "2026-10-23T14:00:00Z"] {
            // The earlier session is noted before the restore starts the next.
            session_started(&mut setup.record, started_at, false);
            let start = session_started_ms(&setup.record, &agent);
            let note = session_end_notification(&setup.record, None, NO_PROBLEMS, start);
            crate::notifications::dispatch_impl(&mut conn, &note).unwrap();
        }
        assert_eq!(row_count(&conn), 2);
    }

    #[test]
    fn a_session_with_its_note_booked_is_not_finished_twice() {
        let mut setup = setup();
        session_started(&mut setup.record, "2026-10-23T09:00:00Z", true);
        let started = rfc3339_ms("2026-10-23T09:00:00Z").unwrap();
        assert!(is_noted(&setup.record, started));
        assert!(!is_noted(&setup.record, started + 1_000));
        session_started(&mut setup.record, "2026-10-23T09:00:00Z", false);
        assert!(!is_noted(&setup.record, started));
    }

    #[test]
    fn the_session_starts_where_the_registry_booked_it_not_at_the_launch() {
        let mut setup = setup();
        setup.record.last_launch = Some(super::super::managers::LastLaunch {
            at: "2026-10-22T08:00:00Z".to_string(),
            instructions_sha256: String::new(),
        });
        session_started(&mut setup.record, "2026-10-23T09:00:00Z", false);
        let agent = session(None, None);
        assert_eq!(
            session_started_ms(&setup.record, &agent),
            rfc3339_ms("2026-10-23T09:00:00Z").unwrap()
        );
    }

    #[test]
    fn without_a_booked_session_the_start_is_the_process_start_floored() {
        let setup = setup();
        let mut agent = session(None, None);
        agent.started_at = 1_792_746_000_999;
        assert_eq!(session_started_ms(&setup.record, &agent), 1_792_746_000_000);
    }

    #[tokio::test]
    async fn a_manager_whose_folder_is_gone_still_answers_with_its_stored_summary() {
        let setup = setup();
        store_validation(
            &setup.places,
            &setup.record,
            bundle(&setup),
            reading(OkfState::Ok, &[]),
        )
        .await
        .unwrap();
        std::fs::remove_dir_all(setup.places.runs_root.join(&setup.record.run_dir)).unwrap();

        let summary = memory_of(&setup.places, &setup.record.key).await.unwrap();

        assert_eq!(summary.okf, OkfState::Ok);
        assert_eq!(summary.last_session, None);
    }

    #[tokio::test]
    async fn a_gone_folder_without_a_stored_summary_is_named_by_folder_not_path() {
        let setup = setup();
        std::fs::remove_dir_all(setup.places.runs_root.join(&setup.record.run_dir)).unwrap();
        let error = memory_of(&setup.places, &setup.record.key)
            .await
            .unwrap_err();
        assert_eq!(
            error,
            "The supervisor run folder '2026-10-01_090000' no longer exists."
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
