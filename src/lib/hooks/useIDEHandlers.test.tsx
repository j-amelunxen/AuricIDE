import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SetStateAction } from 'react';
import { CONTEXT_BOUND_COMMANDS, useIDEHandlers } from './useIDEHandlers';
import { type useIDEState } from './useIDEState';
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
const mockOpenExternalUrl = vi.fn();
vi.mock('@/lib/tauri/opener', () => ({
  revealInFileManager: (...args: unknown[]) => mockRevealInFileManager(...args),
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

const mockGetGitDiff = vi.fn();
const mockGetGitDiffCommit = vi.fn();
const mockGetGitDiffFileRef = vi.fn();
const mockDiscardChanges = vi.fn();
vi.mock('@/lib/tauri/git', () => ({
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
  getGitDiffCommit: (...args: unknown[]) => mockGetGitDiffCommit(...args),
  getGitDiffFileRef: (...args: unknown[]) => mockGetGitDiffFileRef(...args),
  discardChanges: (...args: unknown[]) => mockDiscardChanges(...args),
}));

const mockLoadIgnoredRepos = vi.fn(async () => [] as string[]);
const mockSaveIgnoredRepos = vi.fn(async () => {});
vi.mock('@/lib/config/projectConfig', () => ({
  loadIgnoredRepos: (...args: unknown[]) => mockLoadIgnoredRepos(...(args as [])),
  saveIgnoredRepos: (...args: unknown[]) => mockSaveIgnoredRepos(...(args as [])),
}));

// Mock Store
const mockRefreshGitStatus = vi.fn();
const mockStageAll = vi.fn();
const mockUnstageAll = vi.fn();
const mockSetScmView = vi.fn();
const mockLoadFileHistory = vi.fn();
const mockLoadBranches = vi.fn();
const mockLoadCompare = vi.fn();
const mockToggleBlame = vi.fn();
const mockRequestHunkNav = vi.fn();
const mockSetHistorySelectedOid = vi.fn();
let mockHistoryPath: string | null = null;
let mockHistoryCommits: { oid: string; summary: string }[] = [];
let mockCompareRef: string | null = null;
const mockMarkDirty = vi.fn();
const mockUpdateFileInIndex = vi.fn();
const mockShowToast = vi.fn();
const mockSaveGoals = vi.fn();
let mockFileTree: unknown[] = [];
let mockActiveTabId: string | null = null;
let mockFileStatuses: {
  path: string;
  status: string;
  staged: string | null;
  unstaged: string | null;
}[] = [];
// Reactive git-repo fixtures. Most tests never touch these — a single root
// repo at '/p' mirrors the store's old hardcoded `rootPath: '/p'`, and
// `mockFileStatuses` (already used everywhere) feeds that repo's status.
// Tests that need a second/nested repo add it to `mockRepos` and give it its
// own entry in `mockRepoStatuses`.
type MockGitRepoRef = { path: string; relativePath: string; name: string; kind: string };
let mockRepos: MockGitRepoRef[] = [{ path: '/p', relativePath: '', name: 'p', kind: 'root' }];
let mockRepoStatuses: Record<string, typeof mockFileStatuses> = {};
let mockActiveRepoPath: string | null = '/p';
const mockSetActiveRepoPath = vi.fn((path: string | null) => {
  mockActiveRepoPath = path;
});
const mockDiscoverAndRefreshGit = vi.fn(async () => {});
let mockScmView: 'changes' | 'history' | 'compare' = 'changes';
let mockScratchDir: string | null = null;
let mockScratches: { name: string; path: string }[] = [];
const mockInitScratches = vi.fn(async () => {});
const mockRefreshScratches = vi.fn(async () => {});
const mockGetBacklinksFor = vi.fn((_name: string) => [] as string[]);
const mockSetInboxCaptureOpen = vi.fn();
const mockCloseWorkPlace = vi.fn();
const mockDiscardPmChanges = vi.fn();
let mockPmDirty = false;
vi.mock('@/lib/store', () => {
  const getState = () => ({
    refreshGitStatus: mockRefreshGitStatus,
    discoverAndRefreshGit: mockDiscoverAndRefreshGit,
    stageAll: mockStageAll,
    unstageAll: mockUnstageAll,
    setScmView: mockSetScmView,
    loadFileHistory: mockLoadFileHistory,
    loadBranches: mockLoadBranches,
    loadCompare: mockLoadCompare,
    toggleBlame: mockToggleBlame,
    requestHunkNav: mockRequestHunkNav,
    setHistorySelectedOid: mockSetHistorySelectedOid,
    historyPath: mockHistoryPath,
    historyCommits: mockHistoryCommits,
    compareRef: mockCompareRef,
    repos: mockRepos,
    repoStates: Object.fromEntries(
      mockRepos.map((ref) => [
        ref.path,
        {
          ref,
          branchInfo: null,
          fileStatuses: ref.path === '/p' ? mockFileStatuses : (mockRepoStatuses[ref.path] ?? []),
          commitMessage: '',
          isCommitting: false,
          isPushing: false,
        },
      ])
    ),
    activeRepoPath: mockActiveRepoPath,
    setActiveRepoPath: mockSetActiveRepoPath,
    scmView: mockScmView,
    rootPath: '/p',
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
    closeWorkPlace: mockCloseWorkPlace,
    discardPmChanges: mockDiscardPmChanges,
    pmDirty: mockPmDirty,
    openWorkPlace: () => undefined,
    setInboxCaptureOpen: mockSetInboxCaptureOpen,
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
    setDiffTab: vi.fn(),
    resetGitInMemory: vi.fn(),
    closeProject: vi.fn(),
    setActiveActivity: vi.fn(),
    pmDraftTickets: [],
    inboxItems: [] as ReturnType<typeof useIDEState>['inboxItems'],
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
    commit: vi.fn(async () => 'abc123'),
    push: vi.fn(async () => undefined),
    setCommitMessage: vi.fn(),
    repoStates: {} as Record<
      string,
      { branchInfo: { name: string; ahead: number; behind: number } | null }
    >,
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

  /** A minimal `GitRepoState` stub — only `branchInfo` is ever read by these handlers. */
  const repoStateStub = (branchName: string) => ({
    ref: { path: '', relativePath: '', name: '', kind: 'root' as const },
    branchInfo: { name: branchName, ahead: 0, behind: 0 },
    fileStatuses: [],
    commitMessage: '',
    isCommitting: false,
    isPushing: false,
  });

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
    mockRepos = [{ path: '/p', relativePath: '', name: 'p', kind: 'root' }];
    mockState.repos = mockRepos;
    mockLoadIgnoredRepos.mockResolvedValue([]);
    mockSaveIgnoredRepos.mockResolvedValue(undefined);
    mockRepoStatuses = {};
    mockActiveRepoPath = '/p';
    mockScmView = 'changes';
    mockState.repoStates = {};
    mockGetBacklinksFor.mockImplementation(() => []);
    mockState.agentSettings = {
      dangerouslyIgnorePermissions: false,
      autoAcceptEdits: false,
      agenticCommit: false,
      agenticCommitPrompt: 'commit and push. Prefix: {ticket}:',
      branchTicketPattern: '([A-Z]+-\\d+)',
      commitProviderId: undefined,
    };
    mockGetGitDiff.mockReset();
    mockGetGitDiffCommit.mockReset();
    mockGetGitDiffFileRef.mockReset();
    mockHistoryPath = null;
    mockHistoryCommits = [];
    mockCompareRef = null;
    mockPmDirty = false;
  });

  describe('handleDiffFileClick', () => {
    it('stores a separate patch per tab so activating the first still reads A', async () => {
      mockGetGitDiff.mockResolvedValueOnce('patch-a').mockResolvedValueOnce('patch-b');
      const payloads: Record<string, { patch: string; filePath: string }> = {};
      (mockState.setDiffTab as ReturnType<typeof vi.fn>).mockImplementation(
        (tabId: string, state: { patch: string; filePath: string }) => {
          payloads[tabId] = state;
        }
      );

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleDiffFileClick('/repo', 'src/a.ts');
      await result.current.handleDiffFileClick('/repo', 'src/b.ts');

      expect(payloads['diff:unstaged:/repo:src/a.ts']?.patch).toBe('patch-a');
      expect(payloads['diff:unstaged:/repo:src/b.ts']?.patch).toBe('patch-b');

      expect(mockState.openTab).toHaveBeenNthCalledWith(1, {
        id: 'diff:unstaged:/repo:src/a.ts',
        path: 'src/a.ts',
        name: 'a.ts (diff)',
      });
      expect(mockState.openTab).toHaveBeenNthCalledWith(2, {
        id: 'diff:unstaged:/repo:src/b.ts',
        path: 'src/b.ts',
        name: 'b.ts (diff)',
      });

      const activeId = 'diff:unstaged:/repo:src/a.ts';
      expect(payloads[activeId]?.patch).toBe('patch-a');
      expect(payloads[activeId]?.filePath).toBe('src/a.ts');
    });

    it('opens a staged diff when side is staged', async () => {
      mockGetGitDiff.mockResolvedValue('patch-staged');

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleDiffFileClick('/repo', 'src/a.ts', 'staged');

      expect(mockGetGitDiff).toHaveBeenCalledWith('/repo', 'src/a.ts', 'staged');
      expect(mockState.setDiffTab).toHaveBeenCalledWith('diff:staged:/repo:src/a.ts', {
        patch: 'patch-staged',
        filePath: 'src/a.ts',
        source: { kind: 'staged' },
        repoPath: '/repo',
      });
      expect(mockState.openTab).toHaveBeenCalledWith({
        id: 'diff:staged:/repo:src/a.ts',
        path: 'src/a.ts',
        name: 'a.ts (staged)',
      });
    });

    it('opens two distinct tabs for the same relative file in two different repos', async () => {
      mockGetGitDiff.mockResolvedValueOnce('patch-api').mockResolvedValueOnce('patch-web');
      const payloads: Record<string, { patch: string }> = {};
      (mockState.setDiffTab as ReturnType<typeof vi.fn>).mockImplementation(
        (tabId: string, state: { patch: string }) => {
          payloads[tabId] = state;
        }
      );

      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleDiffFileClick('/w/api', 'README.md');
      await result.current.handleDiffFileClick('/w/web', 'README.md');

      expect(payloads['diff:unstaged:/w/api:README.md']?.patch).toBe('patch-api');
      expect(payloads['diff:unstaged:/w/web:README.md']?.patch).toBe('patch-web');
      expect(mockState.openTab).toHaveBeenNthCalledWith(1, {
        id: 'diff:unstaged:/w/api:README.md',
        path: 'README.md',
        name: 'README.md (diff)',
      });
      expect(mockState.openTab).toHaveBeenNthCalledWith(2, {
        id: 'diff:unstaged:/w/web:README.md',
        path: 'README.md',
        name: 'README.md (diff)',
      });
    });
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
        { path: 'docs/ignored.log', status: 'ignored', staged: null, unstaged: null },
        { path: 'docs/notes.md', status: 'modified', staged: null, unstaged: 'modified' },
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
      mockFileStatuses = [{ path: 'build/', status: 'ignored', staged: null, unstaged: null }];
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

    it('forwards createdAt from directory listings onto tree nodes', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockReadDirectory.mockResolvedValue([
        { name: 'fresh.md', path: '/p/fresh.md', isDirectory: false, createdAt: 1_700_000_000_000 },
        {
          name: 'docs',
          path: '/p/docs',
          isDirectory: true,
          newestFileCreatedAt: 1_700_000_000_100,
        },
      ]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefresh('/p', true);

      expect(mockState.setFileTree).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/p/fresh.md', createdAt: 1_700_000_000_000 }),
        expect.objectContaining({
          path: '/p/docs',
          createdAt: undefined,
          newestFileCreatedAt: 1_700_000_000_100,
        }),
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

    it("resolves a nested repo's own folder as bare, while a file inside it resolves against that repo", async () => {
      mockState.rootPath = '/p';
      mockRepos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/p/api', relativePath: 'api', name: 'api', kind: 'nested' },
      ];
      // The outer repo lists the nested repo's directory as untracked — that
      // must not leak onto the folder, which belongs to the inner repo now.
      mockFileStatuses = [
        { path: 'api', status: 'untracked', staged: null, unstaged: 'untracked' },
      ];
      mockRepoStatuses = {
        '/p/api': [
          { path: 'src/index.ts', status: 'modified', staged: null, unstaged: 'modified' },
        ],
      };
      mockReadDirectory.mockResolvedValueOnce([{ name: 'api', path: '/p/api', isDirectory: true }]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefresh('/p', true);

      expect(mockState.setFileTree).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/p/api', gitStatus: undefined }),
      ]);

      mockReadDirectory.mockResolvedValueOnce([
        { name: 'index.ts', path: '/p/api/src/index.ts', isDirectory: false },
      ]);
      await result.current.handleToggleDir('/p/api/src');

      expect(mockState.setDirectoryChildren).toHaveBeenCalledWith('/p/api/src', [
        expect.objectContaining({ path: '/p/api/src/index.ts', gitStatus: 'modified' }),
      ]);
    });
  });

  describe('handleRefreshDirs', () => {
    it('rediscovers repos on a root refresh, but only refreshes status (no rediscovery) for a nested watcher event', async () => {
      mockState.rootPath = '/p';
      mockReadDirectory.mockResolvedValue([]);
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleRefresh('/p', true);
      expect(mockDiscoverAndRefreshGit).toHaveBeenCalledWith('/p');
      expect(mockRefreshGitStatus).not.toHaveBeenCalled();

      mockDiscoverAndRefreshGit.mockClear();
      mockFileTree = [{ path: '/p/src/lib', name: 'lib', isDirectory: true, children: [] }];
      await result.current.handleRefreshDirs(['/p/src/lib']);
      expect(mockRefreshGitStatus).toHaveBeenCalledWith();
      expect(mockDiscoverAndRefreshGit).not.toHaveBeenCalled();
    });

    it('re-reads only the changed directories that are actually loaded', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockFileTree = [
        {
          path: '/p/src',
          name: 'src',
          isDirectory: true,
          children: [{ path: '/p/src/lib', name: 'lib', isDirectory: true, children: [] }],
        },
      ];
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      // '/p/vendor' is not in the tree — nobody is looking at it, and opening
      // it would read it fresh anyway.
      await result.current.handleRefreshDirs(['/p/src/lib', '/p/vendor']);

      expect(mockReadDirectory).toHaveBeenCalledTimes(1);
      expect(mockReadDirectory).toHaveBeenCalledWith('/p/src/lib');
      expect(mockState.setFileTree).not.toHaveBeenCalled();
    });

    it('refreshes git status and the flat file list for a change below the root', async () => {
      // Both answer for the whole project, so a nested change has to renew them
      // just as a root change does — otherwise the explorer keeps colouring
      // from the snapshot taken when the project was opened.
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockFileTree = [{ path: '/p/src/lib', name: 'lib', isDirectory: true, children: [] }];
      mockReadDirectory.mockResolvedValue([]);
      mockListAllFiles.mockResolvedValue(['/p/src/lib/a.ts']);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefreshDirs(['/p/src/lib']);

      expect(mockRefreshGitStatus).toHaveBeenCalledWith();
      expect(mockState.setAllFiles).toHaveBeenCalledWith(['/p/src/lib/a.ts']);
    });

    it('refreshes them once for a burst of changed directories', async () => {
      // A save can touch several folders at once; the project-wide work must
      // not scale with how many.
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockFileTree = [
        { path: '/p/src', name: 'src', isDirectory: true, children: [] },
        { path: '/p/docs', name: 'docs', isDirectory: true, children: [] },
        { path: '/p/e2e', name: 'e2e', isDirectory: true, children: [] },
      ];
      mockReadDirectory.mockResolvedValue([]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefreshDirs(['/p/src', '/p/docs', '/p/e2e']);

      expect(mockReadDirectory).toHaveBeenCalledTimes(3);
      expect(mockRefreshGitStatus).toHaveBeenCalledTimes(1);
      expect(mockListAllFiles).toHaveBeenCalledTimes(1);
    });

    it('colours nested nodes from the refreshed statuses, not the ones in the store when it started', async () => {
      // The nested read paints its nodes from whatever `fileStatuses` holds by
      // the time it builds them, so it has to run behind the refresh rather
      // than beside it. Racing the two looks fine most of the time and leaves
      // the old colours on screen the rest — the failure this whole path
      // exists to prevent, in its hardest-to-reproduce form.
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockFileTree = [{ path: '/p/src/lib', name: 'lib', isDirectory: true, children: [] }];
      mockReadDirectory.mockResolvedValue([
        { name: 'a.ts', path: '/p/src/lib/a.ts', isDirectory: false },
      ]);

      let landGitStatus = () => {};
      mockRefreshGitStatus.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            landGitStatus = () => {
              mockFileStatuses = [
                { path: 'src/lib/a.ts', status: 'modified', staged: null, unstaged: 'modified' },
              ];
              resolve();
            };
          })
      );

      const { result } = renderHook(() => useIDEHandlers(mockState));
      const refreshed = result.current.handleRefreshDirs(['/p/src/lib']);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockReadDirectory).not.toHaveBeenCalled();

      landGitStatus();
      await refreshed;

      expect(mockState.setDirectoryChildren).toHaveBeenCalledWith('/p/src/lib', [
        expect.objectContaining({ path: '/p/src/lib/a.ts', gitStatus: 'modified' }),
      ]);
    });

    it('rebuilds the whole root tree when the root itself changed', async () => {
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      mockFileTree = [];
      mockReadDirectory.mockResolvedValue([
        { name: 'new.md', path: '/p/new.md', isDirectory: false, createdAt: 1_700_000_000_000 },
      ]);
      mockListAllFiles.mockResolvedValue(['/p/new.md']);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefreshDirs(['/p']);

      expect(mockState.setFileTree).toHaveBeenCalledWith([
        expect.objectContaining({ path: '/p/new.md', createdAt: 1_700_000_000_000 }),
      ]);
    });

    it('keeps nested folders expanded and loaded when refreshing their parent', async () => {
      // A refresh must not collapse the tree the user is working in.
      mockState.rootPath = '/p';
      mockFileStatuses = [];
      const grandchild = { path: '/p/src/lib/a.ts', name: 'a.ts', isDirectory: false };
      mockFileTree = [
        {
          path: '/p/src',
          name: 'src',
          isDirectory: true,
          children: [
            {
              path: '/p/src/lib',
              name: 'lib',
              isDirectory: true,
              expanded: true,
              children: [grandchild],
            },
          ],
        },
      ];
      mockReadDirectory.mockResolvedValue([{ name: 'lib', path: '/p/src/lib', isDirectory: true }]);

      const { result } = renderHook(() => useIDEHandlers(mockState));
      await result.current.handleRefreshDirs(['/p/src']);

      expect(mockState.setDirectoryChildren).toHaveBeenCalledWith('/p/src', [
        expect.objectContaining({
          path: '/p/src/lib',
          expanded: true,
          children: [grandchild],
        }),
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

    it('persists a nested repo on Ignore this Git repository and rediscovers', async () => {
      mockState.rootPath = '/p';
      mockLoadIgnoredRepos.mockResolvedValue([]);
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleIgnoreGitRepo('/p/vendor');

      expect(mockSaveIgnoredRepos).toHaveBeenCalledWith('/p', ['vendor']);
      expect(mockDiscoverAndRefreshGit).toHaveBeenCalledWith('/p');
      expect(mockState.showToast).toHaveBeenCalledWith(
        'Ignored "vendor". Undo in Settings → Git.',
        'success'
      );
    });

    it('offers Ignore this Git repository for a nested repo folder', () => {
      mockState.rootPath = '/p';
      mockState.repos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/p/vendor', relativePath: 'vendor', name: 'vendor', kind: 'nested' },
      ];
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'vendor', path: '/p/vendor', isDirectory: true },
      };

      const { result } = renderHook(() => useIDEHandlers(mockState));

      expect(
        result.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Ignore this Git repository'
        )
      ).toBe(true);
    });

    it('hides Ignore this Git repository for the project root and for files', () => {
      mockState.rootPath = '/p';
      mockState.repos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/p/vendor', relativePath: 'vendor', name: 'vendor', kind: 'nested' },
      ];
      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: '', path: '/p', isDirectory: true },
      };
      const { result: rootResult } = renderHook(() => useIDEHandlers(mockState));
      expect(
        rootResult.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Ignore this Git repository'
        )
      ).toBe(false);

      mockState.contextMenu = {
        x: 0,
        y: 0,
        node: { name: 'notes.md', path: '/p/vendor/notes.md', isDirectory: false },
      };
      const { result: fileResult } = renderHook(() => useIDEHandlers(mockState));
      expect(
        fileResult.current.contextMenuOptions.some(
          (o) => 'label' in o && o.label === 'Ignore this Git repository'
        )
      ).toBe(false);
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
    it('spawns an agent that commits locally when agentic commit is on', async () => {
      mockState.repoStates = { '/p': repoStateStub('feature/AUR-42-thing') };
      mockState.agentSettings = {
        ...mockState.agentSettings,
        agenticCommit: true,
        commitProviderId: 'gemini',
      };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit('/p');

      expect(mockState.spawnNewAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'commit:p',
          provider: 'gemini',
          model: 'flash',
          cwd: '/p',
        })
      );
      const task = mockState.spawnNewAgent.mock.calls[0][0].task as string;
      expect(task).toContain('Prefix: AUR-42:');
      expect(task).toMatch(/do not push/i);
      expect(mockState.commit).not.toHaveBeenCalled();
      expect(mockStageAll).not.toHaveBeenCalled();
    });

    it('spawns an agent that also pushes when asked', async () => {
      mockState.repoStates = { '/p': repoStateStub('feature/AUR-42-thing') };
      mockState.agentSettings = {
        ...mockState.agentSettings,
        agenticCommit: true,
        commitProviderId: 'gemini',
      };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit('/p', { push: true });

      const task = mockState.spawnNewAgent.mock.calls[0][0].task as string;
      expect(task).toContain('Prefix: AUR-42:');
      expect(task).toMatch(/push the current branch to origin/i);
      expect(mockState.commit).not.toHaveBeenCalled();
    });

    it('falls back to a plain manual commit when agentic commit is off', async () => {
      mockState.agentSettings = { ...mockState.agentSettings, agenticCommit: false };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit('/p');

      expect(mockState.commit).toHaveBeenCalledWith('/p');
      expect(mockState.spawnNewAgent).not.toHaveBeenCalled();
    });

    it('commits a specific repo (agentic), keyed and run from that repo — never the project root', async () => {
      mockState.repoStates = { '/w/api': repoStateStub('feature/AUR-9-thing') };
      mockState.agentSettings = {
        ...mockState.agentSettings,
        agenticCommit: true,
        commitProviderId: 'gemini',
      };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit('/w/api');

      expect(mockState.spawnNewAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'commit:api',
          cwd: '/w/api',
        })
      );
      const task = mockState.spawnNewAgent.mock.calls[0][0].task as string;
      expect(task).toContain('Prefix: AUR-9:');
      expect(task).toMatch(/do not push/i);
    });

    it('commits a specific repo directly (manual), never the project root', async () => {
      mockState.agentSettings = { ...mockState.agentSettings, agenticCommit: false };
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCommit('/w/api');

      expect(mockState.commit).toHaveBeenCalledWith('/w/api');
    });
  });

  describe('handlePush', () => {
    it('pushes a specific repo, not necessarily the project root', async () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handlePush('/w/api');

      expect(mockState.push).toHaveBeenCalledWith('/w/api');
    });
  });

  describe('handleDiscardFile', () => {
    it('discards a file in a specific repo and closes its tab when it is the active one', async () => {
      mockDiscardChanges.mockResolvedValue(undefined);
      mockReadDirectory.mockResolvedValue([]);
      const openState = { ...mockState, activeTabId: '/w/api/README.md' };
      const { result } = renderHook(() => useIDEHandlers(openState));

      await result.current.handleDiscardFile('/w/api', 'README.md');

      expect(mockDiscardChanges).toHaveBeenCalledWith('/w/api', 'README.md');
      expect(openState.closeTab).toHaveBeenCalledWith('/w/api/README.md');
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

    function FileSelectHarness() {
      const handlers = useIDEHandlers(mockState);
      return (
        <div>
          <button onClick={() => void handlers.handleFileSelect('/project/notes.md')}>Open</button>
          {handlers.confirmDialog}
        </div>
      );
    }

    it('asks before opening a file when Plan is dirty', async () => {
      mockPmDirty = true;
      const user = userEvent.setup();
      render(<FileSelectHarness />);

      await user.click(screen.getByRole('button', { name: 'Open' }));

      expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
      expect(mockState.openTab).not.toHaveBeenCalled();
      expect(mockCloseWorkPlace).not.toHaveBeenCalled();
    });

    it('opens the file and discards Plan after the leave is confirmed', async () => {
      mockPmDirty = true;
      const user = userEvent.setup();
      render(<FileSelectHarness />);

      await user.click(screen.getByRole('button', { name: 'Open' }));
      const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
      await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

      await waitFor(() => expect(mockState.openTab).toHaveBeenCalled());
      expect(mockDiscardPmChanges).toHaveBeenCalled();
      expect(mockCloseWorkPlace).toHaveBeenCalled();
    });

    it('stays in Plan when the leave is declined', async () => {
      mockPmDirty = true;
      const user = userEvent.setup();
      render(<FileSelectHarness />);

      await user.click(screen.getByRole('button', { name: 'Open' }));
      const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument()
      );
      expect(mockState.openTab).not.toHaveBeenCalled();
      expect(mockDiscardPmChanges).not.toHaveBeenCalled();
      expect(mockCloseWorkPlace).not.toHaveBeenCalled();
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

    it('unstages every staged file for git.unstage-all', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.unstage-all')!.action();

      expect(mockUnstageAll).toHaveBeenCalledWith('/p');
    });

    it('stage-all/unstage-all/commit act on activeRepoPath, not necessarily the first repo', () => {
      mockRepos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/p/api', relativePath: 'api', name: 'api', kind: 'nested' },
      ];
      mockActiveRepoPath = '/p/api';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.stage-all')!.action();

      expect(mockStageAll).toHaveBeenCalledWith('/p/api');
    });

    it('stage-all does nothing when several repos are open and none is designated active', () => {
      mockRepos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/p/api', relativePath: 'api', name: 'api', kind: 'nested' },
      ];
      mockActiveRepoPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.stage-all')!.action();

      expect(mockStageAll).not.toHaveBeenCalled();
    });

    it("targets the active tab's repo over activeRepoPath, since activeRepoPath can move as a side effect of viewing another file's history", () => {
      mockRepos = [
        { path: '/w/api', relativePath: 'api', name: 'api', kind: 'root' },
        { path: '/w/web', relativePath: 'web', name: 'web', kind: 'root' },
      ];
      mockActiveRepoPath = '/w/api';
      mockActiveTabId = '/w/web/README.md';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.stage-all')!.action();

      expect(mockStageAll).toHaveBeenCalledWith('/w/web');
    });

    it('git.file-history focuses source control and loads the active file', () => {
      mockActiveTabId = '/p/src/a.ts';
      mockHistoryPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.file-history')!.action();

      expect(mockState.setActiveActivity).toHaveBeenCalledWith('source-control');
      expect(mockSetScmView).toHaveBeenCalledWith('history');
      expect(mockLoadFileHistory).toHaveBeenCalledWith('/p', 'src/a.ts');
    });

    it('git.file-history follows the active tab even when a historyPath is already known', () => {
      // The active tab now governs — a previously loaded history no longer
      // "sticks" once the user has moved to a different file.
      mockActiveTabId = '/p/src/a.ts';
      mockHistoryPath = 'docs/readme.md';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.file-history')!.action();

      expect(mockLoadFileHistory).toHaveBeenCalledWith('/p', 'src/a.ts');
    });

    it('git.file-history falls back to the known historyPath when the active tab has no resolvable file', () => {
      mockActiveTabId = 'diff:unstaged:src/a.ts';
      mockHistoryPath = 'docs/readme.md';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.file-history')!.action();

      expect(mockLoadFileHistory).toHaveBeenCalledWith('/p', 'docs/readme.md');
    });

    it('git.file-history does not load for a diff tab when no history path is set', () => {
      mockActiveTabId = 'diff:unstaged:src/a.ts';
      mockHistoryPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.file-history')!.action();

      expect(mockSetScmView).toHaveBeenCalledWith('history');
      expect(mockLoadFileHistory).not.toHaveBeenCalled();
    });

    it('git.compare-with-branch focuses source control and loads branches', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.compare-with-branch')!.action();

      expect(mockState.setActiveActivity).toHaveBeenCalledWith('source-control');
      expect(mockSetScmView).toHaveBeenCalledWith('compare');
      expect(mockLoadBranches).toHaveBeenCalledWith('/p');
    });

    it('git.toggle-blame flips blame visibility', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.toggle-blame')!.action();

      expect(mockToggleBlame).toHaveBeenCalled();
    });

    it('git.next-hunk and git.prev-hunk request hunk navigation', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'git.next-hunk')!.action();
      result.current.commands.find((c) => c.id === 'git.prev-hunk')!.action();

      expect(mockRequestHunkNav).toHaveBeenCalledWith('next');
      expect(mockRequestHunkNav).toHaveBeenCalledWith('prev');
    });

    it('handleHistoryCommitClick opens a revision diff tab for activeRepoPath', async () => {
      mockActiveRepoPath = '/repo';
      mockHistoryPath = 'src/a.ts';
      mockHistoryCommits = [{ oid: 'abc123def456', summary: 'fix the thing' }];
      mockGetGitDiffCommit.mockResolvedValue('rev-patch');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleHistoryCommitClick('abc123def456');

      expect(mockGetGitDiffCommit).toHaveBeenCalledWith('/repo', 'abc123def456', 'src/a.ts');
      expect(mockState.setDiffTab).toHaveBeenCalledWith('diff:rev:abc123def456:/repo:src/a.ts', {
        patch: 'rev-patch',
        filePath: 'src/a.ts',
        source: { kind: 'revision', oid: 'abc123def456', summary: 'fix the thing' },
        repoPath: '/repo',
      });
      expect(mockState.openTab).toHaveBeenCalledWith({
        id: 'diff:rev:abc123def456:/repo:src/a.ts',
        path: 'src/a.ts',
        name: 'a.ts @ abc123d',
      });
      expect(mockSetHistorySelectedOid).toHaveBeenCalledWith('abc123def456');
    });

    it('handleCompareFileClick opens a ref diff tab for activeRepoPath', async () => {
      mockActiveRepoPath = '/repo';
      mockCompareRef = 'feature';
      mockGetGitDiffFileRef.mockResolvedValue('ref-patch');
      const { result } = renderHook(() => useIDEHandlers(mockState));

      await result.current.handleCompareFileClick('src/a.ts');

      expect(mockGetGitDiffFileRef).toHaveBeenCalledWith('/repo', 'feature', 'src/a.ts');
      expect(mockState.setDiffTab).toHaveBeenCalledWith(
        `diff:ref:${encodeURIComponent('feature')}:/repo:src/a.ts`,
        {
          patch: 'ref-patch',
          filePath: 'src/a.ts',
          source: { kind: 'ref', ref: 'feature' },
          repoPath: '/repo',
        }
      );
      expect(mockState.openTab).toHaveBeenCalledWith({
        id: `diff:ref:${encodeURIComponent('feature')}:/repo:src/a.ts`,
        path: 'src/a.ts',
        name: 'a.ts ↔ feature',
      });
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

  describe('activity rail', () => {
    it('closes Work when the project is closed', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));
      result.current.handleCloseProject();
      expect(mockCloseWorkPlace).toHaveBeenCalled();
    });

    it('hides project-bound rail items when no project is open', () => {
      mockState.rootPath = null;
      const { result } = renderHook(() => useIDEHandlers(mockState));

      expect(result.current.itemsWithBadge.map((i) => i.id)).toEqual([
        'notifications',
        'inbox',
        'scratches',
        'extensions',
        'settings',
      ]);
    });

    it('keeps the full rail when a project is open', () => {
      mockState.rootPath = '/repos/alpha';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      expect(result.current.itemsWithBadge.map((i) => i.id)).toEqual([
        'cockpit',
        'explorer',
        'source-control',
        'work',
        'notifications',
        'inbox',
        'outline',
        'scratches',
        'graph',
        'qa',
        'blueprints',
        'extensions',
        'settings',
      ]);
    });
  });

  describe('inbox', () => {
    const makeInboxItem = (
      id: string,
      projectPath: string | null
    ): (typeof mockState)['inboxItems'][number] => ({
      id,
      title: 'Task',
      notes: '',
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
      projectPath,
      projectName: projectPath ? 'alpha' : null,
      ticketId: projectPath ? 't1' : null,
      assignedAt: projectPath ? '2026-01-01 00:00:00' : null,
      dismissedAt: null,
      priority: 'normal',
      dueDate: null,
    });

    it('badges the inbox rail item with the unsorted count only', () => {
      mockState.inboxItems = [
        makeInboxItem('a', null),
        makeInboxItem('b', null),
        makeInboxItem('c', '/repos/alpha'),
      ];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      const inboxItem = result.current.itemsWithBadge.find((i) => i.id === 'inbox');

      expect(inboxItem?.badge).toBe(2);
    });

    it('leaves the inbox badge unset when nothing is unsorted', () => {
      mockState.inboxItems = [];
      const { result } = renderHook(() => useIDEHandlers(mockState));

      const inboxItem = result.current.itemsWithBadge.find((i) => i.id === 'inbox');

      expect(inboxItem?.badge).toBeUndefined();
    });

    it('opens the capture overlay for the inbox.capture command', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'inbox.capture')!.action();

      expect(mockSetInboxCaptureOpen).toHaveBeenCalledWith(true);
    });

    it('switches to the inbox rail item for the view.inbox command', () => {
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.commands.find((c) => c.id === 'view.inbox')!.action();

      expect(mockState.setActiveActivity).toHaveBeenCalledWith('inbox');
    });
  });

  describe('handleActiveRepoChange', () => {
    it('reloads branches for the picked repo while the Compare view is open', () => {
      mockScmView = 'compare';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleActiveRepoChange('/w/web');

      expect(mockSetActiveRepoPath).toHaveBeenCalledWith('/w/web');
      expect(mockLoadBranches).toHaveBeenCalledWith('/w/web');
    });

    it('only switches the active repo while the Changes view is open — nothing to reload', () => {
      mockScmView = 'changes';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleActiveRepoChange('/w/web');

      expect(mockSetActiveRepoPath).toHaveBeenCalledWith('/w/web');
      expect(mockLoadBranches).not.toHaveBeenCalled();
      expect(mockLoadFileHistory).not.toHaveBeenCalled();
    });

    it('does not follow the active tab while the History view is open — a manual pick must stick', () => {
      // If a picker change routed through editorHistoryPath (as showFileHistory
      // and handleScmViewChange('history') do), it would immediately re-point
      // activeRepoPath at whatever repo the active tab belongs to, undoing the
      // very pick the user just made.
      mockScmView = 'history';
      mockActiveTabId = '/p/src/a.ts';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleActiveRepoChange('/w/web');

      expect(mockSetActiveRepoPath).toHaveBeenCalledWith('/w/web');
      expect(mockSetActiveRepoPath).not.toHaveBeenCalledWith('/p');
      expect(mockLoadFileHistory).not.toHaveBeenCalled();
    });

    it('does not load history when the active tab belongs to a different repo than the one just picked', () => {
      // The tab still points at /p — picking /w/web must not load history
      // for a file that isn't even in that repo.
      mockScmView = 'history';
      mockActiveTabId = '/p/src/a.ts';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleActiveRepoChange('/w/web');

      expect(mockLoadFileHistory).not.toHaveBeenCalled();
    });

    it("loads the active tab's file history when the tab already belongs to the newly picked repo", () => {
      // History was left empty by the plain repo-switch case above; when the
      // active tab already lives in the picked repo there is somewhere to go
      // instead of stranding the user on an empty list.
      mockScmView = 'history';
      mockRepos = [
        { path: '/p', relativePath: '', name: 'p', kind: 'root' },
        { path: '/w/web', relativePath: 'web', name: 'web', kind: 'root' },
      ];
      mockActiveTabId = '/w/web/src/a.ts';
      const { result } = renderHook(() => useIDEHandlers(mockState));

      result.current.handleActiveRepoChange('/w/web');

      expect(mockLoadFileHistory).toHaveBeenCalledWith('/w/web', 'src/a.ts');
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
