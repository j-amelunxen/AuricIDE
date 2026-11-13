//! The `AURIC_*` environment variables the backend sets for agents and their
//! MCP servers. The MCP server reads them under the same names: both sides
//! read `src/lib/config/auricEnv.fixtures.json`.

/// The notifications database an agent's `auric-pm` server books into.
pub const NOTIFICATIONS_DB: &str = "AURIC_NOTIFICATIONS_DB";
/// The installed agent providers, for `list_agent_providers`.
pub const AGENT_PROVIDERS: &str = "AURIC_AGENT_PROVIDERS";
/// The one folder `request_agent_launch` may start in.
pub const AGENT_CWD: &str = "AURIC_AGENT_CWD";
pub const CONTROL_SOCKET: &str = "AURIC_CONTROL_SOCKET";
/// `1` when the agent's supervisor can be asked (`ask_supervisor`).
pub const ASK_SUPERVISOR: &str = "AURIC_ASK_SUPERVISOR";
/// The environment of a supervisor's per-project PM children, as JSON.
pub const PM_CHILD_ENV: &str = "AURIC_PM_CHILD_ENV";
pub const PROJECT_ROOT: &str = "AURIC_PROJECT_ROOT";
pub const MCP_DB_PATH: &str = "AURIC_MCP_DB_PATH";

/// The variables that bind an agent to a project. An agent never inherits
/// them from the shell that launched the IDE; only its resolved binding sets them.
pub fn is_project_binding(key: &str) -> bool {
    [PROJECT_ROOT, MCP_DB_PATH, NOTIFICATIONS_DB].contains(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_match_the_mcp_server() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../src/lib/config/auricEnv.fixtures.json"))
                .unwrap();
        for (role, name) in [
            ("notificationsDb", NOTIFICATIONS_DB),
            ("agentProviders", AGENT_PROVIDERS),
            ("agentCwd", AGENT_CWD),
            ("controlSocket", CONTROL_SOCKET),
            ("askSupervisor", ASK_SUPERVISOR),
            ("pmChildEnv", PM_CHILD_ENV),
            ("projectRoot", PROJECT_ROOT),
            ("mcpDbPath", MCP_DB_PATH),
        ] {
            assert_eq!(fixture[role], name, "{role}");
        }
    }
}
