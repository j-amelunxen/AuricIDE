import type { StateCreator } from 'zustand';
import type { LogEntry } from '@/app/components/terminal/TerminalPanel';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';

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
  spawnDialogOpen: boolean;
  spawnAgentTicketId: string | null;
  initialAgentTask: string;
  cliConnected: boolean;
  llmConfigured: boolean;
  agentSettings: AgentSettings;
  enableDeepNlp: boolean;
  importSpecDialogOpen: boolean;
  referencesPanelOpen: boolean;
  referencesPanelQuery: string;
  referencesPanelResults: ReferenceResult[];
  providers: ProviderInfo[];

  setImportSpecDialogOpen: (open: boolean) => void;
  addTerminalLog: (log: LogEntry) => void;
  clearTerminalLogs: (tab?: string) => void;
  setCursorPos: (line: number, col: number) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setFileSearchOpen: (open: boolean) => void;
  setFileSelectorOpen: (open: boolean) => void;
  setSpawnDialogOpen: (open: boolean) => void;
  setSpawnAgentTicketId: (id: string | null) => void;
  setInitialAgentTask: (task: string) => void;
  setCliConnected: (connected: boolean) => void;
  setLlmConfigured: (configured: boolean) => void;
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
  spawnDialogOpen: false,
  spawnAgentTicketId: null,
  initialAgentTask: '',
  cliConnected: false,
  llmConfigured: false,
  enableDeepNlp: false,
  importSpecDialogOpen: false,
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

  setSpawnDialogOpen: (open) => set({ spawnDialogOpen: open }),

  setSpawnAgentTicketId: (id) => set({ spawnAgentTicketId: id }),

  setInitialAgentTask: (task) => set({ initialAgentTask: task }),

  setCliConnected: (connected) => set({ cliConnected: connected }),

  setLlmConfigured: (configured) => set({ llmConfigured: configured }),

  setEnableDeepNlp: (enabled) => set({ enableDeepNlp: enabled }),

  setImportSpecDialogOpen: (open) => set({ importSpecDialogOpen: open }),

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
