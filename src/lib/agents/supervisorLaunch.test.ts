import { describe, expect, it, vi } from 'vitest';
import {
  defaultSupervisorProjectPolicy,
  emptySupervisorPolicy,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';

vi.mock('@/lib/tauri/providerPolicy', () => ({ projectProviderPolicyGet: vi.fn() }));

import { projectProviderPolicyGet } from '@/lib/tauri/providerPolicy';
import {
  findRunningSupervisor,
  readProjectProviderPolicies,
  supervisorSpawnConfig,
} from './supervisorLaunch';

const CLAUDE: ProviderInfo = {
  id: 'claude',
  name: 'Claude Code',
  models: [
    { value: 'opus', label: 'Opus', rank: 3 },
    { value: 'haiku', label: 'Haiku', rank: 1 },
  ],
  permissionModes: [],
  defaultModel: 'opus',
  defaultPermissionMode: 'default',
};
const CODEX: ProviderInfo = {
  id: 'codex',
  name: 'Codex',
  models: [{ value: 'gpt-luna', label: 'Luna', rank: 1 }],
  permissionModes: [],
  defaultModel: 'gpt-luna',
  defaultPermissionMode: 'default',
};

function policyWith(projects: SupervisorPolicy['projects']): SupervisorPolicy {
  return { ...emptySupervisorPolicy(), projects };
}

const agent = (id: string, extra: Partial<AgentInfo>): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  ...extra,
});

describe('findRunningSupervisor', () => {
  it('finds a supervisor that still runs and ignores stopped ones and workers', () => {
    expect(
      findRunningSupervisor([
        agent('w', {}),
        agent('old', { role: 'supervisor', status: 'idle' }),
        agent('s', { role: 'supervisor', status: 'running' }),
      ])?.id
    ).toBe('s');
    expect(findRunningSupervisor([agent('old', { role: 'supervisor', status: 'error' })])).toBe(
      undefined
    );
  });
});

describe('supervisorSpawnConfig', () => {
  it('returns null when the policy shows no project', () => {
    expect(
      supervisorSpawnConfig({
        policy: policyWith({ '/work/project-a': defaultSupervisorProjectPolicy() }),
        providers: [CLAUDE],
        projectPolicies: {},
        descriptions: {},
      })
    ).toBeNull();
  });

  it('builds a supervisor spawn on the policy model with the generated prompt', () => {
    const policy = policyWith({
      '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
    });
    policy.supervisor = { provider: 'claude', model: 'haiku', chrome: false };
    const config = supervisorSpawnConfig({
      policy,
      providers: [CLAUDE, CODEX],
      projectPolicies: { '/work/project-a': { allow: null, deny: ['codex'] } },
      descriptions: { '/work/project-a': 'Sample project' },
    });
    expect(config).toMatchObject({
      name: 'Supervisor',
      role: 'supervisor',
      provider: 'claude',
      model: 'haiku',
      headless: false,
      projectPath: null,
      runSource: 'ui',
      historyPrompt: '',
    });
    expect(config?.task).toContain('/work/project-a');
    expect(config?.task).toContain('Sample project');
    // The project's own policy denies Codex, so the prompt never offers it.
    expect(config?.task).not.toContain('gpt-luna');
  });

  it("passes the human's standing instructions into the prompt", () => {
    const config = supervisorSpawnConfig({
      policy: policyWith({
        '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      providers: [CLAUDE],
      projectPolicies: {},
      descriptions: {},
      instructions: 'Always answer in German.',
    });
    expect(config?.task).toContain('## Instructions from the human');
    expect(config?.task).toMatch(/they win\.[^#]*\n\nAlways answer in German\.$/);
  });

  it('leaves out a provider that would run without asking', () => {
    const agy: ProviderInfo = {
      id: 'agy',
      name: 'Antigravity',
      models: [{ value: 'agy-model', label: 'Agy model', rank: 2 }],
      permissionModes: [{ value: 'auto', label: 'Auto', description: '', unattended: true }],
      defaultModel: 'agy-model',
      defaultPermissionMode: 'auto',
    };
    const config = supervisorSpawnConfig({
      policy: policyWith({
        '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      providers: [CLAUDE, agy],
      projectPolicies: {},
      descriptions: {},
    });
    expect(config?.task).toContain('haiku');
    expect(config?.task).not.toContain('agy-model');
  });

  it("falls back to the provider's default model when the policy names none", () => {
    const config = supervisorSpawnConfig({
      policy: policyWith({
        '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      providers: [CLAUDE],
      projectPolicies: {},
      descriptions: {},
    });
    expect(config?.model).toBe('opus');
  });
});

describe('readProjectProviderPolicies', () => {
  it('reads each project that answers and leaves out the ones that do not', async () => {
    vi.mocked(projectProviderPolicyGet).mockImplementation(async (path: string) => {
      if (path === '/work/closed') return { allow: ['claude'], deny: [] };
      throw new Error('Tauri IPC is unavailable (project_provider_policy_get)');
    });
    const policies = await readProjectProviderPolicies(['/work/closed', '/work/no-backend']);
    expect(policies).toEqual({ '/work/closed': { allow: ['claude'], deny: [] } });
  });
});
