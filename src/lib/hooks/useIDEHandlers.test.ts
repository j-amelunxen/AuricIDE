import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIDEHandlers } from './useIDEHandlers';

// Mock Tauri FS
const mockReadDirectory = vi.fn();
const mockOpenFolderDialog = vi.fn();
const mockReadFile = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  openFolderDialog: () => mockOpenFolderDialog(),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: vi.fn(),
}));

// Mock Store
const mockRefreshGitStatus = vi.fn();
vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      refreshGitStatus: mockRefreshGitStatus,
      fileStatuses: [],
      activeTabId: null,
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
    selectFile: vi.fn(),
    openTab: vi.fn(),
    setEditorContent: vi.fn(),
    setImageData: vi.fn(),
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
  });

  it('opens README.md automatically when opening a folder', async () => {
    const selectedPath = '/path/to/project';
    mockOpenFolderDialog.mockResolvedValue(selectedPath);
    mockReadDirectory.mockResolvedValue([
      { name: 'README.md', path: `${selectedPath}/README.md`, isDirectory: false },
      { name: 'src', path: `${selectedPath}/src`, isDirectory: true },
    ]);
    mockReadFile.mockResolvedValue('# Hello README');

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenFolder();

    // Verify root path was set
    expect(mockState.setRootPath).toHaveBeenCalledWith(selectedPath);

    // Verify handleFileSelect was called for README.md
    // handleFileSelect calls state.selectFile and state.openTab
    expect(mockState.selectFile).toHaveBeenCalledWith(`${selectedPath}/README.md`);
    expect(mockState.openTab).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `${selectedPath}/README.md`,
      })
    );
  });

  it('opens README.md automatically when opening a recent project', async () => {
    const projectPath = '/path/to/recent';
    mockReadDirectory.mockResolvedValue([
      { name: 'readme.txt', path: `${projectPath}/readme.txt`, isDirectory: false },
    ]);
    mockReadFile.mockResolvedValue('Hello README txt');

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenRecent(projectPath);

    expect(mockState.setRootPath).toHaveBeenCalledWith(projectPath);
    expect(mockState.selectFile).toHaveBeenCalledWith(`${projectPath}/readme.txt`);
  });

  it('does not open anything if README does not exist', async () => {
    const projectPath = '/path/to/no-readme';
    mockReadDirectory.mockResolvedValue([
      { name: 'main.rs', path: `${projectPath}/main.rs`, isDirectory: false },
    ]);

    const { result } = renderHook(() => useIDEHandlers(mockState));

    await result.current.handleOpenRecent(projectPath);

    expect(mockState.setRootPath).toHaveBeenCalledWith(projectPath);
    expect(mockState.selectFile).not.toHaveBeenCalled();
  });
});
