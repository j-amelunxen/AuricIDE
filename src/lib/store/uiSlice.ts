import type { StateCreator } from 'zustand';
import type { LogEntry } from '@/app/components/terminal/TerminalPanel';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import type { SpawnPreset } from '@/lib/agents/spawnDefaults';

export const MAX_TERMINAL_LOGS = 10_000;

export interface AgentSettings {
  dangerouslyIgnorePermissions: boolean;
  autoAcceptEdits: boolean;
  agenticCommit: boolean;
  agenticCommitPrompt: string;
  branchTicketPattern: string;
  commitProviderId?: string;
}

export interface UISlice {
  terminalLogs: LogEntry[];
  cursorPos: { line: number; col: number };
  commandPaletteOpen: boolean;
  fileSearchOpen: boolean;
  fileSelectorOpen: boolean;
  findInFilesOpen: boolean;
  spawnDialogOpen: boolean;
  spawnAgentTicketId: string | null;
  spawnAgentGoalId: string | null;
  spawnAgentRepoPath: string | null;
  /** Provider/model/permission pinned by the Quick Access skill that opened
   * the dialog. Null for every other entry point. One field, not three: they
   * always travel together and are always cleared together. */
  spawnAgentPreset: SpawnPreset | null;
  initialAgentTask: string;
  cliConnected: boolean;
  llmConfigured: boolean;
  /** True when a SEPARATE judge model is configured (judge_llm_settings has an
   * api_key). Gates the LLM-judge review — without it a claim stays blocking. */
  judgeLlmConfigured: boolean;
  agentSettings: AgentSettings;
  enableDeepNlp: boolean;
  importSpecDialogOpen: boolean;
  videoImportDialogOpen: boolean;
  referencesPanelOpen: boolean;
  referencesPanelQuery: string;
  referencesPanelResults: ReferenceResult[];
  providers: ProviderInfo[];

  setImportSpecDialogOpen: (open: boolean) => void;
  setVideoImportDialogOpen: (open: boolean) => void;
  addTerminalLog: (log: LogEntry) => void;
  clearTerminalLogs: (tab?: string) => void;
  setCursorPos: (line: number, col: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setFileSearchOpen: (open: boolean) => void;
  setFileSelectorOpen: (open: boolean) => void;
  setFindInFilesOpen: (open: boolean) => void;
  setSpawnDialogOpen: (open: boolean) => void;
  setSpawnAgentTicketId: (id: string | null) => void;
  setSpawnAgentGoalId: (id: string | null) => void;
  setSpawnAgentRepoPath: (path: string | null) => void;
  setSpawnAgentPreset: (preset: SpawnPreset | null) => void;
  setInitialAgentTask: (task: string) => void;
  setCliConnected: (connected: boolean) => void;
  setLlmConfigured: (configured: boolean) => void;
  setJudgeLlmConfigured: (configured: boolean) => void;
  setEnableDeepNlp: (enabled: boolean) => void;
  updateAgentSettings: (settings: Partial<AgentSettings>) => void;
  setReferencesPanel: (open: boolean, query?: string, results?: ReferenceResult[]) => void;
  setProviders: (providers: ProviderInfo[]) => void;
}

export const createUISlice: StateCreator<UISlice> = (set) => ({
  terminalLogs: [],
  cursorPos: { line: 1, col: 1 },
  commandPaletteOpen: false,
  fileSearchOpen: false,
  fileSelectorOpen: false,
  findInFilesOpen: false,
  spawnDialogOpen: false,
  spawnAgentTicketId: null,
  spawnAgentGoalId: null,
  spawnAgentRepoPath: null,
  spawnAgentPreset: null,
  initialAgentTask: '',
  cliConnected: false,
  llmConfigured: false,
  judgeLlmConfigured: false,
  enableDeepNlp: false,
  importSpecDialogOpen: false,
  videoImportDialogOpen: false,
  referencesPanelOpen: false,
  referencesPanelQuery: '',
  referencesPanelResults: [],
  providers: [FALLBACK_CRUSH_PROVIDER],
  agentSettings: {
    dangerouslyIgnorePermissions: false,
    autoAcceptEdits: false,
    agenticCommit: true,
    agenticCommitPrompt:
      'commit and push on the current branch. Do not switch branches. Commit message prefix: {ticket}:',
    branchTicketPattern: '([A-Z]+-\\d+)',
  },

  addTerminalLog: (log) =>
    set((state) => {
      const logs = [...state.terminalLogs, log];
      return {
        terminalLogs:
          logs.length > MAX_TERMINAL_LOGS ? logs.slice(logs.length - MAX_TERMINAL_LOGS) : logs,
      };
    }),

  clearTerminalLogs: (tab) =>
    set((state) => ({
      terminalLogs: tab ? state.terminalLogs.filter((l) => l.tab !== tab) : [],
    })),

  setCursorPos: (line, col) => set({ cursorPos: { line, col } }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  setFileSearchOpen: (open) => set({ fileSearchOpen: open }),

  setFileSelectorOpen: (open) => set({ fileSelectorOpen: open }),

  setFindInFilesOpen: (open) => set({ findInFilesOpen: open }),

  setSpawnDialogOpen: (open) => set({ spawnDialogOpen: open }),

  setSpawnAgentTicketId: (id) => set({ spawnAgentTicketId: id }),

  setSpawnAgentGoalId: (id) => set({ spawnAgentGoalId: id }),

  setSpawnAgentRepoPath: (path) => set({ spawnAgentRepoPath: path }),

  setSpawnAgentPreset: (preset) => set({ spawnAgentPreset: preset }),

  setInitialAgentTask: (task) => set({ initialAgentTask: task }),

  setCliConnected: (connected) => set({ cliConnected: connected }),

  setLlmConfigured: (configured) => set({ llmConfigured: configured }),
  setJudgeLlmConfigured: (configured) => set({ judgeLlmConfigured: configured }),

  setEnableDeepNlp: (enabled) => set({ enableDeepNlp: enabled }),

  setImportSpecDialogOpen: (open) => set({ importSpecDialogOpen: open }),
  setVideoImportDialogOpen: (open) => set({ videoImportDialogOpen: open }),

  updateAgentSettings: (newSettings) =>
    set((state) => ({
      agentSettings: { ...state.agentSettings, ...newSettings },
    })),

  setReferencesPanel: (open, query, results) =>
    set({
      referencesPanelOpen: open,
      referencesPanelQuery: query ?? '',
      referencesPanelResults: results ?? [],
    }),

  setProviders: (providers) => set({ providers }),
});
