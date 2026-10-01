import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { dispatchNotification } from '../notificationsDb';
import { requestingAgentFolder } from '../requesterFolder';
import { descendantIds, getGoal } from './goalsDb';
import { resolveTicketId } from './resolve';
import { GOAL_LAUNCH_PURPOSES } from './goalLaunch';
import {
  buildLaunchRequest,
  LAUNCH_REQUEST_KEY_PREFIX,
  parseLaunchAnswer,
} from '../../lib/notifications/launchRequest';
import {
  isProviderAllowed,
  parseProviderPolicy,
  type ProviderPolicy,
} from '../../lib/config/providerPolicy';

/**
 * Lets an agent ask the IDE to start another agent for a goal.
 *
 * The ask is all it is. The request lands in the inbox as an agent-written
 * notification with one "Start agent" button; whether it starts on its own is
 * decided in the IDE, never here — only a launch grant that Jennifer set for
 * the mission root in the UI turns a request into an automatic start
 * (`src/lib/notifications/launchGrants.ts`). Nothing an agent sends through
 * this tool can carry that decision: the authority fields of a spawn-agent
 * action (launch mode, permission mode, headless, note) are not part of the
 * schema, and the row is always written as `source: 'agent'`, which
 * `notificationTrust` reads as foreign.
 */

/** Every launch request carries this dedupe-key prefix; the UI keys on it. */
export { LAUNCH_REQUEST_KEY_PREFIX };

/**
 * Plain model ids only (`opus`, `gpt-5-codex`, `moonshotai/kimi-k2-thinking`,
 * `claude-opus-4-1[1m]`). The model lands on a shell command line; the spawn
 * path quotes it (`shell_word` in `providers/types.rs`), and this boundary
 * refuses separators, quotes, whitespace and substitutions before anything is
 * written. The `[` stays escaped: the pattern ships in the tool schema, and
 * stricter regex dialects (the model API's among them) read a bare `[` inside a
 * class as a nested class and reject the whole schema.
 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]{0,127}$/;
/** Provider ids as the registry and the policy write them. */
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Strict on purpose: a field outside this schema is refused with its name, not
 * dropped. That covers the authority fields of a spawn-agent action (launch
 * mode, permission mode, headless, note) and every attempt to name a folder
 * (`cwd`, `repoPath`, `path`, `projectPath`): where the agent runs is the
 * IDE's call, see `requestingAgentFolder`.
 */
const requestSchema = z
  .object({
    prompt: z.string().describe('What the started agent is told to do'),
    goalId: z.string().describe('The goal the agent works on; it is bound to this goal'),
    provider: z
      .string()
      .trim()
      .regex(PROVIDER_ID, 'provider must be a plain provider id, e.g. "codex"')
      .optional()
      .describe('Agent CLI, e.g. "claude", "codex", "grok". See list_agent_providers.'),
    model: z
      .string()
      .regex(MODEL_ID, 'model must be a plain model id (letters, digits, . _ : / @ + - [ ])')
      .optional()
      .describe('Model for that provider; absent = the IDE default'),
    worktree: z
      .boolean()
      .optional()
      .describe(
        'true = run in a fresh IDE worktree of your own repository instead of your own ' +
          'working directory. You cannot name a folder.'
      ),
    ticketId: z
      .string()
      .optional()
      .describe(
        'A ticket of this goal (or its sub-goals) the run is for; its cost is booked on it too'
      ),
    purpose: z
      .enum(GOAL_LAUNCH_PURPOSES)
      .optional()
      .describe('What the agent is for (work, plan, split); only labels the inbox row'),
    replace: z
      .boolean()
      .optional()
      .describe(
        "true = swap the prompt (and provider, model, worktree, ticket) of this goal's open " +
          'request, as long as nobody has started it. Same uid back. Without it an open ' +
          'request is returned untouched.'
      ),
    title: z.string().optional().describe('Inbox title; defaults to the goal name'),
  })
  .strict();

interface Defaults {
  projectPath?: string;
  projectName?: string;
  /**
   * Installed provider ids, comma-separated — `AURIC_AGENT_PROVIDERS`, which
   * the IDE sets when it starts this server for an agent. Absent outside the
   * IDE; then only the policy is checked here and the spawn path
   * (`resolve_permitted_provider`) refuses an unknown provider.
   */
  installedProviders?: string;
  /**
   * The requesting agent's working directory, canonical — `AURIC_AGENT_CWD`,
   * which the IDE sets when it starts this server for an agent. The only
   * folder a request can start in (or make a worktree of).
   */
  agentCwd?: string;
}

/** Same key the Rust spawn path reads (`provider_policy.rs`). */
function projectPolicy(projectDb: Database.Database): ProviderPolicy {
  const row = projectDb
    .prepare("SELECT value FROM kv_store WHERE namespace = 'provider_policy' AND key = 'policy'")
    .get() as { value: string } | undefined;
  return parseProviderPolicy(row?.value);
}

function installedIds(defaults: Defaults): string[] | null {
  if (defaults.installedProviders === undefined) return null;
  return defaults.installedProviders
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The provider a request may name, or a clear refusal — never a silent swap
 * for another one.
 */
function checkedProvider(
  requested: string | undefined,
  projectDb: Database.Database,
  defaults: Defaults
): string | undefined {
  const id = requested?.trim().toLowerCase();
  if (!id) return undefined;
  const installed = installedIds(defaults);
  if (installed && !installed.includes(id)) {
    throw new Error(
      `Provider '${id}' is not installed in AuricIDE (installed: ${installed.join(', ') || 'none'})`
    );
  }
  if (!isProviderAllowed(id, projectPolicy(projectDb))) {
    throw new Error(
      `Provider '${id}' is not permitted in this project (Settings → Project → Providers)`
    );
  }
  return id;
}

export function listAgentProviders(projectDb: Database.Database, defaults: Defaults) {
  const policy = projectPolicy(projectDb);
  const installed = installedIds(defaults);
  const ids = installed ?? policy.allow ?? [];
  return {
    installedKnown: installed !== null,
    providers: [...ids].sort().map((id) => ({ id, allowed: isProviderAllowed(id, policy) })),
    policy,
  };
}

function openRequestFor(
  inboxDb: Database.Database,
  projectPath: string,
  goalId: string
): string | null {
  const row = inboxDb
    .prepare(
      `SELECT uid FROM notifications
        WHERE dedupe_key LIKE ? AND ref_kind = 'goal' AND ref_id = ?
          AND project_path = ? AND answered_at IS NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(`${LAUNCH_REQUEST_KEY_PREFIX}%`, goalId, projectPath) as { uid: string } | undefined;
  return row?.uid ?? null;
}

/** A request someone already started or claimed keeps its prompt: the agent has read it. */
function isStarted(inboxDb: Database.Database, uid: string): boolean {
  return (
    inboxDb.prepare('SELECT 1 FROM agent_launch_runs WHERE request_uid = ?').get(uid) !==
      undefined ||
    inboxDb.prepare('SELECT 1 FROM agent_launch_claims WHERE request_uid = ?').get(uid) !==
      undefined
  );
}

const PURPOSE_TITLE = {
  work: 'Agent requested for goal',
  plan: 'Planning agent requested for goal',
  split: 'Split agent requested for goal',
} as const;

/** The ticket must exist and belong to the goal's subtree, or the cost lands on the wrong goal. */
function checkedTicket(
  projectDb: Database.Database,
  goalId: string,
  requested: string | undefined
): string | undefined {
  const given = requested?.trim();
  if (!given) return undefined;
  const ticketId = resolveTicketId(projectDb, given);
  const row = projectDb.prepare('SELECT goal_id FROM pm_tickets WHERE id = ?').get(ticketId) as
    { goal_id: string | null } | undefined;
  if (!row?.goal_id || !descendantIds(projectDb, goalId).includes(row.goal_id)) {
    throw new Error(`Ticket '${ticketId}' does not belong to goal '${goalId}' or its sub-goals`);
  }
  return ticketId;
}

export function requestAgentLaunch(
  projectDb: Database.Database,
  inboxDb: Database.Database,
  raw: unknown,
  defaults: Defaults
): { uid: string; status: 'pending'; reused?: true; replaced?: true } {
  const args = requestSchema.parse(raw);
  const projectPath = defaults.projectPath;
  if (!projectPath) {
    throw new Error('This MCP server is not bound to a project; a launch needs one');
  }
  const folder = requestingAgentFolder(defaults.agentCwd);
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error('prompt must not be empty');
  const goalId = args.goalId.trim();
  if (!goalId) throw new Error('goalId is required');
  const goal = getGoal(projectDb, goalId);
  if (!goal) throw new Error(`Goal '${goalId}' not found in this project`);

  const provider = checkedProvider(args.provider, projectDb, defaults);
  const ticketId = checkedTicket(projectDb, goalId, args.ticketId);
  const title =
    args.title ?? (args.purpose ? `${PURPOSE_TITLE[args.purpose]} "${goal.name}"` : undefined);

  // Look and write under one write lock (BEGIN IMMEDIATE): two agents with
  // their own MCP server processes asking for the same goal at once must not
  // both see "no open request" and stack two Start buttons.
  const openOrInsert = inboxDb.transaction(
    (): {
      uid: string;
      reused: boolean;
      replaced: boolean;
    } => {
      const open = openRequestFor(inboxDb, projectPath, goalId);
      if (open && !args.replace) return { uid: open, reused: true, replaced: false };
      if (open && isStarted(inboxDb, open)) {
        throw new Error(
          `The open request '${open}' for this goal was already started; it cannot be replaced`
        );
      }

      // Replacing re-dispatches under the same uid: `dispatchNotification` swaps
      // the row for the one with the same dedupe key, so a caller polling the uid
      // keeps it, and clients that already drained see the new row again.
      const uid = open ?? crypto.randomUUID();
      dispatchNotification(
        inboxDb,
        buildLaunchRequest({
          uid,
          goalId,
          goalName: goal.name,
          prompt,
          folder,
          projectPath,
          projectName: defaults.projectName ?? null,
          provider,
          model: args.model,
          worktree: args.worktree,
          ticketId,
          title,
        })
      );
      return { uid, reused: false, replaced: open !== null };
    }
  );
  const { uid, reused, replaced } = openOrInsert.immediate();
  if (reused) return { uid, status: 'pending', reused: true };
  return replaced ? { uid, status: 'pending', replaced: true } : { uid, status: 'pending' };
}

interface RequestRow {
  dedupe_key: string | null;
  ref_id: string | null;
  answer: string | null;
  created_at: string;
}

interface LaunchRunRow {
  agent_id: string;
  agent_name: string | null;
  provider: string | null;
  model: string | null;
  status: string;
  summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/**
 * What became of a launch request: `pending` (waiting for a click or a
 * grant), `running`, `interrupted` (the IDE was closed while it ran; a resume
 * reopens it), `completed`, `failed`, `killed`, `declined` (dismissed
 * in the inbox) or `gone` (cleared, unknown, or another project's).
 */
export function getAgentRun(
  inboxDb: Database.Database,
  uid: string,
  projectPath: string | undefined
): Record<string, unknown> {
  if (!projectPath) return { status: 'gone' };
  const request = inboxDb
    .prepare(
      'SELECT dedupe_key, ref_id, answer, created_at FROM notifications WHERE uid = ? AND project_path = ?'
    )
    .get(uid, projectPath) as RequestRow | undefined;
  if (!request) return { status: 'gone' };
  if (!request.dedupe_key?.startsWith(LAUNCH_REQUEST_KEY_PREFIX)) {
    throw new Error(`'${uid}' is not an agent launch request`);
  }
  const base = { goalId: request.ref_id, requestedAt: request.created_at };

  const run = inboxDb.prepare('SELECT * FROM agent_launch_runs WHERE request_uid = ?').get(uid) as
    LaunchRunRow | undefined;
  if (run) {
    return {
      status: run.status,
      ...base,
      agentId: run.agent_id,
      agentName: run.agent_name,
      provider: run.provider,
      model: run.model,
      summary: run.summary,
      error: run.error,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
    };
  }

  const outcome = parseLaunchAnswer(request.answer);
  if (!outcome) return { status: 'pending', ...base };
  if (outcome.kind === 'started') return { status: 'running', ...base, agentId: outcome.agentId };
  if (outcome.kind === 'failed') return { status: 'failed', ...base, error: outcome.error };
  return { status: 'declined', ...base };
}

export function registerAgentLaunchTools(
  server: FastMCP,
  projectDb: Database.Database,
  inboxDb: Database.Database,
  defaults: Defaults = {}
): void {
  server.addTool({
    name: 'request_agent_launch',
    description:
      'Ask the IDE to start an agent for a goal in this project. It starts in your own ' +
      'working directory, or with worktree: true in a fresh IDE worktree of your repository; ' +
      'no other folder can be named. Returns a uid and status ' +
      '"pending". The request lands in the inbox with a Start button; it starts on its own only ' +
      "if the human granted automatic starts for the goal's mission root. Poll get_agent_run " +
      'with the uid to see whether and how it ran. Asking again for a goal with an open ' +
      'request returns that request instead of stacking a second one; pass replace: true to swap ' +
      "its prompt while it has not started (same uid). ticketId books the run on one of the goal's " +
      'tickets as well. get_goal_launch_prompt gives the prompt the IDE button would use.',
    parameters: requestSchema,
    execute: async (args) => JSON.stringify(requestAgentLaunch(projectDb, inboxDb, args, defaults)),
  });

  server.addTool({
    name: 'list_agent_providers',
    description:
      'List the agent providers (CLIs such as claude, codex, grok) request_agent_launch can ' +
      "name, and whether this project's provider policy allows each. installedKnown is false " +
      'when this server cannot see the IDE install; the IDE still refuses unknown ones at start.',
    parameters: z.object({}),
    execute: async () => JSON.stringify(listAgentProviders(projectDb, defaults)),
  });

  server.addTool({
    name: 'get_agent_run',
    description:
      'Read what became of a request_agent_launch: status pending (waiting for a click or a ' +
      'grant), running, interrupted (the IDE closed while it ran; resuming it continues), ' +
      'completed, failed, killed, declined or gone, plus the agent, provider, ' +
      'model and a short summary of its output once it finished. Poll at a human pace.',
    parameters: z.object({ uid: z.string().describe('The uid request_agent_launch returned') }),
    execute: async ({ uid }) => JSON.stringify(getAgentRun(inboxDb, uid, defaults.projectPath)),
  });
}
