import type { AgentConfig, AgentInfo } from '../tauri/agents';
import { notificationsRecordLaunchRun } from '../tauri/notifications';
import { deriveFinishSummary } from './finishSummary';

/**
 * Keeps the inbox's record of an agent launch request (MCP
 * `request_agent_launch`) in step with the agent it became, so the asking
 * agent can read the outcome back through `get_agent_run`.
 *
 * Best effort by design: the record is a report, never a precondition. A
 * missing backend (browser mode) or a locked database costs the report, not
 * the agent — the spawn and the goal run are already in the store.
 */
function record(input: Parameters<typeof notificationsRecordLaunchRun>[0]): void {
  try {
    notificationsRecordLaunchRun(input).catch(() => undefined);
  } catch {
    // No backend at all.
  }
}

export function recordLaunchStart(config: AgentConfig, agent: AgentInfo): void {
  if (!config.launchRequestUid) return;
  record({
    requestUid: config.launchRequestUid,
    agentId: agent.id,
    agentName: agent.name,
    provider: agent.provider ?? config.provider ?? null,
    model: config.model,
    status: 'running',
  });
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
  });
}
