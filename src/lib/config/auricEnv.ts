import names from './auricEnv.fixtures.json';

/**
 * The `AURIC_*` environment variables Rust sets for agents and their MCP
 * servers (`src-tauri/src/auric_env.rs`), by role. Both read the fixture.
 */
export const AURIC_ENV = {
  notificationsDb: names.notificationsDb,
  agentProviders: names.agentProviders,
  agentCwd: names.agentCwd,
  controlSocket: names.controlSocket,
  askSupervisor: names.askSupervisor,
  pmChildEnv: names.pmChildEnv,
  projectRoot: names.projectRoot,
  mcpDbPath: names.mcpDbPath,
} as const;
