import { killAgent, listAgents } from '@/lib/tauri/agents';
import { AGENT_STATUSES } from './types';

const STATUSES: ReadonlySet<string> = new Set(AGENT_STATUSES);

/**
 * A stop the backend did not confirm. The agent may still be running, so
 * nothing about it — card, logs, ticket, goal run — may be treated as ended.
 */
export class AgentStopError extends Error {
  constructor(
    readonly failedIds: string[],
    readonly stoppedIds: string[],
    causes: string[]
  ) {
    const which = failedIds.length === 1 ? `agent ${failedIds[0]}` : `${failedIds.length} agents`;
    super(`Could not stop ${which}: ${causes.join('; ')}`);
    this.name = 'AgentStopError';
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * After a refused kill, only the backend's own list can say the agent is gone
 * (it ended on its own meanwhile). A list that cannot be read, or a row that is
 * not an agent, proves nothing.
 */
async function backendShowsStopped(agentId: string): Promise<boolean> {
  let listed: unknown;
  try {
    listed = await listAgents();
  } catch {
    return false;
  }
  if (!Array.isArray(listed)) return false;
  let target: { status: string } | undefined;
  for (const row of listed as unknown[]) {
    if (typeof row !== 'object' || row === null) return false;
    const { id, status } = row as { id?: unknown; status?: unknown };
    if (typeof id !== 'string' || typeof status !== 'string' || !STATUSES.has(status)) {
      return false;
    }
    if (id === agentId) target = { status };
  }
  return !target || target.status === 'idle' || target.status === 'error';
}

/** Resolves once the backend has stopped the agent's process; rejects with
 * {@link AgentStopError} when that is not established. */
export async function stopAgentProcess(agentId: string): Promise<void> {
  try {
    await killAgent(agentId);
  } catch (error) {
    if (await backendShowsStopped(agentId)) return;
    throw new AgentStopError([agentId], [], [describe(error)]);
  }
}

/** Stops each agent on its own and reports which ones the backend confirmed. */
export async function stopAgentProcesses(
  agentIds: readonly string[]
): Promise<{ stoppedIds: string[]; error: AgentStopError | null }> {
  const settled = await Promise.allSettled(agentIds.map((id) => stopAgentProcess(id)));
  const stoppedIds: string[] = [];
  const failedIds: string[] = [];
  const causes: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      stoppedIds.push(agentIds[index]);
    } else {
      failedIds.push(agentIds[index]);
      causes.push(describe(result.reason));
    }
  });
  return {
    stoppedIds,
    error: failedIds.length > 0 ? new AgentStopError(failedIds, stoppedIds, causes) : null,
  };
}
