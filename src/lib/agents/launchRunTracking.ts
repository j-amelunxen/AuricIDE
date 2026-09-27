import type { AgentConfig } from '../tauri/agents';
import { notificationsRecordLaunchRun } from '../tauri/notifications';
import { deriveFinishSummary } from './finishSummary';

/**
 * Adds what only the frontend knows to the inbox's record of an agent launch
 * request (MCP `request_agent_launch`): the summary derived from the logs, so
 * the asking agent can read it back through `get_agent_run`.
 *
 * The status itself is the backend's alone (`agents::launch_runs`): it
 * records the spawn, the exit and a kill in the order they happen, and a
 * restart marks runs of a dead process `interrupted`. What is sent from here
 * is `summaryOnly`: the store may see a killed agent as `idle` first, and
 * that must not decide the run's status (review r2).
 *
 * A failed write is retried a few times; the agent never waits for it. A
 * missing backend (browser mode) costs the summary, not the agent.
 */
export const LAUNCH_RECORD_RETRY_MS = [200, 1_000, 5_000];

function record(input: Parameters<typeof notificationsRecordLaunchRun>[0], attempt = 0): void {
  const retry = () => {
    const delay = LAUNCH_RECORD_RETRY_MS[attempt];
    if (delay !== undefined) setTimeout(() => record(input, attempt + 1), delay);
  };
  try {
    notificationsRecordLaunchRun(input).catch(retry);
  } catch {
    // No backend at all.
  }
}

export function recordLaunchFinish(
  config: AgentConfig | undefined,
  agentId: string,
  outcome: 'completed' | 'failed' | 'killed',
  logs: string[]
): void {
  if (!config?.launchRequestUid) return;
  record({
    requestUid: config.launchRequestUid,
    agentId,
    status: outcome,
    summary: deriveFinishSummary(logs),
    summaryOnly: true,
  });
}
