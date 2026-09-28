import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Home from './page';
import { useStore } from '@/lib/store';
import { useFileWatcher } from '@/lib/hooks/useFileWatcher';
import type { AgentInfo } from '@/lib/tauri/agents';

// Render counters for the memoized panels. Each wrapper calls the real
// component as a function, so behaviour is unchanged — it only notes that the
// panel rendered, which with `memo` means its props actually changed.
const renders = vi.hoisted(() => {
  const counts = new Map<string, number>();
  return {
    counts,
    counted<P>(name: string, component: (props: P) => React.ReactNode) {
      return function Counted(props: P) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        return component(props);
      };
    },
  };
});

// Counts renders of the page component itself: `useIDEState` runs once per
// Home render and nowhere else.
vi.mock('@/lib/hooks/useIDEState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useIDEState')>();
  return {
    ...actual,
    useIDEState: () => {
      renders.counts.set('Home', (renders.counts.get('Home') ?? 0) + 1);
      return actual.useIDEState();
    },
  };
});
// The scheduled-run watcher is mounted by the page; this captures the project
// opener it is handed, so a test can prove it is the real one.
const scheduledRuns = vi.hoisted(() => ({
  openProject: null as ((path: string) => Promise<void>) | null,
}));
vi.mock('@/lib/hooks/useScheduledConductorRuns', () => ({
  useScheduledConductorRuns: (openProject: (path: string) => Promise<void>) => {
    scheduledRuns.openProject = openProject;
  },
}));
vi.mock('./components/ide/Header', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/ide/Header')>();
  return { ...actual, Header: renders.counted('Header', actual.Header) };
});
vi.mock('./components/ide/ActivityBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/ide/ActivityBar')>();
  return { ...actual, ActivityBar: renders.counted('ActivityBar', actual.ActivityBar) };
});
vi.mock('./components/ide/StatusBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/ide/StatusBar')>();
  return { ...actual, StatusBar: renders.counted('StatusBar', actual.StatusBar) };
});
vi.mock('./components/editor/TabBar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/editor/TabBar')>();
  return { ...actual, TabBar: renders.counted('TabBar', actual.TabBar) };
});
vi.mock('./components/terminal/TerminalPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/terminal/TerminalPanel')>();
  return { ...actual, TerminalPanel: renders.counted('TerminalPanel', actual.TerminalPanel) };
});
vi.mock('./components/agents/AgentsPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/agents/AgentsPanel')>();
  return { ...actual, AgentsPanel: renders.counted('AgentsPanel', actual.AgentsPanel) };
});
vi.mock('./components/explorer/FileExplorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/explorer/FileExplorer')>();
  return { ...actual, FileExplorer: renders.counted('FileExplorer', actual.FileExplorer) };
});

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
  // Commands that return a list must return one, as the Rust side does.
  invoke: vi.fn(async (cmd: string) => (cmd === 'inbox_list' ? [] : null)),
  convertFileSrc: (path: string) => `asset://localhost${path}`,
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

vi.mock('@/lib/tauri/recentProjects', () => ({
  listRecentProjects: vi.fn().mockResolvedValue([]),
  importRecentProjects: vi.fn().mockResolvedValue([]),
  addRecentProject: vi.fn().mockResolvedValue([]),
  removeRecentProject: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/tauri/starredProjects', () => ({
  listStarredProjects: vi.fn().mockResolvedValue([]),
  importStarredProjects: vi.fn().mockResolvedValue([]),
  addStarredProject: vi.fn().mockResolvedValue([]),
  removeStarredProject: vi.fn().mockResolvedValue([]),
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
  // blameGutterExtension subclasses GutterMarker at module load, so this mock
  // has to provide it or importing the editor throws before any test runs.
  gutter: () => [],
  GutterMarker: class {},
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
  Annotation: {
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

vi.mock('@/lib/editor/gitGutterExtension', () => ({
  createGitGutter: () => [],
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
  useBatchedAgentEvents: vi.fn(),
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
    useStore.setState({ rootPath: null, pmDraftTickets: [] });
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
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
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
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
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
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    const removeBtn = screen.getByTestId('remove-recent-/Users/jen/my-app');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('my-app')).not.toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
  });

  it('hides project-only rail items when no project is open', () => {
    render(<Home />);
    expect(screen.queryByTestId('activity-item-explorer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-item-work')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-item-source-control')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-item-cockpit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-item-outline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-item-qa')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Explorer' })).not.toBeInTheDocument();
    expect(screen.getByTestId('activity-item-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-notifications')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-settings')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-scratches')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-extensions')).toBeInTheDocument();
  });

  it('reserves no empty sidebar column while no project is open', () => {
    render(<Home />);
    expect(screen.getByTestId('left-panel-container').style.width).toBe('0px');
  });

  it('folds the sidebar when its active rail icon is clicked again, and unfolds it on the next', async () => {
    render(<Home />);
    const inbox = screen.getByTestId('activity-item-inbox');
    const panel = () => screen.getByTestId('left-panel-container');

    fireEvent.click(inbox);
    await waitFor(() => expect(panel().style.width).toBe(''));

    fireEvent.click(inbox);
    await waitFor(() => expect(panel().style.width).toBe('0px'));

    fireEvent.click(inbox);
    await waitFor(() => expect(panel().style.width).toBe(''));
  });

  it('returns to the start screen from Mission Control', () => {
    useStore.setState({ rootPath: '/test/project', activeTabId: null, openTabs: [] });
    render(<Home />);
    expect(screen.getByTestId('mission-control')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mc-leave-project'));
    expect(screen.queryByTestId('mission-control')).not.toBeInTheDocument();
    expect(screen.getByText('Open Project Folder')).toBeInTheDocument();
    expect(useStore.getState().rootPath).toBeNull();
  });

  it('shows the project rail again once a project is open', () => {
    useStore.setState({ rootPath: '/test/project' });
    render(<Home />);
    expect(screen.getByTestId('activity-item-explorer')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-work')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-source-control')).toBeInTheDocument();
    expect(screen.getByTestId('activity-item-cockpit')).toBeInTheDocument();
  });

  it('displays a badge for open tickets in the activity bar', () => {
    useStore.setState({
      rootPath: '/test/project',
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
    expect(screen.getByTestId('badge-work')).toHaveTextContent('2');
  });

  it('shows the inbox capture bar on the start screen', () => {
    render(<Home />);
    expect(screen.getByPlaceholderText(/capture a task/i)).toBeInTheDocument();
  });

  it('lets the start screen shrink when the right panel takes width', () => {
    render(<Home />);
    expect(screen.getByTestId('center-pane')).toHaveClass('min-w-0');
    expect(screen.getByTestId('start-project-switcher')).toHaveClass('w-full', 'min-w-0');
    expect(screen.getByTestId('start-buttons-row')).toHaveClass('flex-wrap');
  });

  it('gives the post-hero blocks one consistent vertical rhythm', () => {
    render(<Home />);
    const marginStep = (testId: string) => {
      const el = screen.getByTestId(testId);
      return [...el.classList].find((c) => c.startsWith('mt-'));
    };
    const steps = [
      'start-buttons-row',
      'start-inbox-capture',
      'start-project-switcher',
      'start-inbox-panel',
    ].map(marginStep);

    expect(steps.every((s) => s !== undefined)).toBe(true);
    expect(new Set(steps).size).toBe(1);
  });

  it('opens the inbox panel when the Inbox rail item is clicked, with no project open', () => {
    render(<Home />);
    fireEvent.click(screen.getByTestId('activity-item-inbox'));
    expect(screen.getByTestId('inbox-panel')).toBeInTheDocument();
  });

  it('opens Work in the center when the Work rail item is clicked', () => {
    useStore.setState({ rootPath: '/test/project' });
    render(<Home />);
    fireEvent.click(screen.getByTestId('activity-item-work'));
    expect(useStore.getState().workPlaceOpen).toBe(true);
    expect(screen.getByTestId('work-view')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /goals/i })).not.toBeInTheDocument();
  });
});

describe('Home page — the scheduled-run watcher', () => {
  // An automatic conductor run for another project needs a real project
  // opener; handed anything else, the switch is the one thing that cannot
  // work, and the hook's own tests (which mock the opener) would not notice.
  it('is mounted with an opener that really opens the project', async () => {
    scheduledRuns.openProject = null;
    useStore.setState({ rootPath: null });
    render(<Home />);
    expect(scheduledRuns.openProject).toBeTypeOf('function');

    await act(async () => {
      await scheduledRuns.openProject!('/test/other-project');
    });

    expect(useStore.getState().rootPath).toBe('/test/other-project');
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

describe('Home page — store writes re-render only what displays them', () => {
  const PANELS = [
    'Header',
    'ActivityBar',
    'StatusBar',
    'TabBar',
    'TerminalPanel',
    'AgentsPanel',
    'FileExplorer',
  ] as const;

  const agent = (id: string, activity: string): AgentInfo => ({
    id,
    name: id,
    status: 'running',
    model: 'm',
    provider: 'p',
    currentActivity: activity,
    startedAt: 0,
  });

  const tree = [
    { name: 'src', path: '/test/project/src', isDirectory: true, expanded: false, children: [] },
    { name: 'a.md', path: '/test/project/a.md', isDirectory: false },
  ];

  /** Mount an open project and let the mount-time effects settle, then zero the counters. */
  async function mountProject() {
    useStore.setState({
      rootPath: '/test/project',
      fileTree: tree,
      agents: [agent('a1', 'reading')],
      activeTabId: null,
      openTabs: [],
    });
    render(<Home />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    for (const name of PANELS) {
      expect(renders.counts.get(name) ?? 0, `${name} never mounted`).toBeGreaterThan(0);
    }
    renders.counts.clear();
  }

  const rendered = () => PANELS.filter((name) => (renders.counts.get(name) ?? 0) > 0);

  beforeEach(() => {
    vi.clearAllMocks();
    renders.counts.clear();
  });

  it('an agent update re-renders the agent panels and nothing else', async () => {
    await mountProject();

    act(() => useStore.setState({ agents: [agent('a1', 'writing')] }));

    expect(rendered()).toEqual(['TerminalPanel', 'AgentsPanel']);
  });

  it('a file-tree update re-renders the explorer and nothing else', async () => {
    await mountProject();

    act(() =>
      useStore.setState({
        fileTree: [...tree, { name: 'b.md', path: '/test/project/b.md', isDirectory: false }],
      })
    );

    expect(rendered()).toEqual(['FileExplorer']);
  });

  it('a page re-render for something no panel shows leaves every memoized panel alone', async () => {
    await mountProject();

    // Home itself selects this, so the page re-renders — the panels' props,
    // callbacks included, must come out identical.
    act(() => useStore.setState({ fileSearchOpen: true }));

    expect(rendered()).toEqual([]);
    act(() => useStore.setState({ fileSearchOpen: false }));
  });

  // The page root re-renders everything below that is not memoized. Agents
  // replace their array every couple of seconds while they stream, so the
  // root must not subscribe to it — not even through a watcher hook.
  it('an agent update does not re-render the page itself', async () => {
    await mountProject();

    act(() => useStore.setState({ agents: [agent('a1', 'writing')] }));

    expect(renders.counts.get('Home') ?? 0).toBe(0);
  });

  it('a notification or inbox write does not re-render the page itself', async () => {
    await mountProject();

    act(() => useStore.setState({ notifications: [] }));
    act(() => useStore.setState({ inboxItems: [] }));

    expect(renders.counts.get('Home') ?? 0).toBe(0);
  });

  it('a cursor move re-renders only the status bar', async () => {
    await mountProject();

    act(() => useStore.setState({ cursorPos: { line: 7, col: 3 } }));

    expect(rendered()).toEqual(['StatusBar']);
  });
});
