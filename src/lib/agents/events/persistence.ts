import { AGENT_LOG_MAX_ROWS, loadAppConfig } from '../../config/appConfig';
import { agentLogAppend, agentLogPrune, type PersistedAgentEvent } from '../../tauri/agentLog';
import { truncateLabel } from './providers/shared';
import { redactSecrets } from './redact';
import type { AgentEvent } from './types';

/**
 * The write side of the Agent Console's on-disk history.
 *
 * Two things shape this module. First, it is **opt-in**: while the setting is
 * off nothing is buffered, written, or even asked of the store — "off" has to
 * mean the events never leave memory, not that they are written and then
 * discarded. Second, it runs off the PTY stream, so it must never make an
 * agent's output wait on a disk write and must never surface a failure into
 * that path: a lost history row is a far smaller problem than a broken feed.
 */

/** Just enough of an agent to identify its rows later, once it has exited. */
export interface AgentLogSubject {
  id: string;
  name: string;
  repoPath?: string;
}

/**
 * Events waiting to be written. The store flushes per agent roughly once a
 * second; writing each of those separately would be one IPC round trip per
 * agent per second, so they coalesce into one batch instead.
 */
let pending: PersistedAgentEvent[] = [];

function persistenceEnabled(): boolean {
  return loadAppConfig().agentLogPersist;
}

/**
 * The label as it may be stored: masked, and bounded for the one kind that
 * arrives unbounded.
 *
 * `error` labels are the agent's raw result line, which no extractor shortens
 * — every other long label goes through `truncateLabel` before it gets here.
 * A single stack trace would otherwise take a row of its own in the history.
 */
function labelForDisk(event: AgentEvent): string {
  const masked = redactSecrets(event.label);
  return event.kind === 'error' ? truncateLabel(masked) : masked;
}

/**
 * Buffers an agent's newly extracted events for the on-disk history.
 *
 * Cheap and synchronous by design — this sits directly in the store's log
 * flush. The enabled check happens here rather than at write time so that a
 * disabled history costs one boolean read and nothing else.
 *
 * Labels are masked on their way into the buffer and nowhere else: the events
 * the caller passes in are the ones the store keeps and the console shows, and
 * on screen the command has to read as what actually ran. Only the copy that
 * outlives the session is redacted, so the row built here is a new object and
 * the caller's is never touched.
 */
export function recordAgentLogEvents(agent: AgentLogSubject, events: AgentEvent[]): void {
  if (events.length === 0) return;
  if (!persistenceEnabled()) return;

  for (const event of events) {
    pending.push({
      agentId: agent.id,
      agentName: agent.name,
      repoPath: agent.repoPath,
      kind: event.kind,
      label: labelForDisk(event),
      path: event.path,
      at: event.at,
      seq: event.seq ?? 0,
    });
  }
}

/**
 * Writes whatever is buffered.
 *
 * Re-checks the setting: it can be switched off between a record and this
 * call, and what was buffered under the old answer must not land on disk
 * under the new one. Never rejects — see the module note.
 */
export async function flushAgentLog(): Promise<void> {
  if (pending.length === 0) return;

  const batch = pending;
  pending = [];

  if (!persistenceEnabled()) return;

  try {
    await agentLogAppend(batch);
  } catch {
    // Deliberately swallowed. This runs off ordinary agent output; a rejected
    // promise here would surface as an unhandled rejection mid-stream, and the
    // batch is already out of the buffer so the next flush proceeds normally.
  }
}

/**
 * Trims the stored history to both bounds — the configured age span and the
 * row cap. Called once when the app has the console's history in view.
 *
 * The retention span is passed through exactly as configured, `0` included:
 * that means "no age limit", and the row cap is what bounds the file in that
 * case. Reading it as "keep nothing" would quietly delete the whole history.
 */
export async function pruneAgentLogHistory(): Promise<void> {
  const config = loadAppConfig();
  if (!config.agentLogPersist) return;

  try {
    await agentLogPrune(config.agentLogRetentionDays, AGENT_LOG_MAX_ROWS);
  } catch {
    // A history that could not be trimmed is not a reason to fail anything the
    // user asked for; the next launch tries again.
  }
}

/** Test-only: drops the buffer so tests do not leak state into each other. */
export function resetAgentLogWriter(): void {
  pending = [];
}
