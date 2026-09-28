import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
const mockListen = vi.fn().mockResolvedValue(vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { watchDirectory, unwatchDirectory, onFsChange, type FsChangeEvent } from './watcher';

describe('watcher IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  describe('watchDirectory', () => {
    it('calls invoke with correct command and args', async () => {
      await watchDirectory('/project');
      expect(mockInvoke).toHaveBeenCalledWith('watch_directory', { path: '/project' });
    });

    it('handles browser-mode gracefully when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Not in Tauri'));
      await expect(watchDirectory('/project')).rejects.toThrow('Not in Tauri');
    });
  });

  describe('unwatchDirectory', () => {
    it('calls invoke with correct command and args', async () => {
      await unwatchDirectory('/project');
      expect(mockInvoke).toHaveBeenCalledWith('unwatch_directory', { path: '/project' });
    });

    it('handles browser-mode gracefully when invoke throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Not in Tauri'));
      await expect(unwatchDirectory('/project')).rejects.toThrow('Not in Tauri');
    });
  });

  describe('onFsChange', () => {
    it('listens to the batched file-events', async () => {
      onFsChange(vi.fn());
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith('file-events', expect.any(Function));
      });
    });

    it('returns an unsubscribe function', () => {
      const unsubscribe = onFsChange(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('hands every event of a batch to the callback, in order', async () => {
      const callback = vi.fn();
      const batch: FsChangeEvent[] = [
        { path: '/project/a.md', kind: 'Modify(Data(Content))', exists: true },
        { path: '/project/b.md', kind: 'Remove(File)', exists: false },
      ];

      mockListen.mockImplementation(
        (_eventName: string, handler: (event: { payload: FsChangeEvent[] }) => void) => {
          handler({ payload: batch });
          return Promise.resolve(vi.fn());
        }
      );

      onFsChange(callback);

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledTimes(2);
      });
      expect(callback.mock.calls.map((c) => c[0])).toEqual(batch);
    });

    it('invokes unlisten when unsubscribe is called', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const unsubscribe = onFsChange(vi.fn());

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });
      // Small delay to let the .then chain complete
      await new Promise((r) => setTimeout(r, 0));

      unsubscribe();
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });
});
