import type { StateCreator } from 'zustand';

import type { AgentUsageRow } from '../tauri/agentUsage';
import { agentUsageLoad } from '../tauri/agentUsage';

type LoadStatus = 'loading' | 'ready' | 'error';

export interface AgentUsageSlice {
  /** Recorded runs per project path, newest first. */
  agentUsageRows: Record<string, AgentUsageRow[]>;
  agentUsageStatus: Record<string, LoadStatus>;
  loadAgentUsage: (projectPath: string) => Promise<void>;
  /** Adds one run the backend just recorded; a run already held is replaced, not doubled. */
  appendAgentUsage: (projectPath: string, row: AgentUsageRow) => void;
}

/** One shared list, so a selector for a project with no rows is referentially stable. */
const NO_ROWS: AgentUsageRow[] = [];

export function selectAgentUsageRows(
  state: Pick<AgentUsageSlice, 'agentUsageRows'>,
  projectPath: string | null
): AgentUsageRow[] {
  return (projectPath && state.agentUsageRows[projectPath]) || NO_ROWS;
}

function newestFirst(a: AgentUsageRow, b: AgentUsageRow): number {
  return b.finishedAt.localeCompare(a.finishedAt);
}

/** `incoming` wins over `held` for the same id. */
function mergeRows(held: AgentUsageRow[], incoming: AgentUsageRow[]): AgentUsageRow[] {
  const byId = new Map(held.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort(newestFirst);
}

export const createAgentUsageSlice: StateCreator<AgentUsageSlice> = (set, get) => ({
  agentUsageRows: {},
  agentUsageStatus: {},

  loadAgentUsage: async (projectPath) => {
    set((s) => ({ agentUsageStatus: { ...s.agentUsageStatus, [projectPath]: 'loading' } }));
    try {
      const loaded = await agentUsageLoad(projectPath);
      // Merged rather than replaced: a run recorded while the request was in
      // flight may not be in the loaded list, and dropping it would lose it
      // until the next reload.
      const held = get().agentUsageRows[projectPath] ?? NO_ROWS;
      set((s) => ({
        agentUsageRows: { ...s.agentUsageRows, [projectPath]: mergeRows(held, loaded) },
        agentUsageStatus: { ...s.agentUsageStatus, [projectPath]: 'ready' },
      }));
    } catch {
      // Browser mode or a backend that is not up: keep what is held.
      set((s) => ({ agentUsageStatus: { ...s.agentUsageStatus, [projectPath]: 'error' } }));
    }
  },

  appendAgentUsage: (projectPath, row) => {
    set((s) => ({
      agentUsageRows: {
        ...s.agentUsageRows,
        [projectPath]: mergeRows(s.agentUsageRows[projectPath] ?? NO_ROWS, [row]),
      },
    }));
  },
});
