import type { StateCreator } from 'zustand';

/**
 * One glanceable sentence for the console's lane rail — see
 * `docs/design-console-lanes.md`, "Summaries". Produced on exactly two
 * transitions: an agent starting to wait on input (`ask`), and an agent
 * stopping (`done` / `failed`). `source` records whether an LLM polished the
 * heuristic extract or the extract stood on its own.
 */
export interface LaneSummary {
  kind: 'ask' | 'done' | 'failed';
  text: string;
  at: number;
  source: 'llm' | 'extract';
}

const NO_LANE_SUMMARIES: Record<string, LaneSummary> = {};

export interface LaneSummariesSlice {
  laneSummaries: Record<string, LaneSummary>;
  setLaneSummary: (agentId: string, summary: LaneSummary) => void;
  clearLaneSummary: (agentId: string) => void;
}

export const createLaneSummariesSlice: StateCreator<LaneSummariesSlice> = (set, get) => ({
  laneSummaries: NO_LANE_SUMMARIES,

  setLaneSummary: (agentId, summary) => {
    set({ laneSummaries: { ...get().laneSummaries, [agentId]: summary } });
  },

  clearLaneSummary: (agentId) => {
    const { [agentId]: _cleared, ...rest } = get().laneSummaries;
    set({ laneSummaries: rest });
  },
});
