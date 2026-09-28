import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { IDE_AGENT_MARKER } from '../lib/agents/agentControl.contract';

export interface McpCliBinding {
  projectRoot: string;
  databasePath: string;
}

/**
 * The two ways the server runs. `project` is what the IDE hands its own agents
 * (PM tools for one project); `control` is for clients outside the IDE and
 * offers only the agent-control tools (`docs/design-agent-control.md`).
 */
export type McpCliMode = ({ mode: 'project' } & McpCliBinding) | { mode: 'control' };

const USAGE =
  'Usage: auric-mcp --project-root <project-directory> | auric-mcp --control (unsupported arguments)';

/**
 * Picks the server mode from the command line. `--control` is refused inside a
 * process the IDE spawned for an agent (`AURIC_IDE_AGENT` marks those): typing
 * into a console can answer a permission prompt, so one agent must never be
 * able to approve another's.
 */
export function resolveMcpCliMode(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): McpCliMode {
  if (args.includes('--control')) {
    if (args.length !== 1) throw new Error(USAGE);
    // The marker is set on every IDE agent; AURIC_AGENT_CWD only on those with
    // a project binding. The socket checks the caller's ancestry as well.
    const marker = [IDE_AGENT_MARKER, 'AURIC_AGENT_CWD'].find((name) => env[name]);
    if (marker) {
      throw new Error(
        '--control is for clients outside AuricIDE; refusing to start inside an IDE agent ' +
          `(${marker} is set)`
      );
    }
    return { mode: 'control' };
  }
  return { mode: 'project', ...resolveMcpCliBinding(args) };
}

/**
 * Resolves the one authoritative project identity for an MCP stdio session.
 * The database is always derived from that root; accepting both values would
 * allow a caller to label project A while opening project B's database.
 */
export function resolveMcpCliBinding(args: readonly string[]): McpCliBinding {
  if (args.length !== 2 || args[0] !== '--project-root') {
    throw new Error(USAGE);
  }

  const requested = args[1]?.trim();
  if (!requested) throw new Error('--project-root requires a project directory');

  const candidate = isAbsolute(requested) ? requested : resolve(requested);
  let projectRoot: string;
  try {
    projectRoot = realpathSync(candidate);
  } catch {
    throw new Error(`MCP project does not exist: ${candidate}`);
  }
  if (!statSync(projectRoot).isDirectory()) {
    throw new Error(`MCP project is not a directory: ${projectRoot}`);
  }

  const requestedDatabasePath = join(projectRoot, '.auric', 'project.db');
  if (!existsSync(requestedDatabasePath)) {
    throw new Error(`AuricIDE project is not initialized: ${projectRoot}`);
  }
  const databasePath = realpathSync(requestedDatabasePath);
  const databaseRelativePath = relative(projectRoot, databasePath);
  if (databaseRelativePath.startsWith('..') || isAbsolute(databaseRelativePath)) {
    throw new Error(`AuricIDE project database escapes its project root: ${projectRoot}`);
  }

  return { projectRoot, databasePath };
}
