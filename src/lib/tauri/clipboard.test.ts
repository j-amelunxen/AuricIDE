import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard, copyViaExecCommand, readClipboardText } from './clipboard';

// Mock Tauri invoke helper
vi.mock('./invoke', () => ({
  invoke: vi.fn(),
}));

import { invoke } from './invoke';

describe('clipboard utility', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
    document.execCommand = originalExecCommand;
  });

  describe('copyToClipboard', () => {
    it('uses native Tauri IPC clipboard_write_text when available', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);
      const writeText = vi.fn();
      Object.assign(navigator, { clipboard: { writeText } });

      const result = await copyToClipboard('/path/to/project');

      expect(invoke).toHaveBeenCalledWith('clipboard_write_text', { text: '/path/to/project' });
      expect(result).toBe(true);
      // Native IPC succeeded, web API should not be called
      expect(writeText).not.toHaveBeenCalled();
    });

    it('falls back to navigator.clipboard.writeText when Tauri IPC is unavailable', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        new Error('Tauri IPC is unavailable (clipboard_write_text)')
      );
      const writeText = vi.fn().mockResolvedValueOnce(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const result = await copyToClipboard('/path/to/project');

      expect(invoke).toHaveBeenCalledWith('clipboard_write_text', { text: '/path/to/project' });
      expect(writeText).toHaveBeenCalledWith('/path/to/project');
      expect(result).toBe(true);
    });

    it('attempts window.focus when document.hasFocus is false before writeText', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      const writeText = vi.fn().mockResolvedValueOnce(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
      const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);

      const result = await copyToClipboard('/focused/path');

      expect(focusSpy).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledWith('/focused/path');
      expect(result).toBe(true);

      focusSpy.mockRestore();
      hasFocusSpy.mockRestore();
    });

    it('falls back to execCommand when navigator.clipboard.writeText fails', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      const writeText = vi.fn().mockRejectedValueOnce(new Error('Document is not focused'));
      Object.assign(navigator, { clipboard: { writeText } });

      const execCommand = vi.fn().mockReturnValue(true);
      document.execCommand = execCommand;

      const result = await copyToClipboard('/fallback/path');

      expect(writeText).toHaveBeenCalledWith('/fallback/path');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(result).toBe(true);
    });

    it('falls back to execCommand when navigator.clipboard is undefined', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      Object.assign(navigator, { clipboard: undefined });

      const execCommand = vi.fn().mockReturnValue(true);
      document.execCommand = execCommand;

      const result = await copyToClipboard('/fallback/path');

      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(result).toBe(true);
    });

    it('returns false when all strategies fail without throwing', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      const writeText = vi.fn().mockRejectedValueOnce(new Error('Permission denied'));
      Object.assign(navigator, { clipboard: { writeText } });

      document.execCommand = vi.fn().mockReturnValue(false);

      const result = await copyToClipboard('/fail/path');

      expect(result).toBe(false);
    });
  });

  describe('copyViaExecCommand', () => {
    it('creates and cleans up a textarea element in document.body', () => {
      const execCommand = vi.fn().mockReturnValue(true);
      document.execCommand = execCommand;

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      const result = copyViaExecCommand('secret-value');

      expect(result).toBe(true);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it('returns false when execCommand throws an error', () => {
      document.execCommand = vi.fn().mockImplementation(() => {
        throw new Error('execCommand disabled');
      });

      const result = copyViaExecCommand('error-value');
      expect(result).toBe(false);
    });
  });

  describe('readClipboardText', () => {
    it('uses native Tauri IPC clipboard_read_text when available', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('from native pasteboard');

      const text = await readClipboardText();

      expect(invoke).toHaveBeenCalledWith('clipboard_read_text');
      expect(text).toBe('from native pasteboard');
    });

    it('falls back to navigator.clipboard.readText when Tauri IPC is unavailable', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      const readText = vi.fn().mockResolvedValueOnce('from web pasteboard');
      Object.assign(navigator, { clipboard: { readText } });

      const text = await readClipboardText();

      expect(readText).toHaveBeenCalled();
      expect(text).toBe('from web pasteboard');
    });

    it('returns empty string when all read methods fail', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC unavailable'));
      const readText = vi.fn().mockRejectedValueOnce(new Error('Read denied'));
      Object.assign(navigator, { clipboard: { readText } });

      const text = await readClipboardText();
      expect(text).toBe('');
    });
  });
});
