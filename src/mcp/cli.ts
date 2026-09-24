import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface McpCliBinding {
  projectRoot: string;
  databasePath: string;
}

/**
 * Resolves the one authoritative project identity for an MCP stdio session.
 * The database is always derived from that root; accepting both values would
 * allow a caller to label project A while opening project B's database.
 */
export function resolveMcpCliBinding(args: readonly string[]): McpCliBinding {
  if (args.length !== 2 || args[0] !== '--project-root') {
    throw new Error('Usage: auric-mcp --project-root <project-directory> (unsupported arguments)');
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
