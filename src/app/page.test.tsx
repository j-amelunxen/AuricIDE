import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';
import { useStore } from '@/lib/store';
import { useFileWatcher } from '@/lib/hooks/useFileWatcher';

// jsdom stubs needed by xterm.js and IntersectionObserver
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/tauri/db', () => ({
  initProjectDb: vi.fn().mockResolvedValue(undefined),
  dbGet: vi.fn().mockResolvedValue(null),
  dbSet: vi.fn().mockResolvedValue(undefined),
  dbDelete: vi.fn().mockResolvedValue(false),
  dbList: vi.fn().mockResolvedValue([]),
  closeProjectDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tauri/agents', () => ({
  checkCliStatus: vi.fn().mockResolvedValue(true),
  spawnAgent: vi.fn().mockResolvedValue({
    id: 'agent-1',
    name: 'test',
    model: 'test',
    provider: 'test',
    status: 'running',
    startedAt: 0,
  }),
  killAgent: vi.fn().mockResolvedValue(undefined),
  killAgentsForRepo: vi.fn().mockResolvedValue(0),
  listAgents: vi.fn().mockResolvedValue([]),
  sendToAgent: vi.fn().mockResolvedValue(undefined),
}));

const mockReadDirectory = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  openFolderDialog: vi.fn().mockResolvedValue(null),
  readFileBase64: vi.fn().mockResolvedValue(''),
  listAllFiles: vi.fn().mockResolvedValue([]),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tauri/git', () => ({
  getGitStatus: vi.fn().mockResolvedValue([]),
  getBranchInfo: vi.fn().mockResolvedValue({ name: 'main', ahead: 0, behind: 0 }),
  getGitDiff: vi.fn().mockResolvedValue(''),
  stageFiles: vi.fn().mockResolvedValue(undefined),
  unstageFiles: vi.fn().mockResolvedValue(undefined),
  commitChanges: vi.fn().mockResolvedValue('abc123'),
}));

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: vi.fn().mockRejectedValue(new Error('browser mode')),
    getPromptTemplate: vi.fn().mockRejectedValue(new Error('browser mode')),
  };
});

vi.mock('@/lib/editor/auricTheme', () => ({
  auricTheme: [],
  auricHighlightStyle: [],
}));

vi.mock('@/lib/editor/nlpHighlightExtension', () => ({
  nlpHighlightExtension: [],
}));

vi.mock('@/lib/nlp/deepHighlightExtension', () => ({
  deepHighlightExtension: [],
}));

vi.mock('@/lib/editor/mermaidWidgetExtension', () => ({
  mermaidWidgetExtension: [],
}));

vi.mock('@codemirror/view', () => ({
  EditorView: class MockEditorView {
    static updateListener = { of: () => [] };
    static lineWrapping = [];
    static scrollIntoView = () => ({});
    dom: HTMLDivElement;
    state = { doc: { toString: () => '', length: 0 } };
    constructor(config: { parent?: HTMLElement }) {
      this.dom = document.createElement('div');
      config.parent?.appendChild(this.dom);
    }
    destroy() {}
    dispatch() {}
  },
  Decoration: {
    mark: () => ({ range: () => ({}) }),
    set: () => ({}),
    widget: () => ({ range: () => ({}) }),
    none: {},
  },
  WidgetType: class {},
  ViewPlugin: { fromClass: () => ({}) },
  lineNumbers: () => [],
  keymap: { of: () => [] },
  hoverTooltip: () => [],
}));

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: (config: { doc?: string }) => ({ doc: config.doc ?? '' }),
  },
  Compartment: class {
    of() {
      return [];
    }
    reconfigure() {
      return [];
    }
  },
  Facet: {
    define: () => ({ of: () => [] }),
  },
}));

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => [],
  markdownLanguage: {},
}));
vi.mock('@codemirror/language-data', () => ({ languages: [] }));
vi.mock('@codemirror/lang-javascript', () => ({ javascript: () => [] }));
vi.mock('@codemirror/lang-rust', () => ({ rust: () => [] }));
vi.mock('@codemirror/lang-html', () => ({ html: () => [] }));
vi.mock('@codemirror/lang-css', () => ({ css: () => [] }));
vi.mock('@codemirror/lang-json', () => ({ json: () => [], jsonParseLinter: () => () => [] }));
vi.mock('@codemirror/lang-python', () => ({ python: () => [] }));
vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: () => [],
  historyKeymap: [],
}));
vi.mock('@codemirror/search', () => ({
  search: () => [],
  searchKeymap: [],
  highlightSelectionMatches: () => [],
}));

vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => [],
  completionKeymap: [],
}));

vi.mock('@codemirror/lint', () => ({
  linter: () => [],
  lintGutter: () => [],
  lintKeymap: [],
}));

vi.mock('@/lib/editor/markdownLintExtension', () => ({
  markdownLintExtension: [],
  lintConfigFacet: { of: () => [] },
  fileListForLintFacet: { of: () => [] },
  headingIndexForLintFacet: { of: () => [] },
  currentFilePathFacet: { of: () => [] },
}));

vi.mock('@/app/components/dev/PerformanceMonitor', () => ({
  PerformanceMonitor: () => null,
}));

vi.mock('@/lib/store/devSubscriptionMonitor', () => ({
  createDevSubscriptionMonitor: () => ({ record: () => {}, destroy: () => {} }),
}));

vi.mock('@/lib/editor/wikiLinkExtension', () => ({
  wikiLinkExtension: [],
}));

vi.mock('@/lib/editor/wikiLinkBrokenExtension', () => ({
  brokenLinksSetFacet: { of: () => [] },
  wikiLinkBrokenExtension: [],
}));

vi.mock('@/lib/editor/wikiLinkCompletionExtension', () => ({
  wikiLinkCompletion: () => null,
  fileListFacet: { of: () => [] },
}));

vi.mock('@/lib/editor/wikiLinkHoverExtension', () => ({
  wikiLinkHoverExtension: [],
  previewFetcherFacet: { of: () => [] },
  navigateCallbackFacet: { of: () => [] },
}));

vi.mock('@/lib/editor/markdownFoldExtension', () => ({
  markdownFoldExtension: [],
}));

vi.mock('@/lib/editor/slashCommandSource', () => ({
  slashCommandSource: () => null,
}));

vi.mock('@/lib/editor/markdownCompletionSource', () => ({
  codeFenceLanguageSource: () => null,
  headingLevelSource: () => null,
  linkTargetSource: () => null,
  imageTargetSource: () => null,
  filePathsFacet: { of: () => [] },
}));

vi.mock('@/lib/hooks/useFileWatcher', () => ({
  useFileWatcher: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@/lib/tauri/terminal', () => ({
  spawnShell: vi.fn().mockResolvedValue(undefined),
  onTerminalOut: vi.fn().mockResolvedValue(vi.fn()),
  onTerminalErr: vi.fn().mockResolvedValue(vi.fn()),
  writeToShell: vi.fn().mockResolvedValue(undefined),
  resizeShell: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tauri/watcher', () => ({
  watchDirectory: vi.fn(),
  unwatchDirectory: vi.fn(),
  onFsChange: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@/lib/tauri/database', () => ({
  ipcInitProjectDb: vi.fn().mockResolvedValue(undefined),
  ipcDbGet: vi.fn().mockResolvedValue(null),
  ipcDbSet: vi.fn().mockResolvedValue(undefined),
  ipcDbDelete: vi.fn().mockResolvedValue(false),
  ipcDbList: vi.fn().mockResolvedValue([]),
  ipcCloseProjectDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/tauri/pm', () => ({
  pmSave: vi.fn().mockResolvedValue(undefined),
  pmLoad: vi.fn().mockResolvedValue({ epics: [], tickets: [], testCases: [] }),
}));

vi.mock('@/lib/hooks/useAgentEvents', () => ({
  useAgentEvents: vi.fn(),
}));

vi.mock('@/lib/canvas/markdownParser', () => ({
  parseWorkflowMarkdown: vi.fn(() => ({ nodes: [], edges: [] })),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown>) => <div data-testid="react-flow" {...props} />,
  Background: () => <div />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => <div />,
  Handle: () => <div />,
  Position: { Top: 'top', Bottom: 'bottom' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./components/terminal/XtermTerminal', () => ({
  XtermTerminal: ({ id }: { id: string }) => <div data-testid={`xterm-${id}`} />,
}));

describe('Home page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the IDE shell', () => {
    render(<Home />);
    expect(screen.getByTestId('ide-shell')).toBeInTheDocument();
  });

  it('renders the header with logo', () => {
    render(<Home />);
    expect(screen.getByTestId('header-logo')).toHaveTextContent('AURICIDE');
  });

  it('renders the activity bar', () => {
    render(<Home />);
    expect(screen.getByTestId('activity-bar')).toBeInTheDocument();
  });

  it('renders the status bar', () => {
    render(<Home />);
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  it('shows the welcome message when no file is open', () => {
    render(<Home />);
    expect(screen.getByText('AI-native Development')).toBeInTheDocument();
    expect(screen.getByText('Open Project Folder')).toBeInTheDocument();
  });

  it('shows the tip of the day on the landing page', () => {
    render(<Home />);
    expect(screen.getByTestId('tip-of-the-day')).toBeInTheDocument();
    expect(screen.getByText('Tip of the Day')).toBeInTheDocument();
  });

  it('does not show recent projects when list is empty', () => {
    useStore.setState({ recentProjects: [] });
    render(<Home />);
    expect(screen.queryByTestId('recent-projects')).not.toBeInTheDocument();
  });

  it('renders recent projects on the landing screen without paths', () => {
    useStore.setState({
      recentProjects: [
        { path: '/Users/jen/my-app', name: 'my-app', openedAt: 1000 },
        { path: '/Users/jen/other', name: 'other', openedAt: 900 },
      ],
    });
    render(<Home />);
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
    // Paths should NOT be displayed
    expect(screen.queryByText('/Users/jen/my-app')).not.toBeInTheDocument();
    expect(screen.queryByText('/Users/jen/other')).not.toBeInTheDocument();
  });

  it('shows a remove button for each recent project', () => {
    useStore.setState({
      recentProjects: [{ path: '/Users/jen/my-app', name: 'my-app', openedAt: 1000 }],
    });
    render(<Home />);
    const removeBtn = screen.getByTestId('remove-recent-/Users/jen/my-app');
    expect(removeBtn).toBeInTheDocument();
  });

  it('removes a recent project when clicking the x button', () => {
    useStore.setState({
      recentProjects: [
        { path: '/Users/jen/my-app', name: 'my-app', openedAt: 1000 },
        { path: '/Users/jen/other', name: 'other', openedAt: 900 },
      ],
    });
    render(<Home />);
    const removeBtn = screen.getByTestId('remove-recent-/Users/jen/my-app');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('my-app')).not.toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
  });

  it('displays a badge for open tickets in the activity bar', () => {
    useStore.setState({
      pmDraftTickets: [
        {
          id: '1',
          status: 'open' as const,
          name: 'T1',
          epicId: 'e1',
          description: '',
          sortOrder: 0,
          statusUpdatedAt: '',
          priority: 'normal' as const,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '2',
          status: 'in_progress' as const,
          name: 'T2',
          epicId: 'e1',
          description: '',
          sortOrder: 1,
          statusUpdatedAt: '',
          priority: 'normal' as const,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '3',
          status: 'done' as const,
          name: 'T3',
          epicId: 'e1',
          description: '',
          sortOrder: 2,
          statusUpdatedAt: '',
          priority: 'normal' as const,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    render(<Home />);
    // Should count 'open' and 'in_progress' = 2
    expect(screen.getByTestId('badge-project-mgmt')).toHaveTextContent('2');
  });
});

describe('FileWatcher debouncing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not trigger handleRefresh immediately on file watcher event', async () => {
    useStore.setState({ rootPath: '/test/project' });
    render(<Home />);

    // Let all initial mount effects settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const mockWatcher = vi.mocked(useFileWatcher);
    expect(mockWatcher).toHaveBeenCalled();
    const onChange = mockWatcher.mock.calls[mockWatcher.mock.calls.length - 1][1];
    mockReadDirectory.mockClear();

    // Trigger a file event
    onChange({ path: '/test/project/file.ts', kind: 'modify' });

    // Flush microtasks — without debouncing, handleRefresh would have executed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // With 300ms debouncing, handleRefresh hasn't fired yet (50ms < 300ms)
    expect(mockReadDirectory).not.toHaveBeenCalled();
  });

  it('calls handleRefresh once after 300ms debounce period', async () => {
    useStore.setState({ rootPath: '/test/project' });
    render(<Home />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const mockWatcher = vi.mocked(useFileWatcher);
    const onChange = mockWatcher.mock.calls[mockWatcher.mock.calls.length - 1][1];
    mockReadDirectory.mockClear();

    onChange({ path: '/test/project/file.ts', kind: 'modify' });

    // Wait past the debounce period
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // handleRefresh should have fired (calls readDirectory)
    expect(mockReadDirectory).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid file events into a single refresh', async () => {
    useStore.setState({ rootPath: '/test/project' });
    render(<Home />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const mockWatcher = vi.mocked(useFileWatcher);
    const onChange = mockWatcher.mock.calls[mockWatcher.mock.calls.length - 1][1];
    mockReadDirectory.mockClear();

    // Fire 20 events rapidly (simulating agent modifying many files)
    for (let i = 0; i < 20; i++) {
      onChange({ path: `/test/project/file${i}.ts`, kind: 'modify' });
    }

    // Wait past debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    // One refresh, not 20 — readDirectory called exactly once
    expect(mockReadDirectory).toHaveBeenCalledTimes(1);
  });
});
