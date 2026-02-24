import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

import { startMcp, stopMcp, mcpStatus } from './mcp';

describe('MCP IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startMcp', () => {
    it('calls invoke with project path', async () => {
      mockInvoke.mockResolvedValueOnce({ status: 'running', pid: 1234 });
      const result = await startMcp('/my/project');
      expect(result).toEqual({ status: 'running', pid: 1234 });
      expect(mockInvoke).toHaveBeenCalledWith('start_mcp', { projectPath: '/my/project' });
    });
  });

  describe('stopMcp', () => {
    it('calls invoke with stop_mcp command', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await stopMcp();
      expect(mockInvoke).toHaveBeenCalledOnce();
      expect(mockInvoke.mock.calls[0][0]).toBe('stop_mcp');
    });
  });

  describe('mcpStatus', () => {
    it('returns status info', async () => {
      mockInvoke.mockResolvedValueOnce({ status: 'stopped', pid: null });
      const result = await mcpStatus();
      expect(result).toEqual({ status: 'stopped', pid: null });
      expect(mockInvoke).toHaveBeenCalledOnce();
      expect(mockInvoke.mock.calls[0][0]).toBe('mcp_status');
    });
  });
});
