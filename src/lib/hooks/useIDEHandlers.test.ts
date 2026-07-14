import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIDEHandlers } from './useIDEHandlers';

// Mock Tauri FS
const mockReadDirectory = vi.fn();
const mockOpenFolderDialog = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockCreateDirectory = vi.fn();
const mockListAllFiles = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  openFolderDialog: () => mockOpenFolderDialog(),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
  listAllFiles: (...args: unknown[]) => mockListAllFiles(...args),
}));

const mockRevealInFileManager = vi.fn();
vi.mock('@/lib/tauri/opener', () => ({
  revealInFileManager: (...args: unknown[]) => mockRevealInFileManager(...args),
}));

// Mock Store
const mockRefreshGitStatus = vi.fn();
const mockSaveGoals = vi.fn();
let mockFileTree: unknown[] = [];
let mockActiveTabId: string | null = null;
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      refreshGitStatus: mockRefreshGitStatus,
      fileStatuses: [],
      activeTabId: mockActiveTabId,
      fileTree: mockFileTree,
      saveGoals: mockSaveGoals,
    }),
  },
}));

describe('useIDEHandlers', () => {
  const mockState = {
    rootPath: null as string | null,
    setRootPath: vi.fn(),
    addRecentProject: vi.fn(),
    initProjectDb: vi.fn(),
    setFileTree: vi.fn(),
    setDirectoryChildren: vi.fn(),
    closeAllTabs: vi.fn(),
    clearLinkIndex: vi.fn(),
    clearHeadingIndex: vi.fn(),
    clearEntityIndex: vi.fn(),
    resetPmInMemory: vi.fn(),
    resetBlueprintsInMemory: vi.fn(),
    resetRequirementsInMemory: vi.fn(),
    setRequirementsModalOpen: vi.fn(),
    loadRequirements: vi.fn(),
    loadPmData: vi.fn(),
    loadGoals: vi.fn(),
    loadExcalidrawSpecLinks: vi.fn(),
    resetExcalidrawInMemory: vi.fn(),
    setProjectFiles: vi.fn(),
    setAllFiles: vi.fn(),
    selectFile: vi.fn(),
    openTab: vi.fn(),
    setEditorContent: vi.fn(),
    setImageData: vi.fn(),
    setPdfData: vi.fn(),
    setMindmapData: vi.fn(),
    setDiffContent: vi.fn(),
    fileStatuses: [],
    pmDraftTickets: [],
    cursorPos: { line: 0, col: 0 },
    diagnostics: new Map(),
    getDiagnosticCounts: () => ({ errors: 0, warnings: 0 }),
    agents: [],
    contextMenu: null,
    newItemModal: null,
    setNewItemModal: vi.fn(),
    setFileTicketCreate: vi.fn(),
    spawnNewAgent: vi.fn(async () => ({ id: 'a1', provider: 'claude' })),
    setSpawnDialogOpen: vi.fn(),
    setBottomCollapsed: vi.fn(),
    commitChanges: vi.fn(async () => 'abc123'),
    setCommitMessage: vi.fn(),
    branchInfo: null as { name: string; ahead: number; behind: number } | null,
    providers: [
      { id: 'claude', name: 'Claude', defaultModel: 'sonnet' },
      { id: 'gemini', name: 'Gemini', defaultModel: 'flash' },
    ],
    defaultProvider: { id: 'claude', name: 'Claude', defaultModel: 'sonnet' },
    agentSettings: {
      dangerouslyIgnorePermissions: false,
      autoAcceptEdits: false,
      agenticCommit: false,
      agenticCommitPrompt: 'commit and push. Prefix: {ticket}:',
      branchTicketPattern: '([A-Z]+-\\d+)',
      commitProviderId: undefined as string | undefined,
    },
  } as unknown as Parameters<typeof useIDEHandlers>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshGitStatus.mockResolvedValue([]);
    mockSaveGoals.mockResolvedValue(undefined);
    mockListAllFiles.mockResolvedValue([]);
    mockState.rootPath = null;
    mockState.contextMenu = null;
    mockState.newItemModal = null;
    mockFileTree = [];
    mockActiveTabId = null;
    mockState.branchInfo = null;
    mockState.agentSettings = {
      dangerouslyIgnorePermissions: false,
      autoAcceptEdits: false,
      agenticCommit: false,
      agenticCommitPrompt: 'commit and push. Prefix: {ticket}:',
      branchTicketPattern: '([A-Z]+-\\d+)',
      commitProviderId: undefined,
    };
  });

  it('lands in the cockpit instead of auto-opening README when opening a folder', async () => {
    const selectedPath = '/path/to/project';
    mockOpenFolderDialog.mockResolvedValue(selectedPath);
    mockReadDirectory.mockResolvedValue([
      { name: 'README.md', path: `${selectedPath}/README.md`, isDirectory: false },
      { name: 'src', path: `${selectedPath}/src`, isDirectory: true },
    ]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenFolder();

    expect(mockState.setRootPath).toHaveBeenCalledWith(selectedPath);
    // No document steals focus from Mission Control
    expect(mockState.selectFile).not.toHaveBeenCalled();
    expect(mockState.openTab).not.toHaveBeenCalled();
  });

  it('lands in the cockpit when opening a recent project', async () => {
    const projectPath = '/path/to/recent';
    mockReadDirectory.mockResolvedValue([
      { name: 'readme.txt', path: `${projectPath}/readme.txt`, isDirectory: false },
    ]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenRecent(projectPath);

    expect(mockState.setRootPath).toHaveBeenCalledWith(projectPath);
    expect(mockState.selectFile).not.toHaveBeenCalled();
  });

  it('loads pm, requirements and goals data when opening a project', async () => {
    const projectPath = '/path/to/recent';
    mockReadDirectory.mockResolvedValue([]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenRecent(projectPath);

    expect(mockState.loadPmData).toHaveBeenCalledWith(projectPath);
    expect(mockState.loadRequirements).toHaveBeenCalledWith(projectPath);
    expect(mockState.loadGoals).toHaveBeenCalledWith(projectPath);
    expect(mockState.loadExcalidrawSpecLinks).toHaveBeenCalledWith(projectPath);
  });

  it('creates a spec under specs/ and opens it in the editor', async () => {
    mockState.rootPath = '/path/to/project';
    mockReadDirectory.mockResolvedValue([]);
    mockReadFile.mockResolvedValue('');

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleNewSpec();

    expect(mockCreateDirectory).toHaveBeenCalledWith('/path/to/project/specs');
    const [writtenPath, template] = mockWriteFile.mock.calls[0] as [string, string];
    expect(writtenPath).toMatch(/^\/path\/to\/project\/specs\/spec-.+\.md$/);
    expect(template).toContain('# ');
    expect(mockState.selectFile).toHaveBeenCalledWith(writtenPath);
    expect(mockState.openTab).toHaveBeenCalledWith(expect.objectContaining({ path: writtenPath }));
  });

  it('does nothing on new spec without an open project', async () => {
    mockState.rootPath = null;
    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleNewSpec();

    expect(mockCreateDirectory).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('preserves expanded state of directories on refresh', async () => {
    const projectPath = '/path/to/project';
    mockState.rootPath = projectPath;
    mockFileTree = [
      { name: 'src', path: `${projectPath}/src`, isDirectory: true, expanded: true, children: [] },
      {
        name: 'docs',
        path: `${projectPath}/docs`,
        isDirectory: true,
        expanded: false,
        children: [],
      },
    ];
    mockReadDirectory.mockResolvedValue([
      { name: 'src', path: `${projectPath}/src`, isDirectory: true },
      { name: 'docs', path: `${projectPath}/docs`, isDirectory: true },
      { name: 'README.md', path: `${projectPath}/README.md`, isDirectory: false },
    ]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleRefresh();

    const tree = (mockState.setFileTree as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const src = tree.find((n: { path: string }) => n.path === `${projectPath}/src`);
    const docs = tree.find((n: { path: string }) => n.path === `${projectPath}/docs`);
    const readme = tree.find((n: { path: string }) => n.path === `${projectPath}/README.md`);

    expect(src.expanded).toBe(true);
    expect(docs.expanded).toBe(false);
    expect(readme.expanded).toBe(false);
  });

  it('keeps the flat file list in sync on root refresh so spec counts stay live', async () => {
    const projectPath = '/path/to/project';
    mockState.rootPath = projectPath;
    mockReadDirectory.mockResolvedValue([]);
    const files = [`${projectPath}/specs/spec-a.md`, `${projectPath}/README.md`];
    mockListAllFiles.mockResolvedValue(files);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleRefresh();

    expect(mockListAllFiles).toHaveBeenCalledWith(projectPath);
    expect(mockState.setAllFiles).toHaveBeenCalledWith(files);
  });

  it('does not re-list all files when only refreshing a subdirectory', async () => {
    const projectPath = '/path/to/project';
    mockState.rootPath = projectPath;
    mockReadDirectory.mockResolvedValue([]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleRefresh(`${projectPath}/src`);

    expect(mockListAllFiles).not.toHaveBeenCalled();
    expect(mockState.setAllFiles).not.toHaveBeenCalled();
  });

  describe('new diagram (excalidraw)', () => {
    it('creates a valid empty scene at the project root and opens it', async () => {
      mockState.rootPath = '/path/to/project';
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewDiagram();

      const [writtenPath, content] = mockWriteFile.mock.calls[0] as [string, string];
      expect(writtenPath).toMatch(/^\/path\/to\/project\/untitled-diagram-.+\.excalidraw$/);
      // The bytes on disk must always parse as a scene — never a zero-byte file.
      const scene = JSON.parse(content);
      expect(scene.elements).toEqual([]);
      expect(mockState.selectFile).toHaveBeenCalledWith(writtenPath);
      expect(mockState.openTab).toHaveBeenCalledWith(
        expect.objectContaining({ path: writtenPath })
      );
    });

    it('creates inside the given parent directory', async () => {
      mockState.rootPath = '/path/to/project';
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewDiagram('/path/to/project/docs');

      const [writtenPath] = mockWriteFile.mock.calls[0] as [string, string];
      expect(writtenPath).toMatch(/^\/path\/to\/project\/docs\/untitled-diagram-.+\.excalidraw$/);
    });

    it('does nothing without an open project', async () => {
      mockState.rootPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewDiagram();

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('offers "New Diagram" in the context menu, scoped to the folder itself', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'docs', path: '/p/docs', isDirectory: true },
      };
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && o.label === 'New Diagram'
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) option.action!();
      expect(mockWriteFile.mock.calls[0][0]).toMatch(/^\/p\/docs\/untitled-diagram-/);
    });

    it('offers "New Diagram" on a file node, scoped to its parent directory', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/docs/notes.md', isDirectory: false },
      };
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && o.label === 'New Diagram'
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) option.action!();
      expect(mockWriteFile.mock.calls[0][0]).toMatch(/^\/p\/docs\/untitled-diagram-/);
    });

    it('wires the excalidraw.new command to diagram creation at the root', async () => {
      mockState.rootPath = '/p';
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const cmd = result.current.commands.find((c) => c.id === 'excalidraw.new');
      expect(cmd).toBeDefined();
      cmd!.action();
      expect(mockWriteFile.mock.calls[0][0]).toMatch(/^\/p\/untitled-diagram-.+\.excalidraw$/);
    });

    it('seeds .excalidraw files from the generic New File dialog with a valid scene', async () => {
      mockState.newItemModal = { type: 'file', parentDir: '/p/docs' };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCreateNewItem('sketch.excalidraw');

      const [writtenPath, content] = mockWriteFile.mock.calls[0] as [string, string];
      expect(writtenPath).toBe('/p/docs/sketch.excalidraw');
      expect(JSON.parse(content).elements).toEqual([]);
    });

    it('keeps seeding non-excalidraw files from the New File dialog empty', async () => {
      mockState.newItemModal = { type: 'file', parentDir: '/p/docs' };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCreateNewItem('notes.md');

      expect(mockWriteFile).toHaveBeenCalledWith('/p/docs/notes.md', '');
    });
  });

  describe('reveal in file manager (context menu)', () => {
    it('offers a reveal option for files that opens the OS file manager', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/docs/notes.md', isDirectory: false },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && /reveal|explorer|finder|file manager/i.test(o.label)
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) option.action!();
      expect(mockRevealInFileManager).toHaveBeenCalledWith('/p/docs/notes.md');
    });

    it('offers a reveal option for directories too', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'docs', path: '/p/docs', isDirectory: true },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && /reveal|explorer|finder|file manager/i.test(o.label)
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) option.action!();
      expect(mockRevealInFileManager).toHaveBeenCalledWith('/p/docs');
    });
  });

  describe('create ticket from markdown (context menu)', () => {
    it('offers the option only for markdown files, not directories or other files', () => {
      mockState.rootPath = '/p';

      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/notes.md', isDirectory: false },
      };
      let { result } = renderHook(() => useIDEHandlers(mockState));
      expect(
        result.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Create Ticket from Markdown'
        )
      ).toBe(true);

      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.txt', path: '/p/notes.txt', isDirectory: false },
      };
      ({ result } = renderHook(() => useIDEHandlers(mockState)));
      expect(
        result.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Create Ticket from Markdown'
        )
      ).toBe(false);

      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'docs', path: '/p/docs', isDirectory: true },
      };
      ({ result } = renderHook(() => useIDEHandlers(mockState)));
      expect(
        result.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Create Ticket from Markdown'
        )
      ).toBe(false);
    });

    it('packs the full markdown content into the ticket wizard, titled from the first heading', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'spec.md', path: '/p/docs/spec.md', isDirectory: false },
      };
      mockReadFile.mockResolvedValue('# Ship the thing\n\nSome details here.\n');

      const { result } = renderHook(() => useIDEHandlers(mockState));
      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && o.label === 'Create Ticket from Markdown'
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) await option.action!();

      expect(mockReadFile).toHaveBeenCalledWith('/p/docs/spec.md');
      expect(mockState.setFileTicketCreate).toHaveBeenCalledWith({
        initialValues: {
          name: 'Ship the thing',
          description: '# Ship the thing\n\nSome details here.\n',
          context: [{ id: expect.any(String), type: 'file', value: '/p/docs/spec.md' }],
        },
      });
    });

    it('falls back to the filename when the markdown has no heading', async () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'unnamed.md', path: '/p/unnamed.md', isDirectory: false },
      };
      mockReadFile.mockResolvedValue('Just prose, no heading.');

      const { result } = renderHook(() => useIDEHandlers(mockState));
      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && o.label === 'Create Ticket from Markdown'
      );
      if (option && 'action' in option) await option.action!();

      expect(mockState.setFileTicketCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValues: expect.objectContaining({ name: 'unnamed' }),
        })
      );
    });
  });

  describe('handleCommit', () => {
    it('spawns an agent with the templated prompt when agentic commit is on, instead of committing directly', async () => {
      mockState.rootPath = '/p';
      mockState.branchInfo = { name: 'feature/AUR-42-thing', ahead: 0, behind: 0 };
      mockState.agentSettings = {
        ...mockState.agentSettings,
        agenticCommit: true,
        commitProviderId: 'gemini',
      };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit();

      expect(mockState.spawnNewAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'flash',
          cwd: '/p',
          task: 'commit and push. Prefix: AUR-42:',
        })
      );
      expect(mockState.commitChanges).not.toHaveBeenCalled();
    });

    it('falls back to a plain manual commit when agentic commit is off', async () => {
      mockState.rootPath = '/p';
      mockState.agentSettings = { ...mockState.agentSettings, agenticCommit: false };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit();

      expect(mockState.commitChanges).toHaveBeenCalledWith('/p');
      expect(mockState.spawnNewAgent).not.toHaveBeenCalled();
    });
  });

  describe('handleSpawnNewAgent', () => {
    it('persists the goal run when the agent is spawned for a goal', async () => {
      mockState.rootPath = '/p';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleSpawnNewAgent({
        name: 'goal:Ship it',
        model: 'sonnet',
        task: 'Do the thing',
        provider: 'claude',
        spawnedByGoalId: 'g1',
      });

      expect(mockState.spawnNewAgent).toHaveBeenCalled();
      expect(mockSaveGoals).toHaveBeenCalledWith('/p');
    });

    it('does not touch goal persistence for agents spawned without a goal', async () => {
      mockState.rootPath = '/p';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleSpawnNewAgent({
        name: 'Agent',
        model: 'sonnet',
        task: 'Do the thing',
        provider: 'claude',
      });

      expect(mockSaveGoals).not.toHaveBeenCalled();
    });
  });

  describe('tab content loading', () => {
    it('handleFileSelect opens the tab without reading the file itself', async () => {
      // Content loading is owned by the activeTabId effect (single loader) —
      // handleFileSelect only selects and opens; otherwise every tree click
      // would read the file twice.
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleFileSelect('/project/notes.md');

      expect(mockState.selectFile).toHaveBeenCalledWith('/project/notes.md');
      expect(mockState.openTab).toHaveBeenCalledWith({
        id: '/project/notes.md',
        path: '/project/notes.md',
        name: 'notes.md',
      });
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('loadTabContent reads a text file and shows it in the editor', async () => {
      mockActiveTabId = '/project/notes.md';
      mockReadFile.mockResolvedValue('# Notes');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.loadTabContent('/project/notes.md');

      expect(mockReadFile).toHaveBeenCalledWith('/project/notes.md');
      expect(mockState.setEditorContent).toHaveBeenCalledWith('# Notes');
    });

    it('loadTabContent drops the result when the user already switched on', async () => {
      mockActiveTabId = '/project/other.md';
      mockReadFile.mockResolvedValue('# Stale');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.loadTabContent('/project/notes.md');

      expect(mockState.setEditorContent).not.toHaveBeenCalled();
    });
  });
});
