import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('crashlog IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reportFrontendCrash', () => {
    it('calls invoke with correct command and error payload', async () => {
      mockInvoke.mockResolvedValueOnce('/logs/crashes/crash-123.log');
      const { reportFrontendCrash } = await import('./crashlog');
      const error = {
        message: 'Test error',
        source: 'app.js',
        lineno: 10,
        colno: 5,
        stack: 'Error: Test\n    at foo',
        componentStack: null,
        errorType: 'frontend_onerror',
      };
      const result = await reportFrontendCrash(error);
      expect(result).toBe('/logs/crashes/crash-123.log');
      expect(mockInvoke).toHaveBeenCalledWith('report_frontend_crash', { error });
    });
  });

  describe('error propagation', () => {
    it('throws when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('IPC failed'));
      const { reportFrontendCrash } = await import('./crashlog');
      await expect(
        reportFrontendCrash({
          message: 'Test error',
          source: null,
          lineno: null,
          colno: null,
          stack: null,
          componentStack: null,
          errorType: 'frontend_onerror',
        })
      ).rejects.toThrow('IPC failed');
    });
  });
});
