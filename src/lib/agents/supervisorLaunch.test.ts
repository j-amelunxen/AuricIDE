import { describe, expect, it, vi } from 'vitest';
import {
  defaultSupervisorProjectPolicy,
  emptySupervisorPolicy,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';
import controlFixtures from './agentControl.fixtures.json';

vi.mock('@/lib/tauri/providerPolicy', () => ({ projectProviderPolicyGet: vi.fn() }));

import { projectProviderPolicyGet } from '@/lib/tauri/providerPolicy';
import {
  newestRunningSupervisor,
  readProjectProviderPolicies,
  runningSupervisors,
  supervisorUsingRunDir,
  supervisorSpawnConfig,
  supervisorWithKey,
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

describe('runningSupervisors', () => {
  it('lists every supervisor that still runs, newest first, and skips stopped ones and workers', () => {
    const agents = [
      agent('w', { startedAt: 9 }),
      agent('old', { role: 'supervisor', status: 'idle', startedAt: 8 }),
      agent('first', { role: 'supervisor', status: 'running', startedAt: 1 }),
      agent('second', { role: 'supervisor', status: 'queued', startedAt: 5 }),
    ];
    expect(runningSupervisors(agents).map((a) => a.id)).toEqual(['second', 'first']);
    expect(newestRunningSupervisor(agents)?.id).toBe('second');
  });

  it('breaks a tie on the start time by list order, later entry first', () => {
    const agents = [
      agent('a', { role: 'supervisor', startedAt: 3 }),
      agent('b', { role: 'supervisor', startedAt: 3 }),
    ];
    expect(runningSupervisors(agents).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('finds none when only stopped supervisors are listed', () => {
    const agents = [agent('old', { role: 'supervisor', status: 'error' })];
    expect(runningSupervisors(agents)).toEqual([]);
    expect(newestRunningSupervisor(agents)).toBeUndefined();
  });
});

describe('supervisorUsingRunDir', () => {
  const folder = '/home/me/.auric/supervisors/2026-10-16_185017';

  it('names the live supervisor working in that run folder', () => {
    const agents = [
      agent('other', {
        role: 'supervisor',
        repoPath: '/home/me/.auric/supervisors/2026-10-17_090000',
      }),
      agent('live', { role: 'supervisor', repoPath: `${folder}/` }),
    ];
    expect(supervisorUsingRunDir(agents, folder)?.id).toBe('live');
  });

  it('agrees with the run_dir_in_use fixture cases Rust is tested against', () => {
    const { live, cases } = controlFixtures.supervisors.runDirInUse;
    const agents = live.map((entry) =>
      agent(entry.id, {
        role: entry.role as AgentInfo['role'],
        repoPath: entry.repoPath,
        spawnedByAgentId: entry.spawnedByAgentId,
      })
    );
    for (const { name, resumeRunDir, expected } of cases) {
      expect(supervisorUsingRunDir(agents, resumeRunDir) ? 'run_dir_in_use' : 'ok', name).toBe(
        expected
      );
    }
  });

  it('ignores a stopped supervisor and a worker in that folder', () => {
    const agents = [
      agent('done', { role: 'supervisor', status: 'idle', repoPath: folder }),
      agent('worker', { repoPath: folder }),
    ];
    expect(supervisorUsingRunDir(agents, folder)).toBeUndefined();
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

  it('asks Rust for the earlier run folder and tells the supervisor to catch up on it', () => {
    const input = {
      policy: policyWith({
        '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      providers: [CLAUDE],
      projectPolicies: {},
      descriptions: {},
    };
    const fresh = supervisorSpawnConfig(input);
    expect(fresh?.resumeRunDir).toBeUndefined();
    expect(fresh?.task).not.toContain('## Picking up an earlier run');

    const resumed = supervisorSpawnConfig({
      ...input,
      resumeRunDir: '/home/me/.auric/supervisors/2026-10-16_185017',
    });
    expect(resumed?.resumeRunDir).toBe('/home/me/.auric/supervisors/2026-10-16_185017');
    expect(resumed?.task).toContain('## Picking up an earlier run');
    expect(resumed?.task).toContain('2026-10-16_185017');
  });

  describe('for a Project Manager', () => {
    const input = {
      policy: policyWith({
        '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      providers: [CLAUDE],
      projectPolicies: {},
      descriptions: {},
    };
    const record = {
      key: 'release-desk',
      name: 'Release Desk',
      runDir: '2026-10-21_090000',
      promotedAt: '2026-10-22T10:15:00Z',
      archivedAt: null,
      lastLaunch: null,
    };
    const memory = {
      concepts: {},
      deprecated: 0,
      newestChangeMs: null,
      findings: [
        {
          source: 'layout' as const,
          code: 'missing_field',
          path: 'facts/a.md',
          message: 'no title',
        },
      ],
      okf: 'ok' as const,
      checkedAt: null,
      lastSession: null,
    };
    const launchFor = (over = {}) => ({ record, instructions: 'Be brief.', memory, ...over });

    it('runs under the manager name and key, with the manager sections in the prompt', () => {
      const config = supervisorSpawnConfig({ ...input, manager: launchFor() });
      expect(config).toMatchObject({ name: 'Release Desk', supervisorKey: 'release-desk' });
      expect(config?.task).toContain('## You are the Project Manager "Release Desk"');
      expect(config?.task).toContain('Be brief.');
      expect(config?.task).toContain('- facts/a.md: no title');
    });

    describe('with a model of its own', () => {
      const withModel = (model: string | undefined, providers = [CLAUDE]) =>
        supervisorSpawnConfig({ ...input, providers, model, manager: launchFor() });

      it('runs on a model the provider offers', () => {
        expect(withModel('haiku')?.model).toBe('haiku');
      });

      it('drops a model the provider no longer offers and uses the default', () => {
        expect(withModel('retired-model')?.model).toBe('opus');
      });

      it('keeps the name of a provider that lists no models at all unchecked', () => {
        const bare = { ...CLAUDE, models: [] };
        expect(withModel('anything', [bare])?.model).toBe('anything');
      });

      it('keeps the model when the provider list could not be read', () => {
        expect(withModel('haiku', [])?.model).toBe('haiku');
      });

      it('does not second-guess the model of a plain supervisor skill', () => {
        const config = supervisorSpawnConfig({ ...input, model: 'retired-model' });
        expect(config?.model).toBe('retired-model');
      });
    });

    it('resumes the folder it was given, and never uses the generic resume text', () => {
      const resumeRunDir = '/home/me/.auric/supervisors/2026-10-21_090000';
      const config = supervisorSpawnConfig({ ...input, resumeRunDir, manager: launchFor() });
      expect(config?.resumeRunDir).toBe(resumeRunDir);
      expect(config?.task).not.toContain('## Picking up an earlier run');
      expect(config?.task).toContain('## Picking up where you left off');
    });

    it('leaves the folder to Rust when launched by key alone', () => {
      expect(supervisorSpawnConfig({ ...input, manager: launchFor() })).not.toHaveProperty(
        'resumeRunDir'
      );
    });

    it('starts without a memory check when the summary could not be read', () => {
      const config = supervisorSpawnConfig({ ...input, manager: launchFor({ memory: null }) });
      expect(config?.task).not.toContain('## Memory check');
      expect(config?.task).not.toContain('No okf check runs');
    });

    it('tells the manager when okf cannot check its memory here', () => {
      const config = supervisorSpawnConfig({
        ...input,
        manager: launchFor({ memory: { ...memory, okf: 'missing' as const } }),
      });
      expect(config?.task).toContain('No okf check runs on this machine');
    });

    it('is a plain supervisor without a manager', () => {
      const config = supervisorSpawnConfig(input);
      expect(config).toMatchObject({ name: 'Supervisor' });
      expect(config).not.toHaveProperty('supervisorKey');
    });
  });

  it('tells the supervisor which CLI tools the policy approves', () => {
    const policy = policyWith({
      '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
    });
    policy.tools = { umi: { dirs: [] } };
    const config = supervisorSpawnConfig({
      policy,
      providers: [CLAUDE],
      projectPolicies: {},
      descriptions: {},
    });
    expect(config?.task).toContain('## Tools');
    expect(config?.task).toContain('`umi`');
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

  it('supports provider override and omits chrome for non-claude providers', () => {
    const policy = policyWith({
      '/work/project-a': { ...defaultSupervisorProjectPolicy(), allowed: true },
    });
    policy.supervisor = {
      provider: 'claude',
      chrome: true,
      model: null,
      providers: ['claude', 'codex'],
    };
    const config = supervisorSpawnConfig({
      policy,
      providers: [CLAUDE, CODEX],
      projectPolicies: {},
      descriptions: {},
      provider: 'codex',
      instructions: 'Use bash and python.',
    });
    expect(config?.provider).toBe('codex');
    expect(config?.model).toBe('gpt-luna');
    // Chrome integration prompt section should NOT be present when running on Codex even if policy.supervisor.chrome is true
    expect(config?.task).not.toContain('Claude in Chrome');
    expect(config?.task).toContain('Use bash and python.');
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

describe('supervisorWithKey', () => {
  const keyed = (id: string, extra: Partial<AgentInfo> = {}) =>
    agent(id, { role: 'supervisor', status: 'running', supervisorKey: 'release-desk', ...extra });

  it('finds the running supervisor holding the key', () => {
    expect(
      supervisorWithKey([keyed('a'), agent('b', { role: 'supervisor' })], 'release-desk')?.id
    ).toBe('a');
  });

  it('ignores a finished supervisor, whose key is free again', () => {
    expect(supervisorWithKey([keyed('a', { status: 'idle' })], 'release-desk')).toBeUndefined();
  });

  it('ignores a worker that carries the key', () => {
    expect(supervisorWithKey([keyed('a', { role: 'worker' })], 'release-desk')).toBeUndefined();
  });

  it('knows no supervisor for another key', () => {
    expect(supervisorWithKey([keyed('a')], 'other')).toBeUndefined();
  });
});
