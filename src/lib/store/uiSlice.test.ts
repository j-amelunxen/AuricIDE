import { describe, expect, it, beforeEach } from 'vitest';
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

describe('uiSlice – agenticCommit settings', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it('defaults agenticCommit to true', () => {
    expect(store.current.agentSettings.agenticCommit).toBe(true);
  });

  it('defaults agenticCommitPrompt to commit prompt with {ticket} placeholder', () => {
    expect(store.current.agentSettings.agenticCommitPrompt).toBe(DEFAULT_PROMPT);
  });

  it('defaults branchTicketPattern to JIRA-style regex', () => {
    expect(store.current.agentSettings.branchTicketPattern).toBe('([A-Z]+-\\d+)');
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
