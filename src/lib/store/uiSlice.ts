import type { StateCreator } from 'zustand';
import type { LogEntry } from '@/app/components/terminal/TerminalPanel';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import type { SpawnPreset } from '@/lib/agents/spawnDefaults';
import type { WorkTab } from '@/lib/work/tabs';
import { loadProjectConfig, setProjectConfigValue } from '@/lib/config/projectConfig';

export const MAX_TERMINAL_LOGS = 10_000;

/**
 * The agent settings that belong to the project rather than the machine — they
 * describe this codebase's conventions, not a preference of yours.
 *
 * `dangerouslyIgnorePermissions` and `autoAcceptEdits` are missing on purpose.
 * Both stay session state: a switch that grants an agent free rein, silently
 * restored days later, is one nobody remembers leaving on.
 */
export const PROJECT_SCOPED_AGENT_SETTINGS = [
  'agenticCommit',
  'agenticCommitPrompt',
  'branchTicketPattern',
  'commitProviderId',
] as const satisfies readonly (keyof AgentSettings)[];

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
  /** The Spotlight-style quick-capture overlay for the inbox. */
  inboxCaptureOpen: boolean;
  referencesPanelOpen: boolean;
  referencesPanelQuery: string;
  referencesPanelResults: ReferenceResult[];
  providers: ProviderInfo[];
  /** Center place: Goals / Tickets / Requirements / Lines. */
  workPlaceOpen: boolean;
  workTab: WorkTab;
  /** Full-area overlay listing every running agent, grouped by project. */
  agentConsoleOpen: boolean;
  /** Full-area overlay for the inbox and every schedule, grouped by project. */
  commandCenterOpen: boolean;
  /**
   * Which group the center is showing. Three states, and they mean different
   * things: `undefined` is every project at once, `null` is the app itself
   * (rows that belong to no project), a string is that one project.
   */
  commandCenterProject: string | null | undefined;

  setImportSpecDialogOpen: (open: boolean) => void;
  setVideoImportDialogOpen: (open: boolean) => void;
  setInboxCaptureOpen: (open: boolean) => void;
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
  /** Replaces the project-scoped agent settings with the ones this project stores. */
  loadProjectAgentSettings: (rootPath: string | null) => Promise<void>;
  setReferencesPanel: (open: boolean, query?: string, results?: ReferenceResult[]) => void;
  setProviders: (providers: ProviderInfo[]) => void;
  openWorkPlace: (tab?: WorkTab) => void;
  closeWorkPlace: () => void;
  setWorkTab: (tab: WorkTab) => void;
  openAgentConsole: () => void;
  closeAgentConsole: () => void;
  toggleAgentConsole: () => void;
  /** Omitting the path opens on "All" — never on whatever was picked last time. */
  openCommandCenter: (projectPath?: string | null) => void;
  closeCommandCenter: () => void;
  selectCommandCenterProject: (projectPath: string | null | undefined) => void;
}

export const createUISlice: StateCreator<UISlice> = (set, get) => ({
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
  inboxCaptureOpen: false,
  referencesPanelOpen: false,
  referencesPanelQuery: '',
  referencesPanelResults: [],
  providers: [FALLBACK_CRUSH_PROVIDER],
  workPlaceOpen: false,
  workTab: 'goals',
  agentConsoleOpen: false,
  commandCenterOpen: false,
  commandCenterProject: undefined,
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
  setInboxCaptureOpen: (open) => set({ inboxCaptureOpen: open }),

  updateAgentSettings: (newSettings) => {
    set((state) => ({
      agentSettings: { ...state.agentSettings, ...newSettings },
    }));

    // Persist the ones that describe this codebase — how its branches name
    // tickets, how its commits get written. The two safety switches are
    // deliberately absent: see PROJECT_SCOPED_AGENT_SETTINGS.
    const rootPath = (get() as { rootPath?: string | null }).rootPath;
    if (!rootPath) return;
    for (const key of PROJECT_SCOPED_AGENT_SETTINGS) {
      const value = newSettings[key];
      if (value === undefined) continue;
      // Fire and forget: a settings write must never block the toggle from
      // moving, and the value is already live in the store either way.
      void setProjectConfigValue(rootPath, key, value as never).catch(() => {});
    }
  },

  loadProjectAgentSettings: async (rootPath) => {
    const stored = await loadProjectConfig(rootPath ?? '');
    set((state) => ({
      agentSettings: {
        ...state.agentSettings,
        agenticCommit: stored.agenticCommit,
        agenticCommitPrompt: stored.agenticCommitPrompt,
        branchTicketPattern: stored.branchTicketPattern,
        commitProviderId: stored.commitProviderId || undefined,
        // Opening a project is not a reason to carry elevated permissions
        // from the last one into it.
        dangerouslyIgnorePermissions: false,
        autoAcceptEdits: false,
      },
      // Lives in another slice but is loaded here, so one read of the project
      // config restores everything it holds.
      conductorProviderId: stored.conductorProviderId || null,
    }));
  },

  setReferencesPanel: (open, query, results) =>
    set({
      referencesPanelOpen: open,
      referencesPanelQuery: query ?? '',
      referencesPanelResults: results ?? [],
    }),

  setProviders: (providers) => set({ providers }),

  openWorkPlace: (tab) =>
    set((state) => ({
      workPlaceOpen: true,
      workTab: tab ?? state.workTab,
    })),

  closeWorkPlace: () => set({ workPlaceOpen: false }),

  setWorkTab: (tab) => set({ workTab: tab, workPlaceOpen: true }),

  openAgentConsole: () => set({ agentConsoleOpen: true }),
  closeAgentConsole: () => set({ agentConsoleOpen: false }),
  toggleAgentConsole: () => set((state) => ({ agentConsoleOpen: !state.agentConsoleOpen })),

  // The selection is always written, including back to undefined: a header
  // button that says "Command Center" must not reopen on the project someone
  // drilled into an hour ago.
  // The Agent Console shares the overlay layer and is mounted after this, so
  // it would paint over a center opened underneath it; the palette command
  // would look dead and Esc would close the overlay nobody can see.
  openCommandCenter: (projectPath) =>
    set({ commandCenterOpen: true, commandCenterProject: projectPath, agentConsoleOpen: false }),

  // Closing keeps the selection — nothing reads it while closed, and opening
  // decides it afresh anyway.
  closeCommandCenter: () => set({ commandCenterOpen: false }),

  selectCommandCenterProject: (projectPath) => set({ commandCenterProject: projectPath }),
});
