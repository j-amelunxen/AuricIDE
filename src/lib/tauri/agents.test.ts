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

  describe('recordAgentPromptHistory', () => {
    it('calls invoke with projectPath and entry', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      const { recordAgentPromptHistory } = await import('./agents');
      const entry = {
        id: 'h1',
        prompt: 'Fix bug',
        agentName: 'Writer',
        model: 'm',
        provider: 'claude',
        cwd: '/repo',
        source: 'ui',
      };
      await recordAgentPromptHistory('/my/project', entry);
      expect(mockInvoke).toHaveBeenCalledWith('agent_prompt_history_add', {
        projectPath: '/my/project',
        entry,
      });
    });
  });

  describe('listAgentPromptHistory', () => {
    it('calls invoke with projectPath and null limit by default', async () => {
      mockInvoke.mockResolvedValueOnce([]);
      const { listAgentPromptHistory } = await import('./agents');
      const result = await listAgentPromptHistory('/my/project');
      expect(result).toEqual([]);
      expect(mockInvoke).toHaveBeenCalledWith('agent_prompt_history_list', {
        projectPath: '/my/project',
        limit: null,
      });
    });

    it('passes limit when given', async () => {
      const entries = [{ id: 'h1', prompt: 'p', createdAt: '2026-07-10 00:00:00' }];
      mockInvoke.mockResolvedValueOnce(entries);
      const { listAgentPromptHistory } = await import('./agents');
      const result = await listAgentPromptHistory('/my/project', 10);
      expect(result).toEqual(entries);
      expect(mockInvoke).toHaveBeenCalledWith('agent_prompt_history_list', {
        projectPath: '/my/project',
        limit: 10,
      });
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
