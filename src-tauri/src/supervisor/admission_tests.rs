use super::*;
use crate::quota_blocks::{QuotaBlockReason, QuotaBlockScope};
use serde_json::json;

const PROJECT: &str = "/abs/admission-project";

struct World {
    policy: SupervisorPolicy,
    project_policy: ProviderPolicy,
    offered: BTreeMap<String, Vec<String>>,
    modes: BTreeMap<String, ProviderModes>,
    running: RunningChildren,
    blocks: Vec<QuotaBlock>,
}

impl World {
    fn new() -> Self {
        Self {
            policy: serde_json::from_value(json!({
                "version": 1,
                "supervisor": { "provider": "claude", "model": null },
                "maxRunningChildren": 4,
                "projects": { PROJECT: {
                    "allowed": true, "providers": ["claude"],
                    "models": { "claude": ["haiku"] },
                    "permissionMode": { "claude": "default" },
                    "allowInteractive": false, "maxRunning": 1
                } }
            }))
            .unwrap(),
            project_policy: ProviderPolicy::default(),
            offered: BTreeMap::from([("claude".into(), vec!["haiku".into()])]),
            modes: BTreeMap::new(),
            running: RunningChildren::default(),
            blocks: Vec::new(),
        }
    }

    fn admission(&self) -> ChildAdmission<'_> {
        ChildAdmission::new(
            self.running.clone(),
            &self.policy,
            &self.project_policy,
            &self.offered,
            &self.modes,
            &self.blocks,
        )
    }

    fn block(&mut self) {
        self.blocks.push(QuotaBlock {
            id: "claude:provider".into(),
            provider: "claude".into(),
            scope: QuotaBlockScope::Provider,
            reason: QuotaBlockReason::Manual,
            detail: "manual test block".into(),
            detected_at: "2026-01-01T00:00:00Z".into(),
            expires_at: "2099-01-01T00:00:00Z".into(),
            source_agent_id: None,
        });
    }
}

fn request() -> SpawnRequest<'static> {
    SpawnRequest {
        project_path: PROJECT,
        provider: "claude",
        model: "haiku",
        headless: true,
    }
}

fn config() -> AgentConfig {
    serde_json::from_value(json!({
        "name": "child", "model": "haiku", "task": "t", "provider": "claude",
        "projectPath": PROJECT, "headless": true, "permissionMode": "default",
        "spawnedByAgentId": "supervisor"
    }))
    .unwrap()
}

/// The same explicit snapshot feeds the structured control decision and the
/// stricter final-config gate, without losing policy, quota or capacity inputs.
#[test]
fn both_admission_entries_use_all_supplied_snapshots() {
    let mut world = World::new();
    assert_eq!(
        world.admission().check_request(&request()),
        Ok(Some("default".into()))
    );
    assert_eq!(
        world.admission().check_config(&config(), Some(PROJECT)),
        Ok(())
    );

    let assert_denied = |world: &World, reason: policy::DenyReason| {
        let denied = world.admission().check_request(&request()).unwrap_err();
        assert_eq!(denied.reason, reason);
        let final_error = world
            .admission()
            .check_config(&config(), Some(PROJECT))
            .unwrap_err();
        assert_eq!(
            final_error,
            format!(
                "The supervisor policy refuses this spawn ({}): {}",
                denied.reason.key(),
                denied.message
            )
        );
        denied
    };
    world.project_policy.deny.push("claude".into());
    assert_denied(&world, policy::DenyReason::ProviderDeniedByProject);
    world.project_policy.deny.clear();

    world.offered.get_mut("claude").unwrap().clear();
    assert_denied(&world, policy::DenyReason::ModelNotOffered);
    world
        .offered
        .get_mut("claude")
        .unwrap()
        .push("haiku".into());

    world.modes.insert(
        "claude".into(),
        ProviderModes {
            default_mode: Some("default".into()),
            unattended: vec!["default".into()],
        },
    );
    assert_denied(&world, policy::DenyReason::PermissionModeUnattended);
    world.modes.clear();

    world.running = RunningChildren {
        total: 1,
        by_project: BTreeMap::from([(PROJECT.into(), 1)]),
    };
    assert_denied(&world, policy::DenyReason::ProjectLimitReached);
    world.block();
    let denied = assert_denied(&world, policy::DenyReason::QuotaBlocked);
    assert_eq!(denied.expires_at.as_deref(), Some("2099-01-01T00:00:00Z"));

    world.blocks.clear();
    world.running = RunningChildren::default();
    world.policy.projects.get_mut(PROJECT).unwrap().allowed = false;
    assert_denied(&world, policy::DenyReason::ProjectNotAllowed);
}
