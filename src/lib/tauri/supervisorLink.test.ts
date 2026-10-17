import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import fixtures from '../agents/supervisorLink.fixtures.json';
import {
  supervisorLinkJobsUsage,
  supervisorLinkPolicyEffective,
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  supervisorLinkProposalDecide,
  supervisorLinkProposals,
  type StoredLinkPolicy,
} from './supervisorLink';

const POLICY: StoredLinkPolicy = {
  defaults: fixtures.resolution.defaults,
  projects: { '/work/project-a': { documentTypes: [], jobKinds: [] } },
  jobs: { dailyLimit: 20, perProjectDailyLimit: null },
};

describe('supervisor link Tauri API', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('reads and writes the stored policy under `policy`', async () => {
    mockInvoke.mockResolvedValue(POLICY);
    await expect(supervisorLinkPolicyGet()).resolves.toEqual(POLICY);
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_policy_get');

    await expect(supervisorLinkPolicySet(POLICY)).resolves.toEqual(POLICY);
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_policy_set', { policy: POLICY });
  });

  it('reads the effective policy, the job counter and the proposals', async () => {
    mockInvoke.mockResolvedValue({});
    await supervisorLinkPolicyEffective();
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_policy_effective');
    await supervisorLinkJobsUsage();
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_jobs_usage');
    await supervisorLinkProposals();
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_proposals');
  });

  it('decides a proposal by id and passes the outcome through', async () => {
    mockInvoke.mockResolvedValue('applied');
    await expect(supervisorLinkProposalDecide('p-1', 'apply')).resolves.toBe('applied');
    expect(mockInvoke).toHaveBeenLastCalledWith('supervisor_link_proposal_decide', {
      proposalId: 'p-1',
      decision: 'apply',
    });
  });

  it('passes Rust’s refusal on unchanged', async () => {
    const refusal = 'the policy changed since the proposal was made';
    mockInvoke.mockImplementation(() => {
      throw refusal;
    });
    const caught = await supervisorLinkProposalDecide('p-1', 'discard').catch((e: unknown) => e);
    expect(caught).toBe(refusal);
    mockInvoke.mockReset();
  });
});
