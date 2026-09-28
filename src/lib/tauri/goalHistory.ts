import type { GoalHistoryEntry } from '@/lib/pm/metrics/goalMetrics';
import { invoke } from './invoke';

export interface GoalStatusHistoryEntry extends GoalHistoryEntry {
  id: string;
}

/**
 * A goal's status changes, oldest first; all goals' when `goalId` is omitted.
 * Rust writes them inside the goal save and the MCP writers, never the UI.
 */
export async function goalsLoadStatusHistory(
  projectPath: string,
  goalId?: string
): Promise<GoalStatusHistoryEntry[]> {
  return await invoke<GoalStatusHistoryEntry[]>('goals_load_status_history', {
    projectPath,
    goalId: goalId ?? null,
  });
}
