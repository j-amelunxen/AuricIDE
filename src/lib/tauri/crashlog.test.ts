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

  describe('listCrashLogs', () => {
    it('calls invoke and returns entries', async () => {
      const entries = [
        { filename: 'crash-2000.log', timestamp: 2000, sizeBytes: 512 },
        { filename: 'crash-1000.log', timestamp: 1000, sizeBytes: 256 },
      ];
      mockInvoke.mockResolvedValueOnce(entries);
      const { listCrashLogs } = await import('./crashlog');
      const result = await listCrashLogs();
      expect(result).toEqual(entries);
      expect(mockInvoke).toHaveBeenCalledWith('list_crash_logs', undefined);
    });
  });

  describe('readCrashLog', () => {
    it('calls invoke with filename and returns content', async () => {
      const content = '=== AuricIDE Crash Report ===\nType: rust_panic';
      mockInvoke.mockResolvedValueOnce(content);
      const { readCrashLog } = await import('./crashlog');
      const result = await readCrashLog('crash-12345.log');
      expect(result).toBe(content);
      expect(mockInvoke).toHaveBeenCalledWith('read_crash_log', { filename: 'crash-12345.log' });
    });
  });

  describe('error propagation', () => {
    it('throws when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('IPC failed'));
      const { listCrashLogs } = await import('./crashlog');
      await expect(listCrashLogs()).rejects.toThrow('IPC failed');
    });
  });
});
