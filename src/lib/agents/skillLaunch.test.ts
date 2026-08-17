import { describe, expect, it } from 'vitest';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { resolveSkillLaunch } from './skillLaunch';

const provider = (id: string, model: string, mode: string): ProviderInfo => ({
  id,
  name: id,
  models: [{ value: model, label: model }],
  permissionModes: [{ value: mode, label: mode, description: '' }],
  defaultModel: model,
  defaultPermissionMode: mode,
});

const PROVIDERS = [provider('alpha', 'alpha-fast', 'default'), provider('beta', 'beta-1', 'plan')];

describe('resolveSkillLaunch', () => {
  it('uses the pinned provider, model and permission mode', () => {
    expect(
      resolveSkillLaunch(
        { providerId: 'beta', model: 'beta-1', permissionMode: 'acceptEdits' },
        PROVIDERS
      )
    ).toEqual({ provider: 'beta', model: 'beta-1', permissionMode: 'acceptEdits' });
  });

  it("falls back to the provider's own defaults for what the skill left open", () => {
    expect(resolveSkillLaunch({ providerId: 'beta' }, PROVIDERS)).toEqual({
      provider: 'beta',
      model: 'beta-1',
      permissionMode: 'plan',
    });
  });

  it('uses the first provider when the skill pins none', () => {
    expect(resolveSkillLaunch({}, PROVIDERS).provider).toBe('alpha');
  });

  // The pinned harness is not installed on this machine. Starting under
  // another one is still better than not starting — but its model name and
  // permission mode belonged to the harness that is gone.
  it('drops the pinned model and permission mode when the provider is gone', () => {
    expect(
      resolveSkillLaunch(
        { providerId: 'gamma', model: 'gamma-xl', permissionMode: 'bypassPermissions' },
        PROVIDERS
      )
    ).toEqual({ provider: 'alpha', model: 'alpha-fast', permissionMode: 'default' });
  });

  it('falls back to the built-in provider when the machine offers none', () => {
    const resolved = resolveSkillLaunch({}, []);
    expect(resolved.provider).toBe('crush');
    expect(resolved.model).toBe('auto');
  });
});
