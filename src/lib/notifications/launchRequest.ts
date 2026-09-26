import type { Notification } from './types';

/**
 * A launch request is an agent's ask, via MCP `request_agent_launch`, that the
 * IDE start an agent for a goal (`src/mcp/tools/agentLaunch.ts`).
 *
 * Three markers together: the row is agent-written, its origin is the tool's
 * name, and its dedupe key carries the prefix. The MCP `notify` and
 * `notify_ask` tools refuse both the origin and the prefix
 * (`isReservedLaunchMarker`), so only `request_agent_launch` writes such a
 * row. Recognising a row as a request grants it nothing: it is still foreign.
 * Only a launch grant decides whether it may start without a click. The Rust
 * side applies the same test (`is_launch_request` in
 * `notifications/operations.rs`).
 */
export const LAUNCH_REQUEST_KEY_PREFIX = 'agent-launch:';
export const LAUNCH_REQUEST_ORIGIN = 'request_agent_launch';

/** What a launch request says; both writers (MCP and the conductor) fill it. */
export interface LaunchRequestSpec {
  uid: string;
  goalId: string;
  goalName: string;
  /** What the started agent is told to do. */
  prompt: string;
  /** The folder the agent runs in: the requester's own, never one it names. */
  folder: string;
  projectPath: string;
  projectName?: string | null;
  provider?: string;
  model?: string;
  worktree?: boolean;
  title?: string;
}

const MAX_BODY_LENGTH = 280;

/**
 * The one shape of a launch request row. MCP `request_agent_launch` and the
 * conductor's stations mode both write it through here, so the row the native
 * claim and directory checks read (`is_launch_request`, `stored_placement`) is
 * the same whoever asked. It is always agent-written and so foreign: only a
 * click or a launch grant starts it.
 */
export function buildLaunchRequest(spec: LaunchRequestSpec) {
  const body =
    spec.prompt.length > MAX_BODY_LENGTH
      ? `${spec.prompt.slice(0, MAX_BODY_LENGTH - 3)}...`
      : spec.prompt;
  return {
    uid: spec.uid,
    title: spec.title?.trim() || `Agent requested for goal "${spec.goalName}"`,
    body,
    severity: 'info' as const,
    source: 'agent' as const,
    origin: LAUNCH_REQUEST_ORIGIN,
    dedupeKey: `${LAUNCH_REQUEST_KEY_PREFIX}${spec.uid}`,
    refKind: 'goal' as const,
    refId: spec.goalId,
    projectPath: spec.projectPath,
    projectName: spec.projectName ?? null,
    actions: [
      {
        id: 'start',
        label: 'Start agent',
        kind: 'spawn-agent' as const,
        task: spec.prompt,
        repoPath: spec.folder,
        goalId: spec.goalId,
        ...(spec.provider ? { provider: spec.provider } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.worktree ? { useWorktree: true } : {}),
      },
    ],
  };
}

export function isLaunchRequest(notification: Notification): boolean {
  return (
    notification.source === 'agent' &&
    notification.origin === LAUNCH_REQUEST_ORIGIN &&
    notification.dedupeKey?.startsWith(LAUNCH_REQUEST_KEY_PREFIX) === true &&
    notification.refKind === 'goal' &&
    typeof notification.refId === 'string' &&
    notification.refId !== ''
  );
}

/** True for an origin or dedupe key that only `request_agent_launch` may use. */
export function isReservedLaunchMarker(origin?: string | null, dedupeKey?: string | null): boolean {
  const normalisedOrigin = origin?.trim().toLowerCase();
  const normalisedKey = dedupeKey?.trim().toLowerCase();
  return (
    normalisedOrigin === LAUNCH_REQUEST_ORIGIN ||
    normalisedKey?.startsWith(LAUNCH_REQUEST_KEY_PREFIX) === true
  );
}

/**
 * What a launch request's `answer` column says once the IDE acted on it.
 * Written once (`answer_impl` never overwrites), read back by MCP
 * `get_agent_run`: `agent:<id>` names the agent it started, `failed:<why>`
 * says the start was attempted and did not happen.
 */
export type LaunchOutcome =
  { kind: 'started'; agentId: string } | { kind: 'failed'; error: string } | { kind: 'dismissed' };

const MAX_ERROR_LENGTH = 500;

export function launchStartedAnswer(agentId: string): string {
  return `agent:${agentId}`;
}

export function launchFailedAnswer(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `failed:${text.slice(0, MAX_ERROR_LENGTH)}`;
}

export function parseLaunchAnswer(answer: string | null): LaunchOutcome | null {
  if (answer === null) return null;
  if (answer.startsWith('agent:') && answer.length > 'agent:'.length) {
    return { kind: 'started', agentId: answer.slice('agent:'.length) };
  }
  if (answer.startsWith('failed:'))
    return { kind: 'failed', error: answer.slice('failed:'.length) };
  return { kind: 'dismissed' };
}
