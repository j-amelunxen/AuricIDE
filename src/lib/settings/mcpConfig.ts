import { exists, readFile, writeFile } from '@/lib/tauri/fs';

export interface McpServerEntry {
  command: string;
  args: string[];
}

export function buildMcpServerEntry(projectPath: string): McpServerEntry {
  return {
    command: 'npx',
    args: ['tsx', `${projectPath}/src/mcp/server.ts`, `${projectPath}/.auric/project.db`],
  };
}

export function buildMcpConfig(projectPath: string): {
  mcpServers: Record<string, McpServerEntry>;
} {
  return {
    mcpServers: {
      'auric-pm': buildMcpServerEntry(projectPath),
    },
  };
}

export type InitMcpResult = 'created' | 'updated';

/**
 * Write (or update) `<project>/.mcp.json` so agents like Claude Code pick up
 * the auric-pm MCP server. An existing file is merged, never clobbered:
 * other configured servers and unknown top-level keys are preserved.
 */
export async function initMcpJson(projectPath: string): Promise<InitMcpResult> {
  const configPath = `${projectPath}/.mcp.json`;
  const entry = buildMcpServerEntry(projectPath);

  let config: Record<string, unknown> = {};
  let result: InitMcpResult = 'created';

  if (await exists(configPath)) {
    const raw = await readFile(configPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('.mcp.json exists but contains invalid JSON; not overwriting it');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        '.mcp.json exists but is invalid (expected a JSON object); not overwriting it'
      );
    }
    config = parsed as Record<string, unknown>;
    result = 'updated';
  }

  const servers =
    typeof config.mcpServers === 'object' && config.mcpServers !== null
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  config.mcpServers = { ...servers, 'auric-pm': entry };

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  return result;
}
