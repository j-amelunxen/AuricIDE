import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockInvoke(cmd, args),
}));

import { PREFS_SEEDED_KEY, installPrefMirror, syncSharedPrefs } from './sharedPrefs';

/**
 * WebKit gives the dev binary and the bundled app separate `localStorage`
 * stores — different data store, different page origin — so a theme picked in
 * one was invisible to the other. The backend file is the shared ground; this
 * module is what keeps the two webviews standing on it.
 */
describe('shared webview preferences', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  describe('sync at startup', () => {
    /**
     * The first launch of an origin is the migration: whatever the user has
     * built up locally travels up into the shared file, or the other build
     * would present itself as a fresh install.
     */
    it('offers the local entries for adoption on the first run of an origin', async () => {
      localStorage.setItem('auric.theme', 'ember');
      mockInvoke.mockResolvedValue({ 'auric.theme': 'ember' });

      await syncSharedPrefs();

      expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_sync', {
        local: { 'auric.theme': 'ember' },
      });
    });

    it('marks the origin as seeded so the migration happens once', async () => {
      mockInvoke.mockResolvedValue({});

      await syncSharedPrefs();

      expect(localStorage.getItem(PREFS_SEEDED_KEY)).toBe('1');
    });

    it('adopts the stored value over the local one', async () => {
      localStorage.setItem('auric.theme', 'ember');
      mockInvoke.mockResolvedValue({ 'auric.theme': 'aurora' });

      await syncSharedPrefs();

      expect(localStorage.getItem('auric.theme')).toBe('aurora');
    });

    /**
     * Once an origin is seeded the file is the whole truth, absences included —
     * otherwise a preference cleared in one build would be handed back by the
     * other on its next start and never stay gone.
     */
    it('stops offering local entries once seeded, and drops what the file no longer has', async () => {
      localStorage.setItem(PREFS_SEEDED_KEY, '1');
      localStorage.setItem('auric.theme', 'ember');
      mockInvoke.mockResolvedValue({});

      await syncSharedPrefs();

      expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_sync', { local: {} });
      expect(localStorage.getItem('auric.theme')).toBeNull();
    });

    it('does not mirror the values it just adopted back to the backend', async () => {
      uninstall = installPrefMirror();
      mockInvoke.mockResolvedValue({ 'auric.theme': 'aurora' });

      await syncSharedPrefs();

      expect(mockInvoke).not.toHaveBeenCalledWith('webview_prefs_set', expect.anything());
    });

    it('leaves the local values in place when there is no backend to reach', async () => {
      localStorage.setItem('auric.theme', 'ember');
      mockInvoke.mockRejectedValue(new Error('not a tauri window'));

      await expect(syncSharedPrefs()).resolves.toBeUndefined();

      expect(localStorage.getItem('auric.theme')).toBe('ember');
    });
  });

  /**
   * The mirror never blocks the webview's own write, so every assertion here
   * waits for the call it fired off rather than reading it back synchronously.
   */
  describe('mirroring writes', () => {
    it('sends a write through to the backend and still stores it locally', async () => {
      uninstall = installPrefMirror();
      mockInvoke.mockResolvedValue(undefined);

      localStorage.setItem('auric.theme', 'aurora');

      expect(localStorage.getItem('auric.theme')).toBe('aurora');
      await vi.waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_set', {
          key: 'auric.theme',
          value: 'aurora',
        })
      );
    });

    it('sends a removal through to the backend', async () => {
      localStorage.setItem('auric.theme', 'aurora');
      uninstall = installPrefMirror();
      mockInvoke.mockResolvedValue(undefined);

      localStorage.removeItem('auric.theme');

      expect(localStorage.getItem('auric.theme')).toBeNull();
      await vi.waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_remove', { key: 'auric.theme' })
      );
    });

    it('clears every mirrored key when the webview clears its storage', async () => {
      localStorage.setItem('a', '1');
      localStorage.setItem('b', '2');
      uninstall = installPrefMirror();
      mockInvoke.mockResolvedValue(undefined);

      localStorage.clear();

      expect(localStorage.length).toBe(0);
      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_remove', { key: 'a' });
        expect(mockInvoke).toHaveBeenCalledWith('webview_prefs_remove', { key: 'b' });
      });
    });

    /**
     * The marker records what this origin has already done, not something the
     * user chose — sharing it would tell the other build it had been seeded
     * when it never had, and its local profile would be dropped unmigrated.
     */
    it('keeps the seeded marker out of the shared file', async () => {
      uninstall = installPrefMirror();
      mockInvoke.mockResolvedValue(undefined);

      localStorage.setItem(PREFS_SEEDED_KEY, '1');
      await Promise.resolve();

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('mirrors a write once even if installed twice', async () => {
      uninstall = installPrefMirror();
      const second = installPrefMirror();
      mockInvoke.mockResolvedValue(undefined);

      localStorage.setItem('auric.theme', 'aurora');

      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
      second();
    });

    it('restores the untouched storage methods when uninstalled', () => {
      const original = localStorage.setItem;
      const stop = installPrefMirror();

      stop();

      expect(localStorage.setItem).toBe(original);
    });

    it('keeps the local write when the backend rejects it', async () => {
      uninstall = installPrefMirror();
      mockInvoke.mockRejectedValue(new Error('store is full'));

      localStorage.setItem('auric.theme', 'aurora');
      await Promise.resolve();

      expect(localStorage.getItem('auric.theme')).toBe('aurora');
    });
  });
});
