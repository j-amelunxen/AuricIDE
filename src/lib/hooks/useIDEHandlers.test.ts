import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIDEHandlers } from './useIDEHandlers';

// Mock Tauri FS
const mockReadDirectory = vi.fn();
const mockOpenFolderDialog = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockCreateDirectory = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  openFolderDialog: () => mockOpenFolderDialog(),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
}));

// Mock Store
const mockRefreshGitStatus = vi.fn();
let mockFileTree: unknown[] = [];
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      refreshGitStatus: mockRefreshGitStatus,
      fileStatuses: [],
      activeTabId: null,
      fileTree: mockFileTree,
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
  } as unknown as Parameters<typeof useIDEHandlers>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshGitStatus.mockResolvedValue([]);
    mockState.rootPath = null;
    mockFileTree = [];
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
});
