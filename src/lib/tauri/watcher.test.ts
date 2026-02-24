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
    it('sets up event listener via listen with file-event', async () => {
      onFsChange(vi.fn());
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith('file-event', expect.any(Function));
      });
    });

    it('returns an unsubscribe function', () => {
      const unsubscribe = onFsChange(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('calls callback with event payload when event fires', async () => {
      const callback = vi.fn();
      const event: FsChangeEvent = { path: '/project/file.md', kind: 'modify' };

      mockListen.mockImplementation(
        (_eventName: string, handler: (event: { payload: FsChangeEvent }) => void) => {
          handler({ payload: event });
          return Promise.resolve(vi.fn());
        }
      );

      onFsChange(callback);

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(event);
      });
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
