import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

const mockDiffFiles = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/compare', () => ({
  diffFiles: (...args: unknown[]) => mockDiffFiles(...args),
}));

import { openFileComparison } from './compareFiles';

const ID = 'diff:files:%2Fp%2Fsrc%2Fa.ts:%2Fp%2Flib%2Fb.ts';

describe('openFileComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ rootPath: '/p', diffByTabId: {}, openTabs: [], activeTabId: null });
  });

  it('opens a tab named by both files and stores the patch from the backend', async () => {
    mockDiffFiles.mockResolvedValue('--- a/a.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n');

    await openFileComparison('/p/src/a.ts', '/p/lib/b.ts');

    expect(mockDiffFiles).toHaveBeenCalledWith('/p/src/a.ts', '/p/lib/b.ts');
    const state = useStore.getState();
    expect(state.diffByTabId[ID]).toEqual({
      patch: '--- a/a.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n',
      filePath: 'src/a.ts ↔ lib/b.ts',
      source: { kind: 'files', left: '/p/src/a.ts', right: '/p/lib/b.ts' },
      repoPath: '',
    });
    expect(state.openTabs).toEqual([
      expect.objectContaining({ id: ID, path: 'src/a.ts ↔ lib/b.ts', name: 'a.ts ↔ b.ts' }),
    ]);
    expect(state.activeTabId).toBe(ID);
  });

  it('opens an identical pair with an empty patch', async () => {
    mockDiffFiles.mockResolvedValue('');

    await openFileComparison('/p/src/a.ts', '/p/lib/b.ts');

    expect(useStore.getState().diffByTabId[ID].patch).toBe('');
  });

  it('shows the backend error as a toast and opens no tab', async () => {
    mockDiffFiles.mockRejectedValue('logo.png looks like a binary file and cannot be compared.');

    await openFileComparison('/p/src/a.ts', '/p/lib/b.ts');

    const state = useStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.diffByTabId).toEqual({});
    expect(state.toasts).toEqual([
      expect.objectContaining({
        message: 'logo.png looks like a binary file and cannot be compared.',
        variant: 'error',
      }),
    ]);
  });
});
