import type Database from 'better-sqlite3';
import { FastMCP } from 'fastmcp';
import { resolveMcpCliMode } from './cli';
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
import { registerGoalReviewTools } from './tools/goalReviews';
import { registerNotificationTools } from './tools/notifications';
import { registerAgentLaunchTools } from './tools/agentLaunch';
import { registerAgentControlTools } from './tools/agentControl';
import { registerAgentUsageTools } from './tools/agentUsage';
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
function attachNotificationTools(
  server: FastMCP,
  db: Database.Database,
  projectRoot: string
): Database.Database | null {
  const dbPath = process.env.AURIC_NOTIFICATIONS_DB;
  if (!dbPath) return null;

  try {
    const inbox = openNotificationsDb(dbPath);
    const defaults = {
      projectPath: projectRoot,
      projectName: projectRoot.split('/').filter(Boolean).pop(),
      // The requesting agent's folder, as the IDE set it for this process. Only
      // as trustworthy as that environment: a shell agent could start its own
      // server with a forged AURIC_AGENT_CWD (review r3, blocker 1). That is the
      // excluded shell agent of the threat model, see `requesterFolder.ts`.
      agentCwd: process.env.AURIC_AGENT_CWD,
    };
    registerNotificationTools(server, inbox, defaults);
    // Launch requests travel through the same inbox, so they exist exactly
    // when the inbox does: a request that reaches no one must not be offered.
    registerAgentLaunchTools(server, db, inbox, {
      ...defaults,
      installedProviders: process.env.AURIC_AGENT_PROVIDERS,
    });
    return inbox;
  } catch (error) {
    // The PM tools are the point of this server; an unreachable inbox must not
    // stop it from starting.
    console.error(`[auric-pm] notification inbox unavailable at ${dbPath}: ${String(error)}`);
    return null;
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
  registerKnowledgeTools(server, projectRoot);
  registerReviewTools(server, db);
  registerGoalReviewTools(server, db);
  registerAgentUsageTools(server, db);
  const inbox = attachNotificationTools(server, db, projectRoot);
  // A hand-over still stores its steps on the station without an inbox.
  registerStationTools(server, db, projectRoot, {
    inbox,
    scope: { projectPath: projectRoot, projectName: projectRoot.split('/').filter(Boolean).pop() },
  });

  return server;
}

/**
 * `auric-mcp --control`: the agent-control tools and nothing else — no project,
 * no database. For clients outside the IDE; see `docs/design-agent-control.md`.
 */
export function createControlServer(): FastMCP {
  const server = new FastMCP({
    name: 'auric-control',
    version: '1.0.0',
  });
  registerAgentControlTools(server);
  return server;
}

const isMainModule =
  (import.meta as ImportMeta & { main?: boolean }).main === true ||
  (typeof process !== 'undefined' && process.argv[1]?.includes('server'));

// CLI entry point: `auric-mcp --project-root <project-directory>` or `auric-mcp --control`
if (isMainModule) {
  Promise.resolve()
    .then(async () => {
      const mode = resolveMcpCliMode(process.argv.slice(2));
      if (mode.mode === 'control') {
        await createControlServer().start({ transportType: 'stdio' });
        return;
      }
      const { openDatabase } = await import('./db');
      const db = openDatabase(mode.databasePath);
      const server = createMcpServer(db, mode.projectRoot);
      await server.start({ transportType: 'stdio' });
    })
    .catch((error) => {
      console.error(`[auric-mcp] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
