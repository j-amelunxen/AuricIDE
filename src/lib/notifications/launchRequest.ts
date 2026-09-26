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
