import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SetStateAction } from 'react';
import { CONTEXT_BOUND_COMMANDS, useIDEHandlers } from './useIDEHandlers';
import { defaultCommands } from '@/lib/commands/registry';

// Mock Tauri FS
const mockReadDirectory = vi.fn();
const mockOpenFolderDialog = vi.fn();
const mockReadFile = vi.fn();
const mockReadFileBase64 = vi.fn();
const mockWriteFile = vi.fn();
const mockCreateDirectory = vi.fn();
const mockListAllFiles = vi.fn();
const mockMovePath = vi.fn();
const mockExists = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  openFolderDialog: () => mockOpenFolderDialog(),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readFileBase64: (...args: unknown[]) => mockReadFileBase64(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
  listAllFiles: (...args: unknown[]) => mockListAllFiles(...args),
  movePath: (...args: unknown[]) => mockMovePath(...args),
  exists: (...args: unknown[]) => mockExists(...args),
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
}));

const mockRevealInFileManager = vi.fn();
vi.mock('@/lib/tauri/opener', () => ({
  revealInFileManager: (...args: unknown[]) => mockRevealInFileManager(...args),
}));

// Mock Store
const mockRefreshGitStatus = vi.fn();
const mockStageAll = vi.fn();
const mockMarkDirty = vi.fn();
const mockUpdateFileInIndex = vi.fn();
const mockShowToast = vi.fn();
const mockSaveGoals = vi.fn();
let mockFileTree: unknown[] = [];
let mockActiveTabId: string | null = null;
let mockFileStatuses: { path: string; status: string }[] = [];
let mockScratchDir: string | null = null;
let mockScratches: { name: string; path: string }[] = [];
const mockInitScratches = vi.fn(async () => {});
const mockRefreshScratches = vi.fn(async () => {});
const mockGetBacklinksFor = vi.fn((_name: string) => [] as string[]);
vi.mock('@/lib/store', () => {
  const getState = () => ({
    refreshGitStatus: mockRefreshGitStatus,
    stageAll: mockStageAll,
    rootPath: '/p',
    fileStatuses: mockFileStatuses,
    activeTabId: mockActiveTabId,
    fileTree: mockFileTree,
    saveGoals: mockSaveGoals,
    markDirty: mockMarkDirty,
    updateFileInIndex: mockUpdateFileInIndex,
    showToast: mockShowToast,
    scratchDir: mockScratchDir,
    scratches: mockScratches,
    initScratches: mockInitScratches,
    refreshScratches: mockRefreshScratches,
    getBacklinksFor: mockGetBacklinksFor,
    overlayStack: { layers: [] as { id: string; kind: string }[] },
    pushOverlay: () => undefined,
    removeOverlay: () => undefined,
    ownsEscape: () => false,
    closeWorkPlace: () => undefined,
    openWorkPlace: () => undefined,
  });
  return {
    useStore: Object.assign(
      (selector: (s: ReturnType<typeof getState>) => unknown) => selector(getState()),
      {
        getState,
      }
    ),
  };
});

describe('useIDEHandlers', () => {
  const mockState = {
    rootPath: null as string | null,
    setRootPath: vi.fn(),
    addRecentProject: vi.fn(),
    initProjectDb: vi.fn(),
    setFileTree: vi.fn(),
    setDirectoryChildren: vi.fn(),
    toggleExpand: vi.fn(),
    closeTab: vi.fn(),
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
    setScrollToLine: vi.fn(),
    setFindInFilesOpen: vi.fn(),
    setEditorContent: vi.fn(),
    setImageData: vi.fn(),
    setVideoSrc: vi.fn(),
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
    setContextMenu: vi.fn(),
    newItemModal: null,
    setNewItemModal: vi.fn(),
    renameDialog: null as { path: string; oldName: string; isDirectory: boolean } | null,
    setRenameDialog: vi.fn(),
    renamePath: vi.fn(),
    showToast: vi.fn(),
    selectedPath: null as string | null,
    selectedPaths: [] as string[],
    setSelectedPaths: vi.fn(),
    selectionAnchor: null as string | null,
    setSelectionAnchor: vi.fn(),
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
    mockState.renameDialog = null;
    mockState.selectedPath = null;
    mockState.selectedPaths = [];
    mockState.selectionAnchor = null;
    mockFileTree = [];
    mockActiveTabId = null;
    mockFileStatuses = [];
    mockState.branchInfo = null;
    mockGetBacklinksFor.mockImplementation(() => []);
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

  describe('new file', () => {
    it('asks for the name up front instead of creating an untitled file', async () => {
      mockState.rootPath = '/p';

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewFile();

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockState.setNewItemModal).toHaveBeenCalledWith({ type: 'file', parentDir: '/p' });
    });

    it('marks a clicked folder as selected so it becomes the target', async () => {
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleToggleDir('/p/docs');

      expect(mockState.selectFile).toHaveBeenCalledWith('/p/docs');
    });

    it('targets the selected folder itself', async () => {
      mockState.rootPath = '/p';
      mockState.selectedPath = '/p/docs';
      mockFileTree = [{ path: '/p/docs', name: 'docs', isDirectory: true, children: [] }];

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewFile();

      expect(mockState.setNewItemModal).toHaveBeenCalledWith({
        type: 'file',
        parentDir: '/p/docs',
      });
    });

    it('targets the folder of the selected file instead of the project root', async () => {
      mockState.rootPath = '/p';
      mockState.selectedPath = '/p/docs/notes.md';
      mockFileTree = [
        {
          path: '/p/docs',
          name: 'docs',
          isDirectory: true,
          children: [{ path: '/p/docs/notes.md', name: 'notes.md', isDirectory: false }],
        },
      ];

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewFile();

      expect(mockState.setNewItemModal).toHaveBeenCalledWith({
        type: 'file',
        parentDir: '/p/docs',
      });
    });

    it('does nothing without an open project', async () => {
      mockState.rootPath = null;

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewFile();

      expect(mockState.setNewItemModal).not.toHaveBeenCalled();
    });

    it('opens the newly named file in the editor', async () => {
      mockState.newItemModal = { type: 'file', parentDir: '/p/docs' };
      mockReadFile.mockResolvedValue('');

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCreateNewItem('notes.md');

      expect(mockState.selectFile).toHaveBeenCalledWith('/p/docs/notes.md');
      expect(mockState.openTab).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/p/docs/notes.md' })
      );
    });

    it('does not open a tab for a newly created folder', async () => {
      mockState.newItemModal = { type: 'folder', parentDir: '/p/docs' };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCreateNewItem('assets');

      expect(mockCreateDirectory).toHaveBeenCalledWith('/p/docs/assets');
      expect(mockState.openTab).not.toHaveBeenCalled();
    });
  });

  describe('git status on lazy folder expand', () => {
    it('attaches gitStatus to children loaded by expanding a folder', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [
        { path: 'docs/ignored.log', status: 'ignored' },
        { path: 'docs/notes.md', status: 'modified' },
      ];
      mockReadDirectory.mockResolvedValue([
        { name: 'ignored.log', path: '/p/docs/ignored.log', isDirectory: false },
        { name: 'notes.md', path: '/p/docs/notes.md', isDirectory: false },
      ]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleToggleDir('/p/docs');

      expect(mockState.setDirectoryChildren).toHaveBeenCalledWith('/p/docs', [
        expect.objectContaining({ path: '/p/docs/ignored.log', gitStatus: 'ignored' }),
        expect.objectContaining({ path: '/p/docs/notes.md', gitStatus: 'modified' }),
      ]);
    });

    it('greys out a gitignored folder when git reports it with a trailing slash', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [{ path: 'build/', status: 'ignored' }];
      mockReadDirectory.mockResolvedValue([
        { name: 'build', path: '/p/build', isDirectory: true },
        { name: 'src', path: '/p/src', isDirectory: true },
      ]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefresh('/p', true);

      expect(mockState.setFileTree).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/p/build', gitStatus: 'ignored' }),
        expect.objectContaining({ path: '/p/src', gitStatus: undefined }),
      ]);
    });

    it('leaves gitStatus undefined for untouched children', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockReadDirectory.mockResolvedValue([
        { name: 'clean.md', path: '/p/docs/clean.md', isDirectory: false },
      ]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleToggleDir('/p/docs');

      expect(mockState.setDirectoryChildren).toHaveBeenCalledWith('/p/docs', [
        expect.objectContaining({ path: '/p/docs/clean.md', gitStatus: undefined }),
      ]);
    });
  });

  describe('root-area context menu', () => {
    it('opens a context menu targeting the project root', () => {
      mockState.rootPath = '/p';
      const { result } = renderHook(() => useIDEHandlers(mockState));
      const event = { clientX: 10, clientY: 20, preventDefault: vi.fn() } as unknown as Parameters<
        typeof result.current.handleRootContextMenu
      >[0];

      result.current.handleRootContextMenu(event);

      expect(mockState.setContextMenu).toHaveBeenCalledWith({
        x: 10,
        y: 20,
        node: { path: '/p', name: '', isDirectory: true },
      });
    });

    it('does nothing without an open project', () => {
      mockState.rootPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));
      const event = { clientX: 0, clientY: 0, preventDefault: vi.fn() } as unknown as Parameters<
        typeof result.current.handleRootContextMenu
      >[0];

      result.current.handleRootContextMenu(event);

      expect(mockState.setContextMenu).not.toHaveBeenCalled();
    });

    it('omits Rename and Delete for the root context', () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = { x: 0, y: 0, node: { path: '/p', name: '', isDirectory: true } };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const labels = result.current.contextMenuOptions
        .filter((o) => 'label' in o)
        .map((o) => (o as { label: string }).label);
      expect(labels).not.toContain('Rename');
      expect(labels).not.toContain('Delete');
      expect(labels).toContain('New File');
    });
  });

  describe('multi-select', () => {
    it('handleFocusNode replaces the selection with a single node', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleFocusNode('/p/notes.md');

      expect(mockState.selectFile).toHaveBeenCalledWith('/p/notes.md');
      expect(mockState.setSelectedPaths).toHaveBeenCalledWith(['/p/notes.md']);
      expect(mockState.setSelectionAnchor).toHaveBeenCalledWith('/p/notes.md');
    });

    it('handleToggleSelect adds an unselected path to the selection', () => {
      mockState.selectedPaths = ['/p/a.md'];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleToggleSelect('/p/b.md');

      expect(mockState.setSelectedPaths).toHaveBeenCalledWith(['/p/a.md', '/p/b.md']);
    });

    it('handleToggleSelect removes an already-selected path', () => {
      mockState.selectedPaths = ['/p/a.md', '/p/b.md'];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleToggleSelect('/p/a.md');

      expect(mockState.setSelectedPaths).toHaveBeenCalledWith(['/p/b.md']);
    });

    it('handleRangeSelect sets the full resolved range and the new primary', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleRangeSelect(['/p/a.md', '/p/b.md', '/p/c.md'], '/p/c.md');

      expect(mockState.setSelectedPaths).toHaveBeenCalledWith(['/p/a.md', '/p/b.md', '/p/c.md']);
      expect(mockState.selectFile).toHaveBeenCalledWith('/p/c.md');
    });

    it('handleClearSelection collapses back to just the primary selection', () => {
      mockState.selectedPath = '/p/a.md';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleClearSelection();

      expect(mockState.setSelectedPaths).toHaveBeenCalledWith(['/p/a.md']);
    });

    it('shows a narrowed menu with a bulk Delete when right-clicking within a multi-selection', () => {
      mockState.rootPath = '/p';
      mockState.selectedPaths = ['/p/a.md', '/p/b.md'];
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'a.md', path: '/p/a.md', isDirectory: false },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const labels = result.current.contextMenuOptions
        .filter((o) => 'label' in o)
        .map((o) => (o as { label: string }).label);
      expect(labels).toContain('Delete 2 Items');
      expect(labels).toContain('Copy 2 Paths');
      expect(labels).not.toContain('Rename');
    });

    it('does not narrow the menu when right-clicking outside the multi-selection', () => {
      mockState.rootPath = '/p';
      mockState.selectedPaths = ['/p/a.md', '/p/b.md'];
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'c.md', path: '/p/c.md', isDirectory: false },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const labels = result.current.contextMenuOptions
        .filter((o) => 'label' in o)
        .map((o) => (o as { label: string }).label);
      expect(labels).toContain('Rename');
      expect(labels).not.toContain('Delete 2 Items');
    });

    /**
     * The question is asked in-app, so the dialog has to be on screen for the
     * answer to exist at all. window.confirm cannot stand in for this: inside
     * the Tauri webview it never suspended the script, and the delete went
     * through before the user had answered.
     */
    function DeleteHarness({ paths }: { paths: string[] }) {
      const handlers = useIDEHandlers(mockState);
      return (
        <div>
          <button onClick={() => void handlers.handleDeleteSelection(paths)}>Delete</button>
          {handlers.confirmDialog}
        </div>
      );
    }

    it('deletes every path in a bulk selection after a single confirm', async () => {
      const user = userEvent.setup();
      mockReadDirectory.mockResolvedValue([]);
      render(<DeleteHarness paths={['/p/a.md', '/p/b.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(mockDeleteFile).toHaveBeenCalledTimes(2));
      expect(mockDeleteFile).toHaveBeenCalledWith('/p/a.md');
      expect(mockDeleteFile).toHaveBeenCalledWith('/p/b.md');
      expect(mockState.setSelectedPaths).toHaveBeenCalledWith([]);
    });

    it('asks once for the whole selection', async () => {
      const user = userEvent.setup();
      mockReadDirectory.mockResolvedValue([]);
      render(<DeleteHarness paths={['/p/a.md', '/p/b.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(await screen.findAllByRole('dialog')).toHaveLength(1);
      expect((await screen.findByRole('dialog')).textContent).toContain('2 items');
    });

    it('warns in the confirm dialog when another file still links to the one being deleted', async () => {
      const user = userEvent.setup();
      mockReadDirectory.mockResolvedValue([]);
      mockGetBacklinksFor.mockImplementation((name: string) =>
        name === 'note.md' ? ['/p/hub.md'] : []
      );
      render(<DeleteHarness paths={['/p/note.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Referenced by 1 file: hub.md.');
    });

    it('does not mention backlinks when nothing references the deleted file', async () => {
      const user = userEvent.setup();
      mockReadDirectory.mockResolvedValue([]);
      render(<DeleteHarness paths={['/p/note.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).not.toContain('Referenced by');
    });

    it('deletes nothing while the question is still open', async () => {
      const user = userEvent.setup();
      render(<DeleteHarness paths={['/p/a.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('deletes nothing when the confirm is declined', async () => {
      const user = userEvent.setup();
      render(<DeleteHarness paths={['/p/a.md']} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mockDeleteFile).not.toHaveBeenCalled();
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

  describe('rename (context menu)', () => {
    it('offers a Rename option that opens the rename dialog pre-filled with the node', () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/notes.md', isDirectory: false },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      const option = result.current.contextMenuOptions.find(
        (o) => 'label' in o && o.label === 'Rename'
      );
      expect(option).toBeDefined();
      if (option && 'action' in option) option.action!();

      expect(mockState.setRenameDialog).toHaveBeenCalledWith({
        path: '/p/notes.md',
        oldName: 'notes.md',
        isDirectory: false,
      });
    });

    it('moves the file to its new name, updates open tabs and refreshes the tree', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/notes.md', oldName: 'notes.md', isDirectory: false };
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockMovePath).toHaveBeenCalledWith('/p/notes.md', '/p/renamed.md');
      expect(mockState.renamePath).toHaveBeenCalledWith('/p/notes.md', '/p/renamed.md');
      expect(mockState.setRenameDialog).toHaveBeenCalledWith(null);
    });

    it('re-points the selection when renaming the selected file', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/notes.md', oldName: 'notes.md', isDirectory: false };
      mockState.selectedPath = '/p/notes.md';
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockState.selectFile).toHaveBeenCalledWith('/p/renamed.md');
    });

    it('surfaces a toast and keeps the dialog open on a naming collision', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/notes.md', oldName: 'notes.md', isDirectory: false };
      mockMovePath.mockRejectedValueOnce('An item named "renamed.md" already exists here');

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockState.showToast).toHaveBeenCalledWith(
        'An item named "renamed.md" already exists here',
        'error'
      );
      expect(mockState.renamePath).not.toHaveBeenCalled();
      expect(mockState.setRenameDialog).not.toHaveBeenCalledWith(null);
    });

    it('does nothing without a pending rename dialog', async () => {
      mockState.renameDialog = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockMovePath).not.toHaveBeenCalled();
    });

    it('rewrites wiki-links in files that reference the renamed file', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/notes.md', oldName: 'notes.md', isDirectory: false };
      mockGetBacklinksFor.mockImplementation((name: string) =>
        name === 'notes.md' ? ['/p/hub.md'] : []
      );
      mockReadFile.mockResolvedValue('See [[Notes]] for details.');
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockGetBacklinksFor).toHaveBeenCalledWith('notes.md');
      expect(mockReadFile).toHaveBeenCalledWith('/p/hub.md');
      expect(mockWriteFile).toHaveBeenCalledWith('/p/hub.md', 'See [[renamed]] for details.');
      expect(mockUpdateFileInIndex).toHaveBeenCalledWith(
        '/p/hub.md',
        'See [[renamed]] for details.'
      );
    });

    it('updates the live editor when the referencing file is the open tab', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/notes.md', oldName: 'notes.md', isDirectory: false };
      mockGetBacklinksFor.mockImplementation((name: string) =>
        name === 'notes.md' ? ['/p/hub.md'] : []
      );
      mockReadFile.mockResolvedValue('[[Notes]]');
      mockReadDirectory.mockResolvedValue([]);
      const openTabState = { ...mockState, activeTabId: '/p/hub.md' };

      const { result } = renderHook(() => useIDEHandlers(openTabState));

      await result.current.handleRenameConfirm('renamed.md');

      expect(mockState.setEditorContent).toHaveBeenCalledWith('[[renamed]]');
    });

    it('does not rewrite links when renaming a directory', async () => {
      mockState.rootPath = '/p';
      mockState.renameDialog = { path: '/p/folder', oldName: 'folder', isDirectory: true };
      mockGetBacklinksFor.mockImplementation(() => ['/p/hub.md']);
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameConfirm('renamed-folder');

      expect(mockGetBacklinksFor).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  describe('add to .gitignore (context menu)', () => {
    it('appends the file, anchored at the root, to an existing .gitignore', async () => {
      mockState.rootPath = '/p';
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('node_modules\n');
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'secret.env',
        path: '/p/config/secret.env',
        isDirectory: false,
      });

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/p/.gitignore',
        'node_modules\n/config/secret.env\n'
      );
    });

    it('marks directories with a trailing slash', async () => {
      mockState.rootPath = '/p';
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('');
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'build',
        path: '/p/build',
        isDirectory: true,
      });

      expect(mockWriteFile).toHaveBeenCalledWith('/p/.gitignore', '/build/\n');
    });

    it('creates the .gitignore when the project has none yet', async () => {
      mockState.rootPath = '/p';
      mockExists.mockResolvedValue(false);
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'build',
        path: '/p/build',
        isDirectory: true,
      });

      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith('/p/.gitignore', '/build/\n');
    });

    it('does not write a duplicate when the rule is already there', async () => {
      mockState.rootPath = '/p';
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('/build/\n');

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'build',
        path: '/p/build',
        isDirectory: true,
      });

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockState.showToast).toHaveBeenCalledWith(
        expect.stringContaining('already'),
        expect.anything()
      );
    });

    it('surfaces a toast instead of writing when the .gitignore cannot be saved', async () => {
      mockState.rootPath = '/p';
      mockExists.mockResolvedValue(true);
      mockReadFile.mockResolvedValue('');
      mockWriteFile.mockRejectedValueOnce('Permission denied');

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'build',
        path: '/p/build',
        isDirectory: true,
      });

      expect(mockState.showToast).toHaveBeenCalledWith('Permission denied', 'error');
    });

    it('does nothing without an open project', async () => {
      mockState.rootPath = null;

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleAddToGitignore({
        name: 'build',
        path: '/p/build',
        isDirectory: true,
      });

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('offers the option in the context menu for files and folders alike', () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'build', path: '/p/build', isDirectory: true },
      };

      const { result: folderResult } = renderHook(() => useIDEHandlers(mockState));
      expect(
        folderResult.current.contextMenuOptions.some(
          (o) => 'label' in o && /gitignore/i.test(o.label)
        )
      ).toBe(true);

      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/docs/notes.md', isDirectory: false },
      };
      const { result: fileResult } = renderHook(() => useIDEHandlers(mockState));
      expect(
        fileResult.current.contextMenuOptions.some(
          (o) => 'label' in o && /gitignore/i.test(o.label)
        )
      ).toBe(true);
    });

    it('hides the option for the .gitignore file itself', () => {
      mockState.rootPath = '/p';
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: '.gitignore', path: '/p/.gitignore', isDirectory: false },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      expect(
        result.current.contextMenuOptions.some((o) => 'label' in o && /gitignore/i.test(o.label))
      ).toBe(false);
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

    it('leaves the bottom terminal panel collapsed', async () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleSpawnNewAgent({
        name: 'Agent',
        model: 'sonnet',
        task: 'Do the thing',
        provider: 'claude',
      });

      expect(mockState.setBottomCollapsed).not.toHaveBeenCalled();
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

    it('loadTabContent wraps a png as a data URI the image viewer can paint', async () => {
      mockActiveTabId = '/project/shot.png';
      mockReadFileBase64.mockResolvedValue('iVBORw0KGgo');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.loadTabContent('/project/shot.png');

      expect(mockReadFileBase64).toHaveBeenCalledWith('/project/shot.png');
      expect(mockState.setImageData).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo');
      expect(mockReadFile).not.toHaveBeenCalled();
    });

    it('loadTabContent wraps jpeg and gif with their real mime types', async () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      mockActiveTabId = '/project/photo.jpg';
      mockReadFileBase64.mockResolvedValue('jpgbytes');
      await result.current.loadTabContent('/project/photo.jpg');
      expect(mockState.setImageData).toHaveBeenCalledWith('data:image/jpeg;base64,jpgbytes');

      mockActiveTabId = '/project/anim.gif';
      mockReadFileBase64.mockResolvedValue('gifbytes');
      await result.current.loadTabContent('/project/anim.gif');
      expect(mockState.setImageData).toHaveBeenCalledWith('data:image/gif;base64,gifbytes');
    });

    it('loadTabContent streams a video instead of reading it as text', async () => {
      mockActiveTabId = '/project/clip.mp4';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.loadTabContent('/project/clip.mp4');

      expect(mockState.setVideoSrc).toHaveBeenCalled();
      const src = (mockState.setVideoSrc as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(typeof src).toBe('string');
      expect(src).toContain('clip.mp4');
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockState.setImageData).toHaveBeenCalledWith(null);
    });
  });

  describe('editor autosave', () => {
    // Mirrors the real store: the buffer the editor shows IS what a save writes.
    let buffer = '# Notes';
    const editorState = {
      ...mockState,
      activeTabId: '/project/notes.md',
      get editorContent() {
        return buffer;
      },
      setEditorContent: (content: SetStateAction<string>) => {
        buffer = typeof content === 'function' ? content(buffer) : content;
      },
      markDirty: vi.fn(),
      updateFileInIndex: vi.fn(),
    };

    beforeEach(() => {
      vi.clearAllMocks();
      buffer = '# Notes';
      mockWriteFile.mockResolvedValue(undefined);
    });

    it('does not write on every keystroke', () => {
      const { result } = renderHook(() => useIDEHandlers(editorState));

      result.current.handleEditorChange('a');
      result.current.handleEditorChange('ab');
      result.current.handleEditorChange('abc');

      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('marks the tab dirty as soon as it is edited', () => {
      const { result } = renderHook(() => useIDEHandlers(editorState));
      result.current.handleEditorChange('a');
      expect(editorState.markDirty).toHaveBeenCalledWith('/project/notes.md', true);
    });

    it('writes only the final text of a typing burst on save', async () => {
      const { result } = renderHook(() => useIDEHandlers(editorState));

      result.current.handleEditorChange('a');
      result.current.handleEditorChange('ab');
      result.current.handleEditorChange('abc');
      await result.current.handleSave();

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).toHaveBeenCalledWith('/project/notes.md', 'abc');
    });

    it('clears the dirty marker once the write landed', async () => {
      const { result } = renderHook(() => useIDEHandlers(editorState));

      result.current.handleEditorChange('abc');
      await result.current.handleSave();

      expect(mockMarkDirty).toHaveBeenCalledWith('/project/notes.md', false);
      expect(mockUpdateFileInIndex).toHaveBeenCalledWith('/project/notes.md', 'abc');
    });

    it('reports a failed write instead of losing it silently', async () => {
      mockWriteFile.mockRejectedValue(new Error('disk full'));
      const { result } = renderHook(() => useIDEHandlers(editorState));

      result.current.handleEditorChange('abc');
      await result.current.handleSave();

      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), 'error');
      expect(mockMarkDirty).not.toHaveBeenCalledWith('/project/notes.md', false);
    });

    it('saves the current buffer even when nothing was typed since the last save', async () => {
      const { result } = renderHook(() => useIDEHandlers(editorState));
      await result.current.handleSave();
      expect(mockWriteFile).toHaveBeenCalledWith('/project/notes.md', '# Notes');
    });
  });

  describe('scratch files', () => {
    beforeEach(() => {
      mockScratchDir = '/data/scratches';
      mockScratches = [];
      mockWriteFile.mockResolvedValue(undefined);
      mockDeleteFile.mockResolvedValue(undefined);
      mockMovePath.mockResolvedValue(undefined);
    });

    it('creates the next scratch file and opens it, without requiring a project', async () => {
      mockState.rootPath = null;
      mockScratches = [{ name: 'scratch-2.md', path: '/data/scratches/scratch-2.md' }];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewScratch();

      expect(mockWriteFile).toHaveBeenCalledWith('/data/scratches/scratch-3.md', '');
      expect(mockRefreshScratches).toHaveBeenCalled();
      expect(mockState.openTab).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/data/scratches/scratch-3.md' })
      );
    });

    it('resolves the scratch dir on first use', async () => {
      mockScratchDir = null;
      mockInitScratches.mockImplementationOnce(async () => {
        mockScratchDir = '/data/scratches';
      });
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewScratch();

      expect(mockInitScratches).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith('/data/scratches/scratch-1.md', '');
    });

    it('reports an error when the scratch dir cannot be resolved', async () => {
      mockScratchDir = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleNewScratch();

      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });

    it('flushes pending autosaves before deleting, so the file cannot be resurrected', async () => {
      const path = '/data/scratches/scratch-1.md';
      const scratchState = { ...mockState, activeTabId: path, markDirty: vi.fn() };
      const { result } = renderHook(() => useIDEHandlers(scratchState));

      result.current.handleEditorChange('draft to flush');
      await result.current.handleDeleteScratch(path);

      // The debounced write must land before the delete, never after it.
      expect(mockWriteFile).toHaveBeenCalledWith(path, 'draft to flush');
      const writeOrder = mockWriteFile.mock.invocationCallOrder[0];
      const deleteOrder = mockDeleteFile.mock.invocationCallOrder[0];
      expect(writeOrder).toBeLessThan(deleteOrder);
      expect(scratchState.closeTab).toHaveBeenCalledWith(path);
      expect(mockRefreshScratches).toHaveBeenCalled();
    });

    it('clean-all deletes every scratch and closes their tabs', async () => {
      mockScratches = [
        { name: 'scratch-2.md', path: '/data/scratches/scratch-2.md' },
        { name: 'scratch-1.md', path: '/data/scratches/scratch-1.md' },
      ];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCleanAllScratches();

      expect(mockDeleteFile).toHaveBeenCalledTimes(2);
      expect(mockState.closeTab).toHaveBeenCalledWith('/data/scratches/scratch-2.md');
      expect(mockState.closeTab).toHaveBeenCalledWith('/data/scratches/scratch-1.md');
      expect(mockRefreshScratches).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('2'), 'success');
    });

    it('renames a scratch and keeps the open tab pointing at the new path', async () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameScratch('/data/scratches/scratch-1.md', 'api-notes');

      expect(mockMovePath).toHaveBeenCalledWith(
        '/data/scratches/scratch-1.md',
        '/data/scratches/api-notes.md'
      );
      expect(mockState.renamePath).toHaveBeenCalledWith(
        '/data/scratches/scratch-1.md',
        '/data/scratches/api-notes.md'
      );
      expect(mockRefreshScratches).toHaveBeenCalled();
    });

    it('rejects a rename that collides with an existing scratch', async () => {
      mockScratches = [{ name: 'api-notes.md', path: '/data/scratches/api-notes.md' }];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRenameScratch('/data/scratches/scratch-1.md', 'api-notes');

      expect(mockMovePath).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('api-notes.md'), 'error');
    });
  });

  describe('command coverage', () => {
    // A command that is offered but does nothing is a lie the caller cannot
    // see: the palette closes, the menu item flashes, and an external driver
    // reads it as success. Every declared command must either do its work or
    // say out loud that it cannot — never shrug.
    it('leaves no declared command without an action or a stated context', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));
      const performable = new Set(result.current.performableCommandIds);

      const shrugging = defaultCommands
        .map((c) => c.id)
        .filter((id) => !performable.has(id) && !(id in CONTEXT_BOUND_COMMANDS));

      expect(shrugging).toEqual([]);
    });

    it('explains a context-bound command instead of doing nothing', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'markdown.rename-heading')!.action();

      expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('F2'), 'info');
    });

    it('names every context-bound command in the registry', () => {
      const declared = new Set(defaultCommands.map((c) => c.id));
      const orphans = Object.keys(CONTEXT_BOUND_COMMANDS).filter((id) => !declared.has(id));

      // A hint for a command nobody offers is dead weight that will rot.
      expect(orphans).toEqual([]);
    });

    it('stages every changed file for git.stage-all', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.stage-all')!.action();

      expect(mockStageAll).toHaveBeenCalledWith('/p');
    });

    it('opens Find in Files when a project is open', () => {
      mockState.rootPath = '/p';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'file.find-in-files')!.action();

      expect(mockState.setFindInFilesOpen).toHaveBeenCalledWith(true);
    });

    it('does not open Find in Files without a project', () => {
      mockState.rootPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'file.find-in-files')!.action();

      expect(mockState.setFindInFilesOpen).not.toHaveBeenCalled();
    });
  });

  describe('handleFindInFilesNavigate', () => {
    it('opens the file and jumps to the line when it is not already the active tab', async () => {
      mockActiveTabId = null;
      mockReadFile.mockResolvedValue('some content');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleFindInFilesNavigate('/p/other.md', 7);

      expect(mockState.openTab).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/p/other.md' })
      );
      expect(mockReadFile).toHaveBeenCalledWith('/p/other.md');
      expect(mockState.setScrollToLine).toHaveBeenCalledWith(7);
    });

    it('jumps straight to the line without reloading when the file is already open', async () => {
      mockActiveTabId = '/p/notes.md';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleFindInFilesNavigate('/p/notes.md', 3);

      expect(mockState.openTab).not.toHaveBeenCalled();
      expect(mockReadFile).not.toHaveBeenCalled();
      expect(mockState.setScrollToLine).toHaveBeenCalledWith(3);
    });
  });
});
