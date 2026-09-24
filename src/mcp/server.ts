import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { resolveMcpCliBinding } from './cli';
import { registerContextTools } from './tools/context';
import { registerDependencyTools } from './tools/dependencies';
import { registerEpicTools } from './tools/epics';
import { registerTestCaseTools } from './tools/testcases';
import { registerHistoryTools } from './tools/history';
import { registerTaskTools } from './tools/tasks';
import { registerTicketTools } from './tools/tickets';
import { registerBlueprintTools } from './tools/blueprints';
import { registerCanvasTools } from './tools/canvas';
import { registerRequirementTools } from './tools/requirements';
import { registerGoalTools } from './tools/goals';
import { registerStationTools } from './tools/stations';
import { registerKnowledgeTools } from './tools/knowledge';
import { registerReviewTools } from './tools/reviews';
import { registerNotificationTools } from './tools/notifications';
import { openNotificationsDb } from './notificationsDb';

/**
 * Attaches the notify tools, if the app told us where the inbox lives.
 *
 * The inbox is a different database from the project one — app-global, so a
 * message reaches the human whichever repo they are looking at. Without
 * `AURIC_NOTIFICATIONS_DB` the tools are simply not offered: an agent that can
 * see `notify` in its tool list must be able to trust that calling it reaches
 * someone. Registering a version that quietly writes nowhere would be worse
 * than not having it.
 */
function attachNotificationTools(server: FastMCP, projectRoot: string): void {
  const dbPath = process.env.AURIC_NOTIFICATIONS_DB;
  if (!dbPath) return;

  try {
    registerNotificationTools(server, openNotificationsDb(dbPath), {
      projectPath: projectRoot,
      projectName: projectRoot.split('/').filter(Boolean).pop(),
    });
  } catch (error) {
    // The PM tools are the point of this server; an unreachable inbox must not
    // stop it from starting.
    console.error(`[auric-pm] notification inbox unavailable at ${dbPath}: ${String(error)}`);
  }
}

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
  registerRequirementTools(server, db);
  registerGoalTools(server, db);
  registerStationTools(server, db);
  registerKnowledgeTools(server, projectRoot);
  registerReviewTools(server, db);
  attachNotificationTools(server, projectRoot);

  return server;
}

const isMainModule =
  (import.meta as ImportMeta & { main?: boolean }).main === true ||
  (typeof process !== 'undefined' && process.argv[1]?.includes('server'));

// CLI entry point: `auric-mcp --project-root <project-directory>`
if (isMainModule) {
  import('./db')
    .then(({ openDatabase }) => {
      const { projectRoot, databasePath } = resolveMcpCliBinding(process.argv.slice(2));
      const db = openDatabase(databasePath);
      const server = createMcpServer(db, projectRoot);
      server.start({ transportType: 'stdio' });
    })
    .catch((error) => {
      console.error(`[auric-pm] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
