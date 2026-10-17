use super::*;
use crate::supervisor_link::policy::{read_policy, LinkDefaults, Origin};
use crate::supervisor_link::test_support::{diagram_type, Project};
use serde_json::json;

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");
const NOW: u64 = 1_790_000_000_000;

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn proposer() -> Proposer {
    Proposer {
        agent_id: "agent-sup".into(),
        name: Some("Supervisor".into()),
    }
}

fn changes(value: Value) -> Vec<PolicyChange> {
    serde_json::from_value(value).unwrap()
}

/// The example from the docs: a `scene` type and a `scene.draw` kind defined
/// once, globally, and one project shared that inherits both.
fn scene_changes(project: &str) -> Vec<PolicyChange> {
    changes(json!([
        { "op": "set_default_document_type", "documentType": {
            "name": "scene", "globs": ["docs/**/*.scene.json"], "nameField": "hud.title" } },
        { "op": "set_default_job_kind", "jobKind": {
            "kind": "scene.draw", "globalInstructions": "scene.draw.md" } },
        { "op": "share_project", "project": project },
    ]))
}

struct Setup {
    app: tempfile::TempDir,
    project: Project,
}

impl Setup {
    fn new() -> Self {
        Self {
            app: tempfile::tempdir().unwrap(),
            project: Project::new(),
        }
    }

    fn store(&self) -> ProposalStore {
        ProposalStore::new(self.app.path())
    }

    fn on_disk(&self) -> Option<String> {
        std::fs::read_to_string(policy::policy_path_in(self.app.path())).ok()
    }
}

#[test]
fn the_limits_and_names_are_the_fixture() {
    let f = &fixtures()["proposals"];
    assert_eq!(f["fileName"], PROPOSALS_FILE_NAME);
    assert_eq!(f["auditFileName"], AUDIT_FILE_NAME);
    assert_eq!(
        f["expiryHours"].as_u64().unwrap() * 3_600_000,
        PROPOSAL_TTL_MS
    );
    assert_eq!(f["maxPending"], MAX_PENDING);
    assert_eq!(f["maxChanges"], MAX_CHANGES);
    assert_eq!(f["maxReasonChars"], MAX_REASON_CHARS);
    assert_eq!(f["notificationOrigin"], NOTIFICATION_ORIGIN);
    let outcomes: Vec<Value> = [
        Outcome::Applied,
        Outcome::Discarded,
        Outcome::Expired,
        Outcome::Outdated,
    ]
    .iter()
    .map(|o| serde_json::to_value(o).unwrap())
    .collect();
    assert_eq!(Value::Array(outcomes), f["outcomes"]);
    // Every op the fixture lists parses as a change.
    for op in f["ops"].as_array().unwrap() {
        let tagged = json!({ "op": op });
        let error = serde_json::from_value::<PolicyChange>(tagged)
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(!error.contains("unknown variant"), "{op}: {error}");
    }
}

#[test]
fn a_proposal_changes_nothing_until_it_is_applied() {
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(
            proposer(),
            "Scenes everywhere",
            scene_changes(s.project.path()),
            NOW,
        )
        .unwrap();
    assert!(s.on_disk().is_none(), "proposing writes no policy");
    assert!(read_policy(s.app.path()).projects.is_empty());
    assert_eq!(s.store().pending(NOW), vec![proposal.clone()]);
    assert_eq!(proposal.expires_at, NOW + PROPOSAL_TTL_MS);

    assert_eq!(
        s.store().decide(&proposal.id, true, NOW + 1),
        Ok(Outcome::Applied)
    );
    let policy = read_policy(s.app.path());
    let (_, config) = policy.project(s.project.path()).unwrap();
    assert_eq!(config.document_types[0].name, "scene");
    assert_eq!(config.job_kinds[0].kind, "scene.draw");
    let origins = policy.origins_of(s.project.path()).unwrap();
    assert_eq!(origins.job_kinds["scene.draw"], Origin::Global);

    assert!(s.store().pending(NOW + 2).is_empty());
    assert!(s.store().decide(&proposal.id, true, NOW + 2).is_err());
    let audit = s.store().recent(10);
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].outcome, Outcome::Applied);
    assert_eq!(audit[0].proposal.reason, "Scenes everywhere");
    assert_eq!(audit[0].proposal.proposed_by, proposer());
    assert_eq!(audit[0].proposal.diff, proposal.diff);
}

#[test]
fn a_discarded_proposal_leaves_the_policy_and_is_logged() {
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(proposer(), "why", scene_changes(s.project.path()), NOW)
        .unwrap();
    assert_eq!(
        s.store().decide(&proposal.id, false, NOW),
        Ok(Outcome::Discarded)
    );
    assert!(s.on_disk().is_none());
    assert_eq!(s.store().recent(10)[0].outcome, Outcome::Discarded);
    assert!(s.store().decide(&proposal.id, true, NOW).is_err());
}

#[test]
fn a_proposal_expires_after_a_day_and_cannot_be_applied_then() {
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(proposer(), "why", scene_changes(s.project.path()), NOW)
        .unwrap();
    let later = NOW + PROPOSAL_TTL_MS;
    assert!(s.store().decide(&proposal.id, true, later).is_err());
    assert!(s.on_disk().is_none());
    assert!(s.store().pending(later).is_empty());
    let audit = s.store().recent(10);
    assert_eq!(audit.len(), 1, "logged once");
    assert_eq!(audit[0].outcome, Outcome::Expired);
}

#[test]
fn a_proposal_made_against_another_policy_is_withdrawn() {
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(proposer(), "why", scene_changes(s.project.path()), NOW)
        .unwrap();
    // The person changes the settings in the meantime.
    let human = StoredPolicy {
        jobs: policy::JobLimits {
            daily_limit: 3,
            per_project_daily_limit: None,
        },
        ..StoredPolicy::default()
    };
    write_stored(s.app.path(), &human).unwrap();
    let error = s.store().decide(&proposal.id, true, NOW).unwrap_err();
    assert!(error.contains("changed since"), "{error}");
    assert_eq!(read_stored(s.app.path()), human);
    assert!(s.store().pending(NOW).is_empty());
    assert_eq!(s.store().recent(1)[0].outcome, Outcome::Outdated);
}

#[test]
fn invalid_changes_are_refused_and_nothing_is_stored() {
    let s = Setup::new();
    for case in fixtures()["proposals"]["rejects"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let error = s
            .store()
            .propose(proposer(), "why", changes(case["changes"].clone()), NOW)
            .unwrap_err();
        let expected = case["mentions"].as_str().unwrap();
        assert!(error.contains(expected), "{name}: {error}");
    }
    assert!(s.store().pending(NOW).is_empty());
    for (reason, list) in [
        ("", scene_changes(s.project.path())),
        (
            &"x".repeat(MAX_REASON_CHARS + 1),
            scene_changes(s.project.path()),
        ),
        ("why", Vec::new()),
    ] {
        assert!(s.store().propose(proposer(), reason, list, NOW).is_err());
    }
    // Shapes serde refuses never become a change.
    for raw in [
        json!([{ "op": "remove_project", "project": "/x" }]),
        json!([{ "op": "share_project", "project": "/x", "extra": true }]),
        json!([{ "op": "set_daily_limit" }]),
    ] {
        assert!(
            serde_json::from_value::<Vec<PolicyChange>>(raw.clone()).is_err(),
            "{raw}"
        );
    }
    assert!(s.on_disk().is_none());
}

#[test]
fn the_pending_list_is_capped() {
    let s = Setup::new();
    for limit in 0..MAX_PENDING as u32 {
        s.store()
            .propose(
                proposer(),
                "why",
                changes(json!([{ "op": "set_daily_limit", "dailyLimit": limit }])),
                NOW,
            )
            .unwrap();
    }
    let error = s
        .store()
        .propose(
            proposer(),
            "why",
            changes(json!([{ "op": "set_daily_limit", "dailyLimit": 999 }])),
            NOW,
        )
        .unwrap_err();
    assert!(error.contains("already wait"), "{error}");
}

#[test]
fn the_diff_reads_as_what_changes() {
    let s = Setup::new();
    let before = StoredPolicy {
        defaults: LinkDefaults {
            document_types: vec![diagram_type()],
            job_kinds: Vec::new(),
        },
        ..StoredPolicy::default()
    };
    write_stored(s.app.path(), &before).unwrap();
    let narrower = json!({ "name": "diagram", "globs": ["docs/*.diagram.json"] });
    let proposal = s
        .store()
        .propose(
            proposer(),
            "why",
            changes(json!([
                { "op": "set_default_document_type", "documentType": narrower },
                { "op": "share_project", "project": s.project.path() },
                { "op": "set_project_daily_limit", "project": s.project.path(), "dailyLimit": 4 },
                { "op": "set_daily_limit", "dailyLimit": 7 },
            ])),
            NOW,
        )
        .unwrap();
    let diff = proposal.diff.join("\n");
    let project = s.project.path();
    for expected in [
        "~ defaults.documentTypes[\"diagram\"].globs: [\"docs/**/*.diagram.json\"] → [\"docs/*.diagram.json\"]",
        "- defaults.documentTypes[\"diagram\"].index",
        "~ jobs.dailyLimit: 20 → 7",
        &format!("+ projects[\"{project}\"]: shared with the link"),
        &format!("+ projects[\"{project}\"].dailyLimit = 4"),
    ] {
        assert!(diff.contains(expected), "missing {expected:?} in\n{diff}");
    }
}

#[test]
fn a_proposal_cannot_point_global_instructions_outside_job_kinds() {
    let s = Setup::new();
    let error = s
        .store()
        .propose(
            proposer(),
            "why",
            changes(json!([
                { "op": "share_project", "project": s.project.path() },
                { "op": "set_project_job_kind", "project": s.project.path(), "jobKind": {
                    "kind": "x.run", "globalInstructions": "/etc/hosts", "writes": ["x/*.json"] } },
            ])),
            NOW,
        )
        .unwrap_err();
    assert!(error.contains("absolute path"), "{error}");
    // A person may still set one in the settings.
    let human = StoredPolicy {
        projects: [(
            s.project.path().to_string(),
            policy::ProjectEntry {
                job_kinds: vec![policy::JobKind {
                    kind: "x.run".into(),
                    instructions: None,
                    global_instructions: Some("/etc/hosts".into()),
                    writes: vec!["x/*.json".into()],
                }],
                ..policy::ProjectEntry::default()
            },
        )]
        .into(),
        ..StoredPolicy::default()
    };
    assert!(write_stored(s.app.path(), &human).is_ok());
}

#[test]
fn the_notification_asks_with_apply_and_discard() {
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(
            proposer(),
            "Scenes everywhere",
            scene_changes(s.project.path()),
            NOW,
        )
        .unwrap();
    let input = notification(&proposal);
    let f = &fixtures()["proposals"];
    assert_eq!(input.source, "system");
    assert_eq!(input.origin.as_deref(), f["notificationOrigin"].as_str());
    assert_eq!(input.kind.as_deref(), Some("ask"));
    let body = input.body.unwrap();
    assert!(body.contains("Supervisor proposes"));
    assert!(body.contains("Reason: Scenes everywhere"));
    assert!(body.contains(&proposal.diff[0]));
    let actions = input.actions.unwrap();
    let decisions: Vec<&str> = actions
        .as_array()
        .unwrap()
        .iter()
        .map(|action| {
            assert_eq!(action["kind"], f["actionKind"]);
            assert_eq!(action["proposalId"], proposal.id.as_str());
            action["decision"].as_str().unwrap()
        })
        .collect();
    assert_eq!(json!(decisions), f["decisions"]);
    // SQLite's datetime('now') form, so the row hides itself on expiry.
    let expires = input.expires_at.unwrap();
    assert_eq!(expires.len(), "2026-10-18 09:30:00".len());
    assert_eq!(&expires[10..11], " ");
}

#[cfg(unix)]
#[test]
fn the_pending_file_and_the_audit_log_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let s = Setup::new();
    let proposal = s
        .store()
        .propose(proposer(), "why", scene_changes(s.project.path()), NOW)
        .unwrap();
    s.store().decide(&proposal.id, false, NOW).unwrap();
    for name in [PROPOSALS_FILE_NAME, AUDIT_FILE_NAME] {
        let mode = std::fs::metadata(s.app.path().join(name))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "{name}");
    }
}
