import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import {
  createSchedule,
  deleteSchedule,
  dispatchNotification,
  getAnswer,
  listSchedules,
} from '../notificationsDb';

/**
 * Lets an agent reach the human.
 *
 * Two shapes, and the difference matters. `notify` says something and moves on.
 * `notify_ask` poses a question, hands back a uid, and the agent polls
 * `notify_answer_get` until a decision is there — non-blocking on purpose,
 * because a tool call that waits minutes would die on the provider's own
 * timeout long before a human wandered back to the machine.
 *
 * The action vocabulary is closed and re-validated in the UI before anything is
 * rendered as a button. Nothing an agent writes here becomes possible that the
 * IDE could not already do.
 */

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    label: z.string(),
    kind: z.literal('answer'),
    value: z.string(),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    kind: z.literal('spawn-agent'),
    task: z.string(),
    repoPath: z.string().optional(),
    ticketId: z.string().optional(),
    goalId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    kind: z.literal('open'),
    target: z.discriminatedUnion('type', [
      z.object({ type: z.literal('file'), path: z.string(), line: z.number().optional() }),
      z.object({ type: z.literal('ticket'), ticketId: z.string() }),
      z.object({ type: z.literal('goal'), goalId: z.string() }),
      z.object({ type: z.literal('agent'), agentId: z.string() }),
    ]),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    kind: z.literal('command'),
    commandId: z.string(),
  }),
]);

export function registerNotificationTools(
  server: FastMCP,
  db: Database.Database,
  defaults: { projectPath?: string; projectName?: string } = {}
): void {
  server.addTool({
    name: 'notify',
    description:
      'Send a notification to the human running AuricIDE. It lands in their inbox across all ' +
      'projects and survives a restart. Use for things worth knowing later, not for progress ' +
      'chatter — an inbox full of noise gets ignored. To ask a question, use notify_ask instead.',
    parameters: z.object({
      title: z.string().describe('One line. This is what gets read.'),
      body: z.string().optional().describe('Optional detail, a sentence or two'),
      severity: z
        .enum(['info', 'success', 'warn', 'error'])
        .optional()
        .describe('warn and error also raise an OS banner when the window is in the background'),
      origin: z.string().optional().describe('Who is speaking, e.g. your agent name'),
      actions: z
        .array(actionSchema)
        .optional()
        .describe(
          'Buttons offered on the notification. Closed vocabulary; unknown kinds are dropped.'
        ),
      dedupeKey: z
        .string()
        .optional()
        .describe(
          'Repeat dispatches under this key replace the earlier row and make it unread again, ' +
            'instead of stacking duplicates'
        ),
      projectPath: z.string().optional().describe('Defaults to the project this server serves'),
      refKind: z.enum(['agent', 'ticket', 'goal', 'file']).optional(),
      refId: z.string().optional(),
      expiresAt: z
        .string()
        .optional()
        .describe('UTC "YYYY-MM-DD HH:MM:SS"; the notification stops showing after this'),
    }),
    execute: async (args) => {
      const stored = dispatchNotification(db, {
        ...args,
        source: 'agent',
        projectPath: args.projectPath ?? defaults.projectPath ?? null,
        projectName: args.projectPath ? null : (defaults.projectName ?? null),
      });
      return JSON.stringify({ uid: stored.uid, id: stored.id });
    },
  });

  server.addTool({
    name: 'notify_ask',
    description:
      'Ask the human a question and get a uid back. Poll notify_answer_get with that uid to ' +
      'read the decision. Does NOT block — the human may be away, so keep working on anything ' +
      'that does not depend on the answer, or finish and let a later run pick it up.',
    parameters: z.object({
      title: z.string().describe('The question, in one line'),
      body: z.string().optional().describe('Context that helps them decide'),
      options: z
        .array(
          z.object({
            value: z.string().describe('What you will read back as the answer'),
            label: z.string().describe('What the button says'),
          })
        )
        .min(1)
        .describe('The choices. Each becomes a button; the chosen value comes back as the answer.'),
      severity: z.enum(['info', 'success', 'warn', 'error']).optional(),
      origin: z.string().optional().describe('Who is asking, e.g. your agent name'),
      dedupeKey: z
        .string()
        .optional()
        .describe(
          'Re-asking under the same key replaces the earlier question rather than stacking'
        ),
      projectPath: z.string().optional().describe('Defaults to the project this server serves'),
      expiresAt: z
        .string()
        .optional()
        .describe('UTC "YYYY-MM-DD HH:MM:SS"; after this the answer comes back as "expired"'),
    }),
    execute: async (args) => {
      const stored = dispatchNotification(db, {
        title: args.title,
        body: args.body,
        severity: args.severity ?? 'warn',
        origin: args.origin,
        dedupeKey: args.dedupeKey,
        expiresAt: args.expiresAt,
        source: 'agent',
        kind: 'ask',
        projectPath: args.projectPath ?? defaults.projectPath ?? null,
        projectName: args.projectPath ? null : (defaults.projectName ?? null),
        // The action id is what gets recorded as the answer, so the caller's
        // `value` becomes the id — that is what they will read back.
        actions: args.options.map((option) => ({
          id: option.value,
          label: option.label,
          kind: 'answer',
          value: option.value,
        })),
      });
      return JSON.stringify({ uid: stored.uid });
    },
  });

  server.addTool({
    name: 'notify_answer_get',
    description:
      'Read the decision on a notify_ask. Returns status "pending" (not answered yet), ' +
      '"answered" (with the chosen value), "expired" (deadline passed unanswered), or "gone" ' +
      '(the human cleared it). Poll at a human pace — seconds apart at most, not in a tight loop.',
    parameters: z.object({
      uid: z.string().describe('The uid notify_ask returned'),
    }),
    execute: async ({ uid }) => JSON.stringify(getAnswer(db, uid)),
  });

  server.addTool({
    name: 'schedule_create',
    description:
      'Set a recurring reminder for the human. It fires into their inbox with an optional ' +
      '"start agent" button — it never starts anything on its own. AuricIDE does not run ' +
      'around the clock, so an occurrence missed while it was closed is caught up on the next ' +
      'start and shown as overdue.',
    parameters: z.object({
      name: z.string().describe('Short name, e.g. "Security-Scan"'),
      title: z.string().optional().describe('Notification title; defaults to the name'),
      body: z.string().optional().describe('Optional detail on the notification'),
      task: z
        .string()
        .optional()
        .describe('If set, the reminder offers a button that starts an agent with this task'),
      specKind: z.enum(['cron', 'every']).describe('A cron expression, or a fixed interval'),
      cronExpr: z
        .string()
        .optional()
        .describe(
          'Six fields, seconds first, e.g. "0 0 17 * * WED". Use weekday NAMES — numeric ' +
            'weekdays are counted differently here than in ordinary cron.'
        ),
      everyN: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Interval size, for specKind "every"'),
      everyUnit: z.enum(['hour', 'day', 'week']).optional(),
      anchorAt: z
        .string()
        .optional()
        .describe('First occurrence, UTC "YYYY-MM-DD HH:MM:SS". Required for specKind "every".'),
      timeOfDay: z.string().optional().describe('"HH:MM" in the schedule timezone'),
      timezone: z
        .string()
        .optional()
        .describe('IANA name, e.g. "Europe/Berlin". Keeps a wall-clock time stable across DST.'),
      catchUp: z
        .enum(['coalesce', 'skip', 'all'])
        .optional()
        .describe(
          'What happens to occurrences missed while the app was closed. Default "coalesce": ' +
            'one reminder saying how overdue it is, rather than a stack of identical ones.'
        ),
      projectPath: z.string().optional().describe('Defaults to the project this server serves'),
    }),
    execute: async (args) => {
      const stored = createSchedule(db, {
        name: args.name,
        specKind: args.specKind,
        cronExpr: args.cronExpr,
        everyN: args.everyN,
        everyUnit: args.everyUnit,
        anchorAt: args.anchorAt,
        timeOfDay: args.timeOfDay,
        timezone: args.timezone ?? 'UTC',
        catchUp: args.catchUp,
        projectPath: args.projectPath ?? defaults.projectPath ?? null,
        projectName: args.projectPath ? null : (defaults.projectName ?? null),
        payload: {
          title: args.title ?? args.name,
          body: args.body,
          severity: 'info',
          actions:
            args.task === undefined || args.task.trim() === ''
              ? []
              : [{ id: 'run', label: 'Agent starten', kind: 'spawn-agent', task: args.task }],
        },
      });
      return JSON.stringify({ id: stored.id, name: stored.name });
    },
  });

  server.addTool({
    name: 'schedule_list',
    description: 'List the recurring reminders that exist, with their rhythm and next due time.',
    parameters: z.object({}),
    execute: async () =>
      JSON.stringify(
        listSchedules(db).map((row) => ({
          id: row.id,
          name: row.name,
          enabled: row.enabled === 1,
          specKind: row.spec_kind,
          cronExpr: row.cron_expr,
          everyN: row.every_n,
          everyUnit: row.every_unit,
          timezone: row.timezone,
          catchUp: row.catch_up,
          nextDueAt: row.next_due_at,
          projectPath: row.project_path,
        }))
      ),
  });

  server.addTool({
    name: 'schedule_delete',
    description: 'Remove a recurring reminder. Notifications it already raised are kept.',
    parameters: z.object({ id: z.string().describe('The schedule id from schedule_list') }),
    execute: async ({ id }) => JSON.stringify({ deleted: deleteSchedule(db, id) }),
  });
}
