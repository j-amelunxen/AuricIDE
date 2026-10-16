import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import fixtures from '../config/supervisorPolicy.fixtures.json';
import type { SupervisorPolicy } from '../config/supervisorPolicy';
import { supervisorPolicyGet, supervisorPolicySet } from './supervisorPolicy';

describe('supervisor policy Tauri API', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('reads the policy and what Rust dropped from it', async () => {
    const state = fixtures.parse.find(
      (c) => c.name === 'a relative project path is dropped, the others stay'
    )!.expected;
    mockInvoke.mockResolvedValue(state);

    await expect(supervisorPolicyGet()).resolves.toEqual(state);
    expect(mockInvoke).toHaveBeenCalledWith('supervisor_policy_get');
  });

  it('hands the whole policy to Rust under `policy`', async () => {
    const stored = fixtures.parse.find((c) => c.name === 'a full valid file')!.expected;
    mockInvoke.mockResolvedValue(stored);
    const policy = stored.policy as SupervisorPolicy;

    await expect(supervisorPolicySet(policy)).resolves.toEqual(stored);

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith('supervisor_policy_set', { policy });
  });
});
