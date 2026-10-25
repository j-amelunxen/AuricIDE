import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import type { IDEState } from './liveIDEState';
import { useFileMutations } from './useFileMutations';

const fs = vi.hoisted(() => ({
  exists: vi.fn(async (_path: string) => false),
  movePath: vi.fn(async (_from: string, _to: string) => {}),
  copyFile: vi.fn(async (_from: string, _to: string) => {}),
  deleteFile: vi.fn(async (_path: string) => {}),
}));
vi.mock('@/lib/tauri/fs', () => ({
  ...fs,
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

const store = vi.hoisted(() => ({
  openTabs: [] as { id: string; path: string; name: string }[],
  closeTab: vi.fn(),
}));
vi.mock('@/lib/store', () => ({
  useStore: { getState: () => store },
}));

function makeState() {
  return {
    showToast: vi.fn(),
    renamePath: vi.fn(),
    setSelectedPaths: vi.fn(),
    selectFile: vi.fn(),
    setSelectionAnchor: vi.fn(),
  };
}

type Answer = 'replace' | 'keep-both' | 'cancel';

function setup(answers: Answer[] = []) {
  const state = makeState();
  const refresh = vi.fn(async () => {});
  // Plays the dialog: "Keep Both" is the secondary action, which still resolves true.
  const confirm = vi.fn(async (request: ConfirmRequest) => {
    const answer = answers.shift() ?? 'cancel';
    if (answer === 'keep-both') request.onSecondary?.();
    return answer !== 'cancel';
  });
  const flush = vi.fn(async () => {});
  const { result } = renderHook(() =>
    useFileMutations(state as unknown as IDEState, null, refresh, vi.fn(), confirm, flush)
  );
  return { state, refresh, confirm, flush, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.exists.mockImplementation(async () => false);
  store.openTabs = [];
});

describe('moving dropped rows into a folder', () => {
  it('moves every item, re-points open tabs and keeps the moved items selected', async () => {
    const { state, refresh, flush, result } = setup();
    await act(() => result.current.handleMoveNodes(['/p/a.md', '/p/src'], '/p/docs'));

    expect(flush).toHaveBeenCalledBefore(fs.movePath);
    expect(fs.movePath.mock.calls).toEqual([
      ['/p/a.md', '/p/docs/a.md'],
      ['/p/src', '/p/docs/src'],
    ]);
    expect(state.renamePath.mock.calls).toEqual([
      ['/p/a.md', '/p/docs/a.md'],
      ['/p/src', '/p/docs/src'],
    ]);
    expect(state.setSelectedPaths).toHaveBeenCalledWith(['/p/docs/a.md', '/p/docs/src']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a folder moved into itself and says so', async () => {
    const { state, result } = setup();
    await act(() => result.current.handleMoveNodes(['/p/src'], '/p/src/lib'));

    expect(fs.movePath).not.toHaveBeenCalled();
    expect(state.showToast).toHaveBeenCalledWith('A folder cannot be moved into itself', 'error');
  });

  it('asks before replacing an item with the same name, and leaves it on "Cancel"', async () => {
    fs.exists.mockImplementation(async (p) => p === '/p/docs/a.md');
    const { confirm, state, result } = setup(['cancel']);
    await act(() => result.current.handleMoveNodes(['/p/a.md', '/p/b.md'], '/p/docs'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({
      title: 'Replace "a.md"?',
      confirmLabel: 'Replace',
      secondaryLabel: 'Keep Both',
    });
    expect(fs.deleteFile).not.toHaveBeenCalled();
    // The clash is skipped, the rest still moves.
    expect(fs.movePath.mock.calls).toEqual([['/p/b.md', '/p/docs/b.md']]);
    expect(state.renamePath).toHaveBeenCalledTimes(1);
  });

  it('replaces the existing item on "Replace" and closes its tabs first', async () => {
    fs.exists.mockImplementation(async (p) => p === '/p/docs/a.md');
    store.openTabs = [
      { id: '/p/docs/a.md', path: '/p/docs/a.md', name: 'a.md' },
      { id: '/p/other.md', path: '/p/other.md', name: 'other.md' },
    ];
    const { result } = setup(['replace']);
    await act(() => result.current.handleMoveNodes(['/p/a.md'], '/p/docs'));

    expect(store.closeTab).toHaveBeenCalledWith('/p/docs/a.md');
    expect(store.closeTab).not.toHaveBeenCalledWith('/p/other.md');
    expect(fs.deleteFile).toHaveBeenCalledWith('/p/docs/a.md');
    expect(fs.deleteFile).toHaveBeenCalledBefore(fs.movePath);
    expect(fs.movePath).toHaveBeenCalledWith('/p/a.md', '/p/docs/a.md');
  });

  it('keeps both on "Keep Both", under the next free numbered name', async () => {
    fs.exists.mockImplementation(async (p) => p === '/p/docs/a.md' || p === '/p/docs/a 2.md');
    const { result } = setup(['keep-both']);
    await act(() => result.current.handleMoveNodes(['/p/a.md'], '/p/docs'));

    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(fs.movePath).toHaveBeenCalledWith('/p/a.md', '/p/docs/a 3.md');
  });

  it('never replaces a folder that holds the item being moved', async () => {
    // Moving /p/x/x up into /p, where /p/x (its own parent) already exists.
    fs.exists.mockImplementation(async (p) => p === '/p/x');
    const { confirm, state, result } = setup(['replace']);
    await act(() => result.current.handleMoveNodes(['/p/x/x'], '/p'));

    expect(confirm).not.toHaveBeenCalled();
    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(fs.movePath).not.toHaveBeenCalled();
    expect(state.showToast).toHaveBeenCalledWith(
      expect.stringContaining('contains an item being moved'),
      'error'
    );
  });

  it('shows the backend error and keeps tabs and selection when a move fails', async () => {
    fs.movePath.mockRejectedValueOnce('Permission denied');
    const { state, refresh, result } = setup();
    await act(() => result.current.handleMoveNodes(['/p/a.md'], '/p/docs'));

    expect(state.showToast).toHaveBeenCalledWith('Permission denied', 'error');
    expect(state.renamePath).not.toHaveBeenCalled();
    expect(state.setSelectedPaths).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('copying files dropped from Finder', () => {
  it('copies into the folder and touches no tab', async () => {
    const { state, flush, result } = setup();
    await act(() => result.current.handleDropExternalPaths(['/Users/dev/report.pdf'], '/p/docs'));

    expect(fs.copyFile).toHaveBeenCalledWith('/Users/dev/report.pdf', '/p/docs/report.pdf');
    expect(fs.movePath).not.toHaveBeenCalled();
    // A pending autosave of a replaced file would land over the copy.
    expect(flush).toHaveBeenCalledBefore(fs.copyFile);
    expect(state.renamePath).not.toHaveBeenCalled();
    expect(state.setSelectedPaths).toHaveBeenCalledWith(['/p/docs/report.pdf']);
  });

  it('asks on a name clash before overwriting', async () => {
    fs.exists.mockImplementation(async () => true);
    const { confirm, result } = setup(['cancel']);
    await act(() => result.current.handleDropExternalPaths(['/Users/dev/report.pdf'], '/p/docs'));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fs.deleteFile).not.toHaveBeenCalled();
    expect(fs.copyFile).not.toHaveBeenCalled();
  });
});
