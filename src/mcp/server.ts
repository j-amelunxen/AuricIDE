import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { registerDependencyTools } from './tools/dependencies';
import { registerEpicTools } from './tools/epics';
import { registerHistoryTools } from './tools/history';
import { registerTaskTools } from './tools/tasks';
import { registerTicketTools } from './tools/tickets';
import { registerBlueprintTools } from './tools/blueprints';

export function createMcpServer(db: Database.Database): FastMCP {
  const server = new FastMCP({
    name: 'auric-pm',
    version: '1.0.0',
  });

  registerEpicTools(server, db);
  registerTicketTools(server, db);
  registerTaskTools(server, db);
  registerDependencyTools(server, db);
  registerHistoryTools(server, db);
  registerBlueprintTools(server, db);

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
    const server = createMcpServer(db);
    server.start({ transportType: 'stdio' });
  });
}
