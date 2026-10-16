import { describe, expect, it } from 'vitest';
import fixtures from './supervisorPolicy.fixtures.json';
import controlFixtures from '../agents/agentControl.fixtures.json';
import type { ProviderPolicy } from './providerPolicy';
import {
  checkSupervisorSpawn,
  defaultSupervisorProjectPolicy,
  emptySupervisorPolicy,
  effectivePermissionMode,
  permissionModesOf,
  pmServerNames,
  runsUnattended,
  parseSupervisorPolicy,
  SUPERVISOR_DENIED_REASON_TEXT,
  SUPERVISOR_PARSE_REASONS,
  visibleProjects,
  type OfferedModels,
  type ProviderPermissionModes,
  type SupervisorPolicy,
  type SupervisorSpawnContext,
  type SupervisorSpawnRequest,
} from './supervisorPolicy';

// The three loops below are the contract itself. src-tauri/src/supervisor/policy.rs
// runs the same cases over the same file; a case that passes here and fails
// there (or the other way round) is the drift this file exists to catch.
describe('supervisor policy — shared contract', () => {
  describe('parse', () => {
    for (const testCase of fixtures.parse) {
      it(testCase.name, () => {
        expect(parseSupervisorPolicy(testCase.raw)).toEqual(testCase.expected);
      });
    }
  });

  describe('visibleProjects', () => {
    for (const testCase of fixtures.visibleProjects) {
      it(testCase.name, () => {
        expect(
          visibleProjects(
            testCase.policy as SupervisorPolicy,
            testCase.projectPolicies as Record<string, ProviderPolicy>,
            testCase.offeredModels as unknown as OfferedModels,
            ('permissionModes' in testCase
              ? testCase.permissionModes
              : {}) as ProviderPermissionModes
          )
        ).toEqual(testCase.expected);
      });
    }
  });

  describe('checkSpawn', () => {
    for (const testCase of fixtures.checkSpawn) {
      it(testCase.name, () => {
        const context: SupervisorSpawnContext = {
          projectPolicy: testCase.projectPolicy as ProviderPolicy,
          offeredModels: testCase.offeredModels as unknown as OfferedModels,
          running: testCase.running as SupervisorSpawnContext['running'],
          permissionModes: ('permissionModes' in testCase
            ? testCase.permissionModes
            : {}) as ProviderPermissionModes,
        };
        expect(
          checkSupervisorSpawn(
            testCase.policy as SupervisorPolicy,
            testCase.request as SupervisorSpawnRequest,
            context
          )
        ).toEqual(testCase.expected);
      });
    }
  });
});

describe('pmServerNames', () => {
  for (const testCase of fixtures.pmServerNames) {
    it(testCase.name, () => {
      expect(pmServerNames(testCase.paths)).toEqual(testCase.expected);
    });
  }
});

describe('supervisor policy — fixture coverage', () => {
  const reasonKeys = (group: Record<string, unknown>) =>
    Object.keys(group).filter((key) => key !== '_comment');

  it('has a reason text for every key in checkOrder, and nothing more', () => {
    expect(reasonKeys(SUPERVISOR_DENIED_REASON_TEXT).sort()).toEqual(
      [...fixtures.checkOrder].sort()
    );
  });

  it('exercises every checkSpawn reason and every parse reason at least once', () => {
    const denied = new Set(
      fixtures.checkSpawn.map((c) => ('reason' in c.expected ? c.expected.reason : 'ok'))
    );
    for (const reason of fixtures.checkOrder) expect(denied, reason).toContain(reason);
    const parsed = new Set(fixtures.parse.flatMap((c) => c.expected.rejected.map((r) => r.reason)));
    for (const reason of reasonKeys(fixtures.reasons.parse))
      expect(parsed, reason).toContain(reason);
  });

  it('agrees with the control contract on the reasons a refusal may carry', () => {
    const refusal = controlFixtures.additionalResponses.find(
      (entry) => entry.method === 'spawn' && entry.raw.ok === false
    )!.raw as { error: { reason: string } };
    expect(fixtures.checkOrder).toContain(refusal.error.reason);
  });

  it('has a reason text for every parse reason the cases use', () => {
    const used = fixtures.parse.flatMap((c) => c.expected.rejected.map((r) => r.reason));
    for (const reason of used) {
      expect(
        SUPERVISOR_PARSE_REASONS[reason as keyof typeof SUPERVISOR_PARSE_REASONS]
      ).toBeTruthy();
    }
  });

  it('starts a newly listed project from the fixture defaults, allowing nothing', () => {
    expect(defaultSupervisorProjectPolicy()).toEqual(fixtures.defaults.project);
    expect(defaultSupervisorProjectPolicy().allowed).toBe(false);
  });

  it('reads default and unattended modes from the provider registry', () => {
    const mode = (value: string, unattended?: boolean) => ({
      value,
      label: value,
      description: '',
      ...(unattended ? { unattended } : {}),
    });
    expect(
      permissionModesOf([
        {
          id: 'opencode',
          name: 'OpenCode',
          models: [],
          permissionModes: [mode('plan'), mode('auto', true)],
          defaultModel: 'oc-model',
          defaultPermissionMode: 'auto',
        },
        {
          id: 'bare',
          name: 'Bare',
          models: [],
          permissionModes: [],
          defaultModel: '',
          defaultPermissionMode: '',
        },
      ])
    ).toEqual({
      opencode: { default: 'auto', unattended: ['auto'] },
      bare: { default: null, unattended: [] },
    });
  });

  it('judges the effective mode: the policy names one, else the provider default', () => {
    const modes = { agy: { default: 'auto', unattended: ['auto', 'yolo'] } };
    expect(effectivePermissionMode({ permissionMode: {} }, 'agy', modes)).toBe('auto');
    expect(runsUnattended({ permissionMode: {} }, 'agy', modes)).toBe(true);
    expect(effectivePermissionMode({ permissionMode: { agy: 'plan' } }, 'agy', modes)).toBe('plan');
    expect(runsUnattended({ permissionMode: { agy: 'plan' } }, 'agy', modes)).toBe(false);
    expect(effectivePermissionMode({ permissionMode: {} }, 'other', modes)).toBeNull();
    expect(runsUnattended({ permissionMode: {} }, 'other', modes)).toBe(false);
  });

  it('an empty policy allows nothing, however the request looks', () => {
    const decision = checkSupervisorSpawn(
      emptySupervisorPolicy(),
      { projectPath: '/abs/project-a', provider: 'claude', model: 'haiku', headless: true },
      {
        projectPolicy: { allow: null, deny: [] },
        offeredModels: { claude: ['haiku'] },
        running: { total: 0, byProject: {} },
      }
    );
    expect(decision).toEqual({
      ok: false,
      code: 'supervisor_denied',
      reason: 'project_not_listed',
    });
  });

  it('a trailing slash on the requested path finds the project', () => {
    const { policy } = parseSupervisorPolicy(
      '{"version":1,"projects":{"/abs/project-a":{"allowed":true}}}'
    );
    const decision = checkSupervisorSpawn(
      policy,
      { projectPath: '/abs/project-a/', provider: 'claude', model: 'haiku', headless: true },
      {
        projectPolicy: { allow: null, deny: [] },
        offeredModels: { claude: ['haiku'] },
        running: { total: 0, byProject: {} },
      }
    );
    expect(decision).toEqual({ ok: true, permissionMode: null });
  });
});
