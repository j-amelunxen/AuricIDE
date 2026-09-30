//! What a spawn adds to its command line for usage capture.

use uuid::Uuid;

use crate::providers::{SpawnCommand, UsageConfig};

/// Passes a fresh session id to a CLI that takes one, so its transcript is
/// found by an id we chose instead of being guessed at afterwards. Returns the
/// id that was passed.
pub fn with_session_id(
    spawn: SpawnCommand,
    usage: Option<&UsageConfig>,
) -> (SpawnCommand, Option<String>) {
    let flag = usage
        .and_then(|usage| usage.transcript.as_ref())
        .and_then(|transcript| transcript.session_id_flag.as_deref());
    match flag {
        Some(flag) => {
            let session_id = Uuid::new_v4().to_string();
            (
                spawn.with_flag_after_executable(flag, &session_id),
                Some(session_id),
            )
        }
        None => (spawn, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_usage::claude::is_uuid;

    fn spawn() -> SpawnCommand {
        SpawnCommand {
            command: "claude -p \"task\"".into(),
            env_vars: vec![],
            executable: "claude".into(),
        }
    }

    fn usage(json: &str) -> UsageConfig {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn a_provider_with_a_session_flag_gets_a_fresh_uuid_behind_its_executable() {
        let config =
            usage(r#"{"transcript":{"format":"claude-jsonl","sessionIdFlag":"--session-id"}}"#);

        let (command, id) = with_session_id(spawn(), Some(&config));

        let id = id.expect("an id");
        assert!(is_uuid(&id));
        assert_eq!(
            command.command,
            format!("claude --session-id \"{id}\" -p \"task\"")
        );
    }

    #[test]
    fn every_spawn_gets_its_own_id() {
        let config =
            usage(r#"{"transcript":{"format":"claude-jsonl","sessionIdFlag":"--session-id"}}"#);

        let (_, first) = with_session_id(spawn(), Some(&config));
        let (_, second) = with_session_id(spawn(), Some(&config));

        assert_ne!(first, second);
    }

    #[test]
    fn a_provider_that_reports_its_id_in_the_output_gets_no_flag() {
        let config = usage(r#"{"transcript":{"format":"codex-rollout","sessionIdFrom":"output"}}"#);

        let (command, id) = with_session_id(spawn(), Some(&config));

        assert_eq!(id, None);
        assert_eq!(command.command, "claude -p \"task\"");
    }

    #[test]
    fn a_provider_without_a_usage_block_is_left_alone() {
        let (command, id) = with_session_id(spawn(), None);

        assert_eq!(id, None);
        assert_eq!(command.command, "claude -p \"task\"");
    }
}
