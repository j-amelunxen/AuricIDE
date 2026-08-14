import { z } from 'zod';
import type { PermissionMode } from '@/lib/tauri/agents';

/**
 * The notification bus: what happened, said once, kept until it is read.
 *
 * This is deliberately not the attention model (`src/lib/agents/attention.ts`).
 * Attention is derived from the current state and heals itself — an agent that
 * recovers stops asking for a human. A notification is an event with a
 * timestamp; it never heals, it gets read or answered. The two are counted
 * separately and must never be summed: one says "what needs me now", the other
 * "what happened while I was away".
 */

export type NotificationSeverity = 'info' | 'success' | 'warn' | 'error';
export type NotificationKind = 'info' | 'ask';
export type NotificationSource = 'ui' | 'agent' | 'mcp' | 'system';
export type NotificationRefKind = 'agent' | 'ticket' | 'goal' | 'file';

/** One notification as it comes back from the database. */
export interface Notification {
  /** Monotonic row id — the drain cursor. Not stable across a wipe. */
  id: number;
  /** Stable identity, assigned by whichever process dispatched it. */
  uid: string;
  createdAt: string;
  projectPath: string | null;
  projectName: string | null;
  source: NotificationSource;
  /** Free label for the dispatcher, e.g. an agent or schedule name. */
  origin: string | null;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** Raw actions as stored; run through `parseNotificationActions` before use. */
  actions: unknown;
  dedupeKey: string | null;
  refKind: NotificationRefKind | null;
  refId: string | null;
  readAt: string | null;
  answeredAt: string | null;
  /** The chosen action id, or `dismissed`. */
  answer: string | null;
  expiresAt: string | null;
}

export type SkillSnapshot = {
  id: string;
  label: string;
  prompt: string;
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  invocation?: string;
};

/**
 * What a notification may ask the app to do. Closed on purpose: a payload can
 * arrive from an MCP agent or straight from the database, so "run this string"
 * is not on the menu. Every variant names an operation the IDE already has.
 */
export type NotificationAction =
  | { id: string; label: string; kind: 'answer'; value: string }
  | {
      id: string;
      label: string;
      kind: 'spawn-agent';
      task: string;
      repoPath?: string;
      ticketId?: string;
      goalId?: string;
      provider?: string;
      model?: string;
    }
  | {
      id: string;
      label: string;
      kind: 'run-skill';
      skillId: string;
      skillLabel: string;
      prompt: string;
      repoPath: string;
      providerId?: string;
      model?: string;
      permissionMode?: PermissionMode;
      invocation?: string;
    }
  | {
      id: string;
      label: string;
      kind: 'run-combo';
      comboId: string;
      comboLabel: string;
      repoPath: string;
      steps: SkillSnapshot[];
    }
  | { id: string; label: string; kind: 'open'; target: NotificationOpenTarget }
  | { id: string; label: string; kind: 'command'; commandId: string };

export type NotificationOpenTarget =
  | { type: 'file'; path: string; line?: number }
  | { type: 'ticket'; ticketId: string }
  | { type: 'goal'; goalId: string }
  | { type: 'agent'; agentId: string };

const nonEmpty = z.string().trim().min(1);

const openTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    path: nonEmpty,
    line: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal('ticket'), ticketId: nonEmpty }),
  z.object({ type: z.literal('goal'), goalId: nonEmpty }),
  z.object({ type: z.literal('agent'), agentId: nonEmpty }),
]);

const identity = { id: nonEmpty, label: nonEmpty };

const permissionModeSchema = z.enum([
  'bypassPermissions',
  'acceptEdits',
  'plan',
  'auto',
  'default',
  'yolo',
]);

const skillSnapshotSchema = z.object({
  id: nonEmpty,
  label: nonEmpty,
  prompt: nonEmpty,
  providerId: z.string().optional(),
  model: z.string().optional(),
  permissionMode: permissionModeSchema.optional(),
  invocation: z.string().optional(),
});

/**
 * Validates one action's shape. Command ids are checked separately, against
 * the live manifest — the schema cannot know them.
 */
export const notificationActionSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, kind: z.literal('answer'), value: nonEmpty }),
  z.object({
    ...identity,
    kind: z.literal('spawn-agent'),
    task: nonEmpty,
    repoPath: z.string().optional(),
    ticketId: z.string().optional(),
    goalId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    ...identity,
    kind: z.literal('run-skill'),
    skillId: nonEmpty,
    skillLabel: nonEmpty,
    prompt: nonEmpty,
    repoPath: nonEmpty,
    providerId: z.string().optional(),
    model: z.string().optional(),
    permissionMode: permissionModeSchema.optional(),
    invocation: z.string().optional(),
  }),
  z.object({
    ...identity,
    kind: z.literal('run-combo'),
    comboId: nonEmpty,
    comboLabel: nonEmpty,
    repoPath: nonEmpty,
    steps: z.array(skillSnapshotSchema).min(1).max(8),
  }),
  z.object({ ...identity, kind: z.literal('open'), target: openTargetSchema }),
  z.object({ ...identity, kind: z.literal('command'), commandId: nonEmpty }),
]);

/** Accepts the parsed array or the raw TEXT the column stores. */
function toArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Turns whatever was stored into actions that are safe to render and execute.
 *
 * Invalid entries are dropped, not thrown on: a single malformed button must
 * not cost the user a notification whose title and body still matter, and the
 * siblings that parsed fine are still worth offering.
 *
 * `isKnownCommandId` gates the `command` variant against the command manifest,
 * so an unrecognised id never reaches a button — it is rejected here rather
 * than failing at click time, when the user has already committed to it.
 */
export function parseNotificationActions(
  raw: unknown,
  isKnownCommandId: (commandId: string) => boolean
): NotificationAction[] {
  const seen = new Set<string>();
  const actions: NotificationAction[] = [];

  for (const entry of toArray(raw)) {
    const result = notificationActionSchema.safeParse(entry);
    if (!result.success) continue;

    const action = result.data as NotificationAction;
    if (action.kind === 'command' && !isKnownCommandId(action.commandId)) continue;
    // A repeated id would make the recorded answer ambiguous, and that answer
    // is exactly what a waiting agent reads back. First one wins.
    if (seen.has(action.id)) continue;

    seen.add(action.id);
    actions.push(action);
  }

  return actions;
}

/**
 * True once a question has been settled. Only asks can reach this state —
 * an info notification's buttons are navigation, and navigating somewhere
 * twice is allowed.
 */
export function isAnsweredNotification(
  notification: Pick<Notification, 'kind' | 'answeredAt'>
): boolean {
  return notification.kind === 'ask' && notification.answeredAt !== null;
}
