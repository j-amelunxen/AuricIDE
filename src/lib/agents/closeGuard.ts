import type { AgentInfo } from '../tauri/agents';

/** Agents whose process is still live — parked ones included, finished ones not. */
export function runningAgentCount(agents: Pick<AgentInfo, 'status'>[]): number {
  return agents.filter((agent) => agent.status === 'running').length;
}

/**
 * The question asked when the window is about to close on a live fleet.
 * Cancel must abort the close; confirm is the only way the IDE actually leaves.
 */
export function quitWhileAgentsRunningRequest(count: number): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  const what = count === 1 ? '1 running agent' : `${count} running agents`;
  return {
    title: 'Agents are still running',
    message: `${what} will be interrupted if you leave.`,
    confirmLabel: 'Close anyway',
  };
}
