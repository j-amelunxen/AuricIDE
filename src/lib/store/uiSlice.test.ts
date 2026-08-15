import { describe, expect, it, beforeEach, vi } from 'vitest';

const setProjectConfigValue = vi.fn(async () => {});
const loadProjectConfig = vi.fn(async () => ({
  agenticCommit: true,
  agenticCommitPrompt: 'default prompt',
  branchTicketPattern: '([A-Z]+-\\d+)',
  commitProviderId: '',
  conductorProviderId: '',
}));

vi.mock('@/lib/config/projectConfig', () => ({
  setProjectConfigValue: (...args: unknown[]) => setProjectConfigValue(...(args as [])),
  loadProjectConfig: (...args: unknown[]) => loadProjectConfig(...(args as [])),
}));

import { createUISlice, MAX_TERMINAL_LOGS, type UISlice } from './uiSlice';
import { useStore } from '@/lib/store';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';

const DEFAULT_PROMPT =
  'commit and push on the current branch. Do not switch branches. Commit message prefix: {ticket}:';

function createTestStore() {
  let state: UISlice;
  const setState = (partial: Partial<UISlice> | ((s: UISlice) => Partial<UISlice>)) => {
    const updates = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...updates };
  };
  const getState = () => state;
  state = createUISlice(setState as never, getState as never, {} as never);
  return {
    get current() {
      return state;
    },
    ...state,
  };
}

describe('uiSlice – Work place', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('starts closed on the Goals tab', () => {
    expect(store.current.workPlaceOpen).toBe(false);
    expect(store.current.workTab).toBe('goals');
  });

  it('openWorkPlace opens the last tab when none is given', () => {
    store.current.openWorkPlace();
    expect(store.current.workPlaceOpen).toBe(true);
    expect(store.current.workTab).toBe('goals');
  });

  it('openWorkPlace remembers the requested tab', () => {
    store.current.openWorkPlace('tickets');
    expect(store.current.workPlaceOpen).toBe(true);
    expect(store.current.workTab).toBe('tickets');
    store.current.closeWorkPlace();
    expect(store.current.workPlaceOpen).toBe(false);
    expect(store.current.workTab).toBe('tickets');
  });

  it('setWorkTab opens the place on that view', () => {
    store.current.setWorkTab('lines');
    expect(store.current.workPlaceOpen).toBe(true);
    expect(store.current.workTab).toBe('lines');
  });
});

describe('uiSlice – agenticCommit settings', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults agenticCommit to true', () => {
    expect(store.current.agentSettings.agenticCommit).toBe(true);
  });

  it('tracks judgeLlmConfigured independently of llmConfigured', () => {
    expect(store.current.judgeLlmConfigured).toBe(false);
    store.current.setJudgeLlmConfigured(true);
    expect(store.current.judgeLlmConfigured).toBe(true);
    // The implementer LLM flag is untouched.
    expect(store.current.llmConfigured).toBe(false);
  });

  it('defaults agenticCommitPrompt to commit prompt with {ticket} placeholder', () => {
    expect(store.current.agentSettings.agenticCommitPrompt).toBe(DEFAULT_PROMPT);
  });

  it('defaults branchTicketPattern to JIRA-style regex', () => {
    expect(store.current.agentSettings.branchTicketPattern).toBe('([A-Z]+-\\d+)');
  });

  it('defaults findInFilesOpen to false and toggles via its setter', () => {
    expect(store.current.findInFilesOpen).toBe(false);
    store.current.setFindInFilesOpen(true);
    expect(store.current.findInFilesOpen).toBe(true);
    store.current.setFindInFilesOpen(false);
    expect(store.current.findInFilesOpen).toBe(false);
  });

  it('preserves other settings when updating agentic fields', () => {
    expect(store.current.agentSettings.autoAcceptEdits).toBe(false);
    expect(store.current.agentSettings.dangerouslyIgnorePermissions).toBe(false);
    expect(store.current.agentSettings.agenticCommit).toBe(true);
  });
});

describe('uiSlice – updateAgentSettings integration', () => {
  beforeEach(() => {
    // Reset to defaults
    useStore.getState().updateAgentSettings({
      agenticCommit: true,
      agenticCommitPrompt: DEFAULT_PROMPT,
      autoAcceptEdits: false,
      dangerouslyIgnorePermissions: false,
      branchTicketPattern: '([A-Z]+-\\d+)',
    });
  });

  it('merges partial updates correctly', () => {
    const initial = useStore.getState().agentSettings;

    expect(initial.agenticCommit).toBe(true);
    expect(initial.agenticCommitPrompt).toBe(DEFAULT_PROMPT);

    useStore.getState().updateAgentSettings({ agenticCommit: false });
    const after = useStore.getState().agentSettings;

    expect(after.agenticCommit).toBe(false);
    expect(after.agenticCommitPrompt).toBe(DEFAULT_PROMPT);
    expect(after.autoAcceptEdits).toBe(initial.autoAcceptEdits);
  });

  it('updates prompt while preserving toggle', () => {
    useStore.getState().updateAgentSettings({ agenticCommit: false });
    useStore.getState().updateAgentSettings({ agenticCommitPrompt: 'just commit' });

    const settings = useStore.getState().agentSettings;
    expect(settings.agenticCommitPrompt).toBe('just commit');
    expect(settings.agenticCommit).toBe(false);
  });

  it('updates branchTicketPattern independently', () => {
    useStore.getState().updateAgentSettings({ branchTicketPattern: '(\\d+)' });

    const settings = useStore.getState().agentSettings;
    expect(settings.branchTicketPattern).toBe('(\\d+)');
    expect(settings.agenticCommit).toBe(true);
  });
});

describe('uiSlice – enableDeepNlp', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults enableDeepNlp to false', () => {
    expect(store.current.enableDeepNlp).toBe(false);
  });

  it('can enable deep NLP', () => {
    store.setEnableDeepNlp(true);
    expect(store.current.enableDeepNlp).toBe(true);
  });

  it('can disable deep NLP after enabling', () => {
    store.setEnableDeepNlp(true);
    store.setEnableDeepNlp(false);
    expect(store.current.enableDeepNlp).toBe(false);
  });
});

describe('uiSlice – references panel', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults referencesPanelOpen to false', () => {
    expect(store.current.referencesPanelOpen).toBe(false);
  });

  it('defaults referencesPanelQuery to empty string', () => {
    expect(store.current.referencesPanelQuery).toBe('');
  });

  it('defaults referencesPanelResults to empty array', () => {
    expect(store.current.referencesPanelResults).toEqual([]);
  });
});

describe('uiSlice – setReferencesPanel integration', () => {
  beforeEach(() => {
    useStore.getState().setReferencesPanel(false);
  });

  it('opens the references panel with query and results', () => {
    const mockResults: ReferenceResult[] = [
      {
        type: 'entity',
        filePath: '/project/doc.md',
        lineNumber: 1,
        lineText: 'DataPipeline here',
        charFrom: 0,
        charTo: 12,
      },
    ];

    useStore.getState().setReferencesPanel(true, 'DataPipeline', mockResults);

    const state = useStore.getState();
    expect(state.referencesPanelOpen).toBe(true);
    expect(state.referencesPanelQuery).toBe('DataPipeline');
    expect(state.referencesPanelResults).toEqual(mockResults);
  });

  it('closes the panel and clears query and results', () => {
    useStore.getState().setReferencesPanel(true, 'Test', []);
    expect(useStore.getState().referencesPanelOpen).toBe(true);

    useStore.getState().setReferencesPanel(false);
    const state = useStore.getState();
    expect(state.referencesPanelOpen).toBe(false);
    expect(state.referencesPanelQuery).toBe('');
    expect(state.referencesPanelResults).toEqual([]);
  });

  it('preserves other UI state when toggling references panel', () => {
    useStore.getState().setCursorPos(5, 10);
    useStore.getState().setReferencesPanel(true, 'Entity', []);

    expect(useStore.getState().cursorPos).toEqual({ line: 5, col: 10 });
    expect(useStore.getState().referencesPanelOpen).toBe(true);
  });
});

describe('uiSlice – importSpecDialogOpen', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults importSpecDialogOpen to false', () => {
    expect(store.current.importSpecDialogOpen).toBe(false);
  });

  it('can open dialog', () => {
    store.setImportSpecDialogOpen(true);
    expect(store.current.importSpecDialogOpen).toBe(true);
  });

  it('can close dialog after opening', () => {
    store.setImportSpecDialogOpen(true);
    store.setImportSpecDialogOpen(false);
    expect(store.current.importSpecDialogOpen).toBe(false);
  });
});

describe('uiSlice – videoImportDialogOpen', () => {
  it('opens and closes the video import independently', () => {
    const store = createTestStore();
    expect(store.current.videoImportDialogOpen).toBe(false);
    store.setVideoImportDialogOpen(true);
    expect(store.current.videoImportDialogOpen).toBe(true);
    expect(store.current.importSpecDialogOpen).toBe(false);
    store.setVideoImportDialogOpen(false);
    expect(store.current.videoImportDialogOpen).toBe(false);
  });
});

describe('uiSlice – agentConsoleOpen', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults agentConsoleOpen to false', () => {
    expect(store.current.agentConsoleOpen).toBe(false);
  });

  it('openAgentConsole opens it', () => {
    store.current.openAgentConsole();
    expect(store.current.agentConsoleOpen).toBe(true);
  });

  it('closeAgentConsole closes it', () => {
    store.current.openAgentConsole();
    store.current.closeAgentConsole();
    expect(store.current.agentConsoleOpen).toBe(false);
  });

  it('toggleAgentConsole flips the current state', () => {
    store.current.toggleAgentConsole();
    expect(store.current.agentConsoleOpen).toBe(true);
    store.current.toggleAgentConsole();
    expect(store.current.agentConsoleOpen).toBe(false);
  });
});

describe('uiSlice – spawnAgentRepoPath', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults spawnAgentRepoPath to null', () => {
    expect(store.current.spawnAgentRepoPath).toBeNull();
  });

  it('can set spawnAgentRepoPath', () => {
    store.setSpawnAgentRepoPath('/a/website');
    expect(store.current.spawnAgentRepoPath).toBe('/a/website');
  });

  it('can clear spawnAgentRepoPath back to null', () => {
    store.setSpawnAgentRepoPath('/a/website');
    store.setSpawnAgentRepoPath(null);
    expect(store.current.spawnAgentRepoPath).toBeNull();
  });
});

describe('uiSlice – terminalLogs buffer cap', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('caps terminalLogs at MAX_TERMINAL_LOGS', () => {
    const total = MAX_TERMINAL_LOGS + 100;
    for (let i = 0; i < total; i++) {
      store.addTerminalLog({ tab: 'terminal', text: `log-${i}`, timestamp: i });
    }
    expect(store.current.terminalLogs).toHaveLength(MAX_TERMINAL_LOGS);
    // The oldest 100 entries should be dropped
    expect(store.current.terminalLogs[0].text).toBe(`log-100`);
    expect(store.current.terminalLogs[MAX_TERMINAL_LOGS - 1].text).toBe(`log-${total - 1}`);
  });

  it('preserves logs when under the limit', () => {
    store.addTerminalLog({ tab: 'terminal', text: 'first', timestamp: 1 });
    store.addTerminalLog({ tab: 'terminal', text: 'second', timestamp: 2 });
    store.addTerminalLog({ tab: 'terminal', text: 'third', timestamp: 3 });

    expect(store.current.terminalLogs).toHaveLength(3);
    expect(store.current.terminalLogs[0].text).toBe('first');
    expect(store.current.terminalLogs[2].text).toBe('third');
  });
});

describe('uiSlice – agent settings that belong to the project', () => {
  beforeEach(() => {
    setProjectConfigValue.mockClear();
    loadProjectConfig.mockClear();
    useStore.setState({ rootPath: '/tmp/project' });
  });

  it('persists a commit setting to the project it was made in', async () => {
    // These were session-only before: a ticket pattern retyped on every launch,
    // and never per project even though that is what it describes.
    useStore.getState().updateAgentSettings({ branchTicketPattern: 'FOO-\\d+' });

    expect(useStore.getState().agentSettings.branchTicketPattern).toBe('FOO-\\d+');
    await vi.waitFor(() =>
      expect(setProjectConfigValue).toHaveBeenCalledWith(
        '/tmp/project',
        'branchTicketPattern',
        'FOO-\\d+'
      )
    );
  });

  it('does not persist the safety switches', async () => {
    // Bypass-permissions restored days later is a switch nobody remembers
    // leaving on. It stays session state, deliberately.
    useStore.getState().updateAgentSettings({ dangerouslyIgnorePermissions: true });

    expect(useStore.getState().agentSettings.dangerouslyIgnorePermissions).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setProjectConfigValue).not.toHaveBeenCalled();
  });

  it('keeps working without a project open', async () => {
    useStore.setState({ rootPath: null });

    useStore.getState().updateAgentSettings({ agenticCommit: false });

    expect(useStore.getState().agentSettings.agenticCommit).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setProjectConfigValue).not.toHaveBeenCalled();
  });

  it('loads a project’s settings when it is opened', async () => {
    loadProjectConfig.mockResolvedValueOnce({
      agenticCommit: false,
      agenticCommitPrompt: 'project prompt',
      branchTicketPattern: 'BAR-\\d+',
      commitProviderId: 'opencode',
      conductorProviderId: '',
    });

    await useStore.getState().loadProjectAgentSettings('/tmp/other');

    expect(useStore.getState().agentSettings).toMatchObject({
      agenticCommit: false,
      agenticCommitPrompt: 'project prompt',
      branchTicketPattern: 'BAR-\\d+',
      commitProviderId: 'opencode',
    });
  });

  it('leaves the safety switches off when a project is opened', async () => {
    useStore.setState({
      agentSettings: {
        ...useStore.getState().agentSettings,
        dangerouslyIgnorePermissions: true,
        autoAcceptEdits: true,
      },
    });

    await useStore.getState().loadProjectAgentSettings('/tmp/other');

    // Switching projects is not a reason to carry elevated permissions along.
    expect(useStore.getState().agentSettings.dangerouslyIgnorePermissions).toBe(false);
    expect(useStore.getState().agentSettings.autoAcceptEdits).toBe(false);
  });
});

describe('uiSlice – the conductor provider', () => {
  beforeEach(() => {
    loadProjectConfig.mockClear();
    useStore.setState({ rootPath: '/tmp/project' });
  });

  it('restores the provider a project last ran its backlog with', async () => {
    loadProjectConfig.mockResolvedValueOnce({
      agenticCommit: true,
      agenticCommitPrompt: 'p',
      branchTicketPattern: 'x',
      commitProviderId: '',
      conductorProviderId: 'opencode',
    });

    await useStore.getState().loadProjectAgentSettings('/tmp/project');

    expect(useStore.getState().conductorProviderId).toBe('opencode');
  });

  it('leaves the conductor on the launch default when the project named none', async () => {
    // An empty string is "no preference", not a provider called "".
    await useStore.getState().loadProjectAgentSettings('/tmp/project');

    expect(useStore.getState().conductorProviderId).toBeNull();
  });
});
