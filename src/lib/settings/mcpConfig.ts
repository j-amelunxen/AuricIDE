import { exists, readFile, writeFile } from '@/lib/tauri/fs';
import { mcpLaunchSpec, type McpLaunchSpec } from '@/lib/tauri/mcp';

export type McpServerEntry = McpLaunchSpec;

export function buildMcpServerEntry(launchSpec: McpLaunchSpec): McpServerEntry {
  return launchSpec;
}

export function buildMcpConfig(launchSpec: McpLaunchSpec): {
  mcpServers: Record<string, McpServerEntry>;
} {
  return {
    mcpServers: {
      'auric-pm': buildMcpServerEntry(launchSpec),
    },
  };
}

function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * The Claude Code command that registers the agent-control server
 * (`auric-mcp --control`, docs/design-agent-control.md) for the user. Built
 * from the launch spec the app already hands its own agents, so the runtime
 * path is the one this install actually ships; only the mode differs.
 */
export function buildControlAddCommand(launchSpec: McpLaunchSpec): string {
  const [runtime] = launchSpec.args;
  return [
    'claude mcp add --scope user auric-control --',
    shellWord(launchSpec.command),
    shellWord(runtime ?? '<runtime>/server.mjs'),
    '--control',
  ].join(' ');
}

export type InitMcpResult = 'created' | 'updated';

/**
 * Write (or update) `<project>/.mcp.json` so agents like Claude Code pick up
 * the auric-pm MCP server. An existing file is merged, never clobbered:
 * other configured servers and unknown top-level keys are preserved.
 */
export async function initMcpJson(projectPath: string): Promise<InitMcpResult> {
  const configPath = `${projectPath}/.mcp.json`;
  const entry = buildMcpServerEntry(await mcpLaunchSpec(projectPath));

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
