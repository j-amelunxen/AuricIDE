//! Changes to the link policy that a supervisor proposes and a person
//! approves (`docs/design-supervisor-link.md`, "Policy proposals").
//!
//! A supervisor plans with `link_policy_get` and asks with
//! `link_policy_propose` (both on the control socket, supervisor callers
//! only). The change is checked against the policy as it stands, stored as a
//! pending proposal with a readable diff, and announced in the inbox with
//! Apply and Discard. Nothing changes until a person presses Apply in the IDE:
//! deciding is a Tauri command, which only the IDE's own window can call — no
//! socket method decides, so no agent and no client can approve its own
//! request. A proposal is applied only onto the policy it was made against;
//! after 24 hours, or once the policy changed, it is gone. Every outcome is
//! appended to an audit log.

use super::policy::{
    self, check_stored, is_relative_file, read_stored, stored_payload, write_private_atomic,
    write_stored, DocumentType, JobKind, ProjectEntry, StoredPolicy, MAX_DAILY_LIMIT,
};
use crate::notifications::NotificationInput;
use crate::supervisor::canonical_project_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Fixture `proposals.fileName` / `proposals.auditFileName`.
pub const PROPOSALS_FILE_NAME: &str = "supervisor-link-proposals.json";
pub const AUDIT_FILE_NAME: &str = "supervisor-link-policy-audit.jsonl";
/// Fixture `proposals.expiryHours`.
pub const PROPOSAL_TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// Fixture `proposals.maxPending` / `maxChanges` / `maxReasonChars`.
pub const MAX_PENDING: usize = 20;
pub const MAX_CHANGES: usize = 20;
pub const MAX_REASON_CHARS: usize = 500;
/// The notification's `origin`, and the only one whose proposal buttons the
/// frontend renders (fixture `proposals.notificationOrigin`).
pub const NOTIFICATION_ORIGIN: &str = "supervisor-link-policy";

/// One structured change (fixture `proposals.ops`). There is no removal: taking
/// something away is the person's job in the settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PolicyChange {
    /// List a project, so the link sees it with the global defaults.
    ShareProject { project: String },
    /// Add or replace a global document type.
    SetDefaultDocumentType { document_type: DocumentType },
    /// Add or replace a global job kind.
    SetDefaultJobKind { job_kind: JobKind },
    /// Add or replace (override) a project's own document type.
    SetProjectDocumentType {
        project: String,
        document_type: DocumentType,
    },
    /// Add or replace (override) a project's own job kind.
    SetProjectJobKind { project: String, job_kind: JobKind },
    /// Whether a project inherits the defaults, and which it leaves out.
    SetProjectInherit {
        project: String,
        inherit: bool,
        #[serde(default)]
        disabled_document_types: Option<Vec<String>>,
        #[serde(default)]
        disabled_job_kinds: Option<Vec<String>>,
    },
    /// The daily limit over all projects.
    SetDailyLimit { daily_limit: u32 },
    /// The limit every project has unless it sets its own; `null` is none.
    SetPerProjectDailyLimit {
        per_project_daily_limit: Option<u32>,
    },
    /// One project's own daily limit; `null` falls back to the shared one.
    SetProjectDailyLimit {
        project: String,
        daily_limit: Option<u32>,
    },
}

/// Who asked: the supervisor's agent id and its name at the time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposer {
    pub agent_id: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub proposed_by: Proposer,
    pub reason: String,
    pub changes: Vec<PolicyChange>,
    /// The diff from the policy it was made against, one line per change.
    pub diff: Vec<String>,
    /// SHA-256 of the stored policy it was made against.
    pub base: String,
}

/// What became of a proposal (fixture `proposals.outcomes`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Applied,
    Discarded,
    Expired,
    /// The policy changed after the proposal; it was withdrawn unapplied.
    Outdated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub at: u64,
    pub outcome: Outcome,
    #[serde(flatten)]
    pub proposal: Proposal,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PendingFile {
    #[serde(default)]
    pending: Vec<Proposal>,
}

/// Where proposals and the audit log live; one per app data directory.
pub struct ProposalStore {
    dir: PathBuf,
}

/// A refused proposal or decision, as text for the caller.
pub type Refusal = String;

/// Serialises read-modify-write of the pending file across threads.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl ProposalStore {
    pub fn new(app_data: &Path) -> Self {
        Self {
            dir: app_data.to_path_buf(),
        }
    }

    fn pending_path(&self) -> PathBuf {
        self.dir.join(PROPOSALS_FILE_NAME)
    }

    pub fn audit_path(&self) -> PathBuf {
        self.dir.join(AUDIT_FILE_NAME)
    }

    /// A file that does not parse holds no proposal: nothing can be applied
    /// from it.
    fn read(&self) -> PendingFile {
        std::fs::read(self.pending_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write(&self, file: &PendingFile) -> Result<(), Refusal> {
        let payload = serde_json::to_vec_pretty(file).map_err(|error| error.to_string())?;
        write_private_atomic(&self.pending_path(), &payload)
    }

    /// Appends one line; created at 0600.
    fn audit(&self, entry: &AuditEntry) {
        let Ok(mut line) = serde_json::to_vec(entry) else {
            return;
        };
        line.push(b'\n');
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let written = std::fs::create_dir_all(&self.dir)
            .and_then(|_| options.open(self.audit_path()))
            .and_then(|mut file| file.write_all(&line));
        if let Err(error) = written {
            eprintln!("Supervisor link: could not write the policy audit log: {error}");
        }
    }

    /// Drops expired proposals, logging each.
    fn prune(&self, file: &mut PendingFile, now: u64) -> bool {
        let (kept, expired): (Vec<_>, Vec<_>) = std::mem::take(&mut file.pending)
            .into_iter()
            .partition(|proposal| proposal.expires_at > now);
        file.pending = kept;
        for proposal in &expired {
            self.audit(&AuditEntry {
                at: now,
                outcome: Outcome::Expired,
                proposal: proposal.clone(),
            });
        }
        !expired.is_empty()
    }

    /// The proposals still waiting, oldest first.
    pub fn pending(&self, now: u64) -> Vec<Proposal> {
        let _guard = lock();
        let mut file = self.read();
        if self.prune(&mut file, now) {
            let _ = self.write(&file);
        }
        file.pending
    }

    /// Checks and stores a proposal against the policy as it stands now.
    pub fn propose(
        &self,
        proposed_by: Proposer,
        reason: &str,
        changes: Vec<PolicyChange>,
        now: u64,
    ) -> Result<Proposal, Refusal> {
        let reason = reason.trim();
        if reason.is_empty() || reason.chars().count() > MAX_REASON_CHARS {
            return Err(format!("reason is 1 to {MAX_REASON_CHARS} characters"));
        }
        if changes.is_empty() || changes.len() > MAX_CHANGES {
            return Err(format!("changes holds 1 to {MAX_CHANGES} changes"));
        }
        let _guard = lock();
        let current = read_stored(&self.dir);
        let after = apply_changes(&current, &changes)?;
        let diff = diff_lines(&current, &after);
        if diff.is_empty() {
            return Err("the changes would leave the policy as it is".to_string());
        }
        let mut file = self.read();
        self.prune(&mut file, now);
        if file.pending.len() >= MAX_PENDING {
            return Err(format!(
                "{MAX_PENDING} proposals already wait for the human; wait until they are decided"
            ));
        }
        let proposal = Proposal {
            id: new_id(),
            created_at: now,
            expires_at: now + PROPOSAL_TTL_MS,
            proposed_by,
            reason: reason.to_string(),
            changes,
            diff,
            base: revision(&current)?,
        };
        file.pending.push(proposal.clone());
        self.write(&file)?;
        Ok(proposal)
    }

    /// The person's decision. Apply writes the policy only when it is still
    /// the one the proposal was made against; either way the proposal is
    /// gone afterwards and the outcome is logged.
    pub fn decide(&self, id: &str, apply: bool, now: u64) -> Result<Outcome, Refusal> {
        let _guard = lock();
        let mut file = self.read();
        let pruned = self.prune(&mut file, now);
        let Some(at) = file.pending.iter().position(|p| p.id == id) else {
            if pruned {
                self.write(&file)?;
            }
            return Err(
                "this proposal no longer exists: it was decided, or it expired after 24 hours"
                    .to_string(),
            );
        };
        let proposal = file.pending.remove(at);
        let outcome = if apply {
            self.apply(&proposal)?
        } else {
            Outcome::Discarded
        };
        self.write(&file)?;
        self.audit(&AuditEntry {
            at: now,
            outcome,
            proposal,
        });
        match outcome {
            Outcome::Outdated => Err(
                "the supervisor link settings changed since this proposal was made, so it was \
                 withdrawn unapplied; ask the supervisor to propose again"
                    .to_string(),
            ),
            other => Ok(other),
        }
    }

    fn apply(&self, proposal: &Proposal) -> Result<Outcome, Refusal> {
        let current = read_stored(&self.dir);
        if revision(&current)? != proposal.base {
            return Ok(Outcome::Outdated);
        }
        let after = apply_changes(&current, &proposal.changes)?;
        write_stored(&self.dir, &after)?;
        Ok(Outcome::Applied)
    }

    /// The newest audit entries, newest first.
    pub fn recent(&self, limit: usize) -> Vec<AuditEntry> {
        let Ok(text) = std::fs::read_to_string(self.audit_path()) else {
            return Vec::new();
        };
        text.lines()
            .rev()
            .filter_map(|line| serde_json::from_str(line).ok())
            .take(limit)
            .collect()
    }
}

fn new_id() -> String {
    let hex: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(12)
        .collect();
    format!("lp-{hex}")
}

/// SHA-256 of the policy as `write_stored` would put it on disk.
fn revision(policy: &StoredPolicy) -> Result<String, Refusal> {
    let payload = stored_payload(&check_stored(policy).unwrap_or_else(|_| policy.clone()))?;
    Ok(Sha256::digest(&payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

// ------------------------------------------------------------ changes ----

/// An existing folder, canonical. Proposals never list a path that is not
/// a directory on this machine.
fn project_key(project: &str) -> Result<String, Refusal> {
    if !Path::new(project).is_absolute() || !Path::new(project).is_dir() {
        return Err(format!(
            "project \"{project}\" is not an existing absolute folder"
        ));
    }
    Ok(canonical_project_path(project))
}

/// The entry for `project`, created (shared) when it is not listed yet.
fn entry_mut<'p>(
    policy: &'p mut StoredPolicy,
    project: &str,
) -> Result<&'p mut ProjectEntry, Refusal> {
    let key = project_key(project)?;
    let listed = policy
        .projects
        .keys()
        .find(|listed| canonical_project_path(listed) == key)
        .cloned()
        .unwrap_or(key);
    Ok(policy.projects.entry(listed).or_default())
}

/// A proposal may name global instructions only under `job-kinds/`: a path
/// anywhere else on the machine is something only a person types in.
fn check_proposed_kind(kind: &JobKind) -> Result<(), Refusal> {
    match kind.global_instructions.as_deref() {
        Some(global) if !is_relative_file(global) => Err(format!(
            "job kind \"{}\": a proposal may name globalInstructions only as a file under {}/; \
             an absolute path has to be set by the human in the settings",
            kind.kind,
            policy::JOB_KINDS_DIR
        )),
        _ => Ok(()),
    }
}

fn upsert<T>(items: &mut Vec<T>, item: T, same: impl Fn(&T, &T) -> bool) {
    match items.iter().position(|existing| same(existing, &item)) {
        Some(at) => items[at] = item,
        None => items.push(item),
    }
}

fn check_limit(value: Option<u32>) -> Result<(), Refusal> {
    if value.is_some_and(|n| n > MAX_DAILY_LIMIT) {
        return Err(format!("job limits are at most {MAX_DAILY_LIMIT} a day"));
    }
    Ok(())
}

// code-gate: complexity-cyclomatic - one arm per change kind, each a few lines
fn apply_change(policy: &mut StoredPolicy, change: &PolicyChange) -> Result<(), Refusal> {
    match change {
        PolicyChange::ShareProject { project } => {
            entry_mut(policy, project)?;
        }
        PolicyChange::SetDefaultDocumentType { document_type } => upsert(
            &mut policy.defaults.document_types,
            document_type.clone(),
            |a, b| a.name == b.name,
        ),
        PolicyChange::SetDefaultJobKind { job_kind } => {
            check_proposed_kind(job_kind)?;
            upsert(&mut policy.defaults.job_kinds, job_kind.clone(), |a, b| {
                a.kind == b.kind
            });
        }
        PolicyChange::SetProjectDocumentType {
            project,
            document_type,
        } => upsert(
            &mut entry_mut(policy, project)?.document_types,
            document_type.clone(),
            |a, b| a.name == b.name,
        ),
        PolicyChange::SetProjectJobKind { project, job_kind } => {
            check_proposed_kind(job_kind)?;
            upsert(
                &mut entry_mut(policy, project)?.job_kinds,
                job_kind.clone(),
                |a, b| a.kind == b.kind,
            );
        }
        PolicyChange::SetProjectInherit {
            project,
            inherit,
            disabled_document_types,
            disabled_job_kinds,
        } => {
            let entry = entry_mut(policy, project)?;
            entry.inherit = *inherit;
            if let Some(names) = disabled_document_types {
                entry.disabled_document_types = sorted_unique(names);
            }
            if let Some(names) = disabled_job_kinds {
                entry.disabled_job_kinds = sorted_unique(names);
            }
        }
        PolicyChange::SetDailyLimit { daily_limit } => {
            check_limit(Some(*daily_limit))?;
            policy.jobs.daily_limit = *daily_limit;
        }
        PolicyChange::SetPerProjectDailyLimit {
            per_project_daily_limit,
        } => {
            check_limit(*per_project_daily_limit)?;
            policy.jobs.per_project_daily_limit = *per_project_daily_limit;
        }
        PolicyChange::SetProjectDailyLimit {
            project,
            daily_limit,
        } => {
            check_limit(*daily_limit)?;
            entry_mut(policy, project)?.daily_limit = *daily_limit;
        }
    }
    Ok(())
}

fn sorted_unique(names: &[String]) -> Vec<String> {
    names
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// `changes` applied in order to `current`, and the result checked with
/// every rule a save from the settings meets.
pub fn apply_changes(
    current: &StoredPolicy,
    changes: &[PolicyChange],
) -> Result<StoredPolicy, Refusal> {
    let mut next = current.clone();
    for (index, change) in changes.iter().enumerate() {
        apply_change(&mut next, change)
            .map_err(|error| format!("change {}: {error}", index + 1))?;
    }
    check_stored(&next)
}

// --------------------------------------------------------------- diff ----

const MAX_VALUE_CHARS: usize = 400;

fn compact(value: &Value) -> String {
    let text = value.to_string();
    if text.chars().count() <= MAX_VALUE_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_VALUE_CHARS - 1).collect();
    format!("{cut}…")
}

/// The key a list element is matched by: a type's `name`, a kind's `kind`.
fn element_key(value: &Value) -> Option<&str> {
    value
        .get("name")
        .or_else(|| value.get("kind"))
        .and_then(Value::as_str)
}

fn keyed(items: &[Value]) -> Option<Vec<(&str, &Value)>> {
    items
        .iter()
        .map(|item| element_key(item).map(|key| (key, item)))
        .collect()
}

fn find_keyed<'v>(list: &[(&str, &'v Value)], key: &str) -> Option<&'v Value> {
    list.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

fn diff_value(path: &str, before: Option<&Value>, after: Option<&Value>, out: &mut Vec<String>) {
    match (before, after) {
        (Some(b), Some(a)) if b == a => {}
        (Some(Value::Object(b)), Some(Value::Object(a))) => {
            let keys: BTreeSet<&String> = b.keys().chain(a.keys()).collect();
            for key in keys {
                diff_value(&format!("{path}.{key}"), b.get(key), a.get(key), out);
            }
        }
        (Some(Value::Array(b)), Some(Value::Array(a))) => match (keyed(b), keyed(a)) {
            (Some(b), Some(a)) => {
                let mut keys: Vec<&str> = b.iter().map(|(key, _)| *key).collect();
                for (key, _) in &a {
                    if !keys.contains(key) {
                        keys.push(key);
                    }
                }
                for key in keys {
                    diff_value(
                        &format!("{path}[\"{key}\"]"),
                        find_keyed(&b, key),
                        find_keyed(&a, key),
                        out,
                    );
                }
            }
            _ => out.push(format!(
                "~ {path}: {} → {}",
                compact(&Value::Array(b.clone())),
                compact(&Value::Array(a.clone()))
            )),
        },
        (None, Some(a)) => out.push(format!("+ {path} = {}", compact(a))),
        (Some(_), None) => out.push(format!("- {path}")),
        (Some(b), Some(a)) => out.push(format!("~ {path}: {} → {}", compact(b), compact(a))),
        (None, None) => {}
    }
}

/// What changes between two stored policies, one readable line each:
/// `+` added, `~` changed (old → new), `-` removed.
pub fn diff_lines(before: &StoredPolicy, after: &StoredPolicy) -> Vec<String> {
    let as_value = |policy: &StoredPolicy| serde_json::to_value(policy).unwrap_or(Value::Null);
    let (before, after) = (as_value(before), as_value(after));
    let mut out = Vec::new();
    for section in ["defaults", "jobs"] {
        diff_value(section, before.get(section), after.get(section), &mut out);
    }
    let empty = json!({});
    let projects = |value: &Value| value.get("projects").cloned().unwrap_or(empty.clone());
    let (b, a) = (projects(&before), projects(&after));
    let keys: BTreeSet<String> = b
        .as_object()
        .into_iter()
        .chain(a.as_object())
        .flat_map(|map| map.keys().cloned())
        .collect();
    for key in keys {
        let path = format!("projects[\"{key}\"]");
        match (b.get(&key), a.get(&key)) {
            (None, Some(added)) if added == &empty => out.push(format!(
                "+ {path}: shared with the link, inherits the global defaults"
            )),
            (None, Some(added)) => {
                out.push(format!("+ {path}: shared with the link"));
                diff_value(&path, Some(&empty), Some(added), &mut out);
            }
            (before, after) => diff_value(&path, before, after, &mut out),
        }
    }
    out
}

// ------------------------------------------------------- notification ----

/// `2026-10-18 09:30:00`, the form SQLite's `datetime('now')` compares with.
fn sqlite_time(ms: u64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map(|at| at.format("%Y-%m-%d %H:%M:%S").to_string())
}

/// The inbox entry for a new proposal: the reason, the diff, and the two
/// buttons. Rust writes it as `system`; the frontend renders proposal
/// buttons only on this origin.
pub fn notification(proposal: &Proposal) -> NotificationInput {
    let who = proposal
        .proposed_by
        .name
        .as_deref()
        .unwrap_or(&proposal.proposed_by.agent_id);
    let body = format!(
        "{who} proposes a change to the supervisor link settings.\n\nReason: {}\n\n{}\n\n\
         Nothing changes until you press Apply. The proposal expires after 24 hours.",
        proposal.reason,
        proposal.diff.join("\n")
    );
    let action = |id: &str, label: &str, decision: &str| {
        json!({
            "id": id,
            "label": label,
            "kind": "policy-proposal",
            "proposalId": proposal.id,
            "decision": decision,
        })
    };
    NotificationInput {
        uid: None,
        project_path: None,
        project_name: None,
        source: "system".to_string(),
        origin: Some(NOTIFICATION_ORIGIN.to_string()),
        kind: Some("ask".to_string()),
        severity: Some("info".to_string()),
        title: "Supervisor link: change proposed".to_string(),
        body: Some(body),
        actions: Some(json!([
            action("apply", "Apply", "apply"),
            action("discard", "Discard", "discard")
        ])),
        dedupe_key: Some(format!("link-policy-proposal:{}", proposal.id)),
        ref_kind: Some("link-policy-proposal".to_string()),
        ref_id: Some(proposal.id.clone()),
        expires_at: sqlite_time(proposal.expires_at),
    }
}

// --------------------------------------------------------------- Tauri ----

/// Pending proposals and the newest decisions, for the settings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalsOverview {
    pub pending: Vec<Proposal>,
    pub recent: Vec<AuditEntry>,
}

#[tauri::command]
pub fn supervisor_link_proposals(app: tauri::AppHandle) -> Result<ProposalsOverview, String> {
    let store = ProposalStore::new(&policy::app_data_dir(&app)?);
    Ok(ProposalsOverview {
        pending: store.pending(super::jobs::now_ms()),
        recent: store.recent(20),
    })
}

/// The person's Apply or Discard. Only the IDE's window reaches this; no
/// socket has a method that decides.
#[tauri::command]
pub fn supervisor_link_proposal_decide(
    app: tauri::AppHandle,
    proposal_id: String,
    decision: String,
) -> Result<Outcome, String> {
    let apply = match decision.as_str() {
        "apply" => true,
        "discard" => false,
        other => return Err(format!("unknown decision \"{other}\"")),
    };
    ProposalStore::new(&policy::app_data_dir(&app)?).decide(
        &proposal_id,
        apply,
        super::jobs::now_ms(),
    )
}

#[cfg(test)]
#[path = "proposals_tests.rs"]
mod tests;
