import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import { projectProviderPolicyGet } from './providerPolicy';

describe('project provider policy Tauri API', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('asks Rust for one project by path and hands back its policy', async () => {
    mockInvoke.mockResolvedValue({ allow: null, deny: ['codex'] });

    await expect(projectProviderPolicyGet('/work/project-a')).resolves.toEqual({
      allow: null,
      deny: ['codex'],
    });
    expect(mockInvoke).toHaveBeenCalledWith('project_provider_policy_get', {
      projectPath: '/work/project-a',
    });
  });
});
