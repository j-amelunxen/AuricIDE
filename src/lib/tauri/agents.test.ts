import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('agent IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkCliStatus', () => {
    it('calls invoke with null providerId by default', async () => {
      mockInvoke.mockResolvedValueOnce(true);
      const { checkCliStatus } = await import('./agents');
      const result = await checkCliStatus();
      expect(result).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('check_cli_status', { providerId: null });
    });

    it('passes providerId when given', async () => {
      mockInvoke.mockResolvedValueOnce(false);
      const { checkCliStatus } = await import('./agents');
      const result = await checkCliStatus('gemini');
      expect(result).toBe(false);
      expect(mockInvoke).toHaveBeenCalledWith('check_cli_status', { providerId: 'gemini' });
    });
  });

  describe('spawnAgent', () => {
    it('calls invoke with correct arguments', async () => {
      const agent = { id: '1', name: 'Test', status: 'idle', model: 'm', provider: 'claude' };
      mockInvoke.mockResolvedValueOnce(agent);

      const { spawnAgent } = await import('./agents');
      const result = await spawnAgent({ name: 'Test', model: 'm', task: 't' });

      expect(result).toEqual(agent);
      expect(mockInvoke).toHaveBeenCalledWith('spawn_agent', {
        config: { name: 'Test', model: 'm', task: 't' },
      });
    });

    it('throws when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('fail'));
      const { spawnAgent } = await import('./agents');
      await expect(spawnAgent({ name: 'T', model: 'm', task: 't' })).rejects.toThrow('fail');
    });
  });

  describe('killAgent', () => {
    it('calls invoke with agent id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      const { killAgent } = await import('./agents');
      await killAgent('agent-1');
      expect(mockInvoke).toHaveBeenCalledWith('kill_agent', { agentId: 'agent-1' });
    });
  });

  describe('killAgentsForRepo', () => {
    it('calls invoke correctly', async () => {
      mockInvoke.mockResolvedValueOnce(5);
      const { killAgentsForRepo } = await import('./agents');
      const result = await killAgentsForRepo('/my/repo');
      expect(result).toBe(5);
      expect(mockInvoke).toHaveBeenCalledWith('kill_agents_for_repo', { repoPath: '/my/repo' });
    });
  });

  describe('listAgents', () => {
    it('returns agent list from invoke', async () => {
      const agents = [{ id: '1', name: 'A1', status: 'idle', model: 'm', provider: 'claude' }];
      mockInvoke.mockResolvedValueOnce(agents);
      const { listAgents } = await import('./agents');
      const result = await listAgents();
      expect(result).toEqual(agents);
      expect(mockInvoke).toHaveBeenCalledWith('list_agents', undefined);
    });
  });
});
