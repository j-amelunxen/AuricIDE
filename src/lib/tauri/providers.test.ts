import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('provider IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listProviders', () => {
    it('calls invoke with list_providers', async () => {
      const providers = [
        {
          id: 'claude',
          name: 'Claude Code',
          models: [{ value: 'sonnet', label: 'Sonnet' }],
          permissionModes: [],
          defaultModel: 'sonnet',
          defaultPermissionMode: 'acceptEdits',
        },
      ];
      mockInvoke.mockResolvedValueOnce(providers);

      const { listProviders } = await import('./providers');
      const result = await listProviders();

      expect(result).toEqual(providers);
      expect(mockInvoke).toHaveBeenCalledWith('list_providers', undefined);
    });
  });

  describe('getPromptTemplate', () => {
    it('calls invoke with get_prompt_template and extracts template', async () => {
      mockInvoke.mockResolvedValueOnce({ template: 'claude --model sonnet -p "' });

      const { getPromptTemplate } = await import('./providers');
      const result = await getPromptTemplate();

      expect(result).toBe('claude --model sonnet -p "');
      expect(mockInvoke).toHaveBeenCalledWith('get_prompt_template', { providerId: null });
    });

    it('passes providerId when given', async () => {
      mockInvoke.mockResolvedValueOnce({ template: 'gemini -p "' });

      const { getPromptTemplate } = await import('./providers');
      const result = await getPromptTemplate('gemini');

      expect(result).toBe('gemini -p "');
      expect(mockInvoke).toHaveBeenCalledWith('get_prompt_template', { providerId: 'gemini' });
    });
  });

  describe('FALLBACK_CRUSH_PROVIDER', () => {
    it('has correct id and defaults', async () => {
      const { FALLBACK_CRUSH_PROVIDER } = await import('./providers');
      expect(FALLBACK_CRUSH_PROVIDER.id).toBe('crush');
      expect(FALLBACK_CRUSH_PROVIDER.models.length).toBe(2);
      expect(FALLBACK_CRUSH_PROVIDER.permissionModes.length).toBe(2);
      expect(FALLBACK_CRUSH_PROVIDER.defaultModel).toBe('auto');
      expect(FALLBACK_CRUSH_PROVIDER.defaultPermissionMode).toBe('default');
    });
  });
});
