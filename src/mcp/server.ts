import type Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { FastMCP } from 'fastmcp';
import { registerContextTools } from './tools/context';
import { registerDependencyTools } from './tools/dependencies';
import { registerEpicTools } from './tools/epics';
import { registerTestCaseTools } from './tools/testcases';
import { registerHistoryTools } from './tools/history';
import { registerTaskTools } from './tools/tasks';
import { registerTicketTools } from './tools/tickets';
import { registerBlueprintTools } from './tools/blueprints';
import { registerCanvasTools } from './tools/canvas';

export function createMcpServer(db: Database.Database, projectRoot: string): FastMCP {
  const server = new FastMCP({
    name: 'auric-pm',
    version: '1.0.0',
  });

  registerEpicTools(server, db);
  registerTicketTools(server, db);
  registerTaskTools(server, db);
  registerDependencyTools(server, db);
  registerTestCaseTools(server, db);
  registerHistoryTools(server, db);
  registerBlueprintTools(server, db);
  registerContextTools(server, db);
  registerCanvasTools(server, projectRoot);

  return server;
}

// CLI entry point: `npx tsx src/mcp/server.ts <db-path>`
if (typeof process !== 'undefined' && process.argv[1]?.includes('server')) {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('Usage: npx tsx src/mcp/server.ts <path-to-project.db>');
    process.exit(1);
  }

  import('./db').then(({ openDatabase }) => {
    const db = openDatabase(dbPath);
    // dbPath is typically <project>/.auric/project.db → project root is two levels up
    const projectRoot = dirname(dirname(dbPath));
    const server = createMcpServer(db, projectRoot);
    server.start({ transportType: 'stdio' });
  });
}
