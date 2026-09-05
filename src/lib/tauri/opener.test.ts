import { describe, expect, it, vi, beforeEach } from 'vitest';
import { openExternalUrl, revealInFileManager } from './opener';

const mockOpenUrl = vi.fn();
const mockRevealItemInDir = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
  revealItemInDir: (...args: unknown[]) => mockRevealItemInDir(...args),
}));

const mockCopyToClipboard = vi.fn();
vi.mock('./clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

describe('opener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openExternalUrl', () => {
    it('opens url using plugin-opener when available', async () => {
      mockOpenUrl.mockResolvedValueOnce(undefined);

      await openExternalUrl('https://example.com');

      expect(mockOpenUrl).toHaveBeenCalledWith('https://example.com');
      expect(mockCopyToClipboard).not.toHaveBeenCalled();
    });

    it('falls back to copyToClipboard when openUrl throws', async () => {
      mockOpenUrl.mockRejectedValueOnce(new Error('Plugin failed'));
      mockCopyToClipboard.mockResolvedValueOnce(true);

      await expect(openExternalUrl('https://example.com')).rejects.toThrow(
        'Could not open the browser. Link copied to clipboard instead.'
      );
      expect(mockCopyToClipboard).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('revealInFileManager', () => {
    it('calls revealItemInDir with the specified path', async () => {
      mockRevealItemInDir.mockResolvedValueOnce(undefined);

      await revealInFileManager('/path/to/item');

      expect(mockRevealItemInDir).toHaveBeenCalledWith('/path/to/item');
    });
  });
});
