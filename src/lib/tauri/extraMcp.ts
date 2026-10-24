import { invoke } from './invoke';

/** What the picker shows for one `.mcp.json` entry. Never a command, env value or header. */
export interface DiscoveredMcpServer {
  name: string;
  /** `stdio`, `http`, `sse`, or `invalid`. */
  transport: 'stdio' | 'http' | 'sse' | 'invalid';
  /** Why the entry cannot be used; `null` when it can. */
  problem: string | null;
}

export interface McpFileInspection {
  fileFound: boolean;
  servers: DiscoveredMcpServer[];
  error: string | null;
}

/** Reads the project's `.mcp.json` (Rust `extra_mcp_inspect`). */
export async function extraMcpInspect(projectPath: string): Promise<McpFileInspection> {
  return await invoke<McpFileInspection>('extra_mcp_inspect', { projectPath });
}
