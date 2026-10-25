import { describe, expect, it } from 'vitest';
import { emptySupervisorPolicy, parseSupervisorPolicy } from './supervisorPolicy';
import {
  offerablePermissionModes,
  setExtraMcpServer,
  setProjectAllowed,
  setSupervisorPermissionMode,
  setSupervisorProviderNote,
  setSupervisorProviderWeight,
  toggleSupervisorModel,
  toggleSupervisorProvider,
  unattendedBlockers,
  updateSupervisorProject,
} from './supervisorPolicyEdit';
import type { ProviderInfo } from '@/lib/tauri/providers';

const PATH = '/work/project-a';

describe('setProjectAllowed', () => {
  it('creates the default entry on first switch-on and keeps it when switched off', () => {
    const on = setProjectAllowed(emptySupervisorPolicy(), `${PATH}/`, true);
    expect(on.projects[PATH]).toMatchObject({ allowed: true, providers: null });
    const tuned = updateSupervisorProject(on, PATH, (entry) => ({ ...entry, maxRunning: 5 }));
    const off = setProjectAllowed(tuned, PATH, false);
    expect(off.projects[PATH]).toMatchObject({ allowed: false, maxRunning: 5 });
  });
});

describe('toggleSupervisorProvider', () => {
  it('turns "whatever the project permits" into an explicit list on the first edit', () => {
    const policy = setProjectAllowed(emptySupervisorPolicy(), PATH, true);
    const entry = toggleSupervisorProvider(policy.projects[PATH], 'codex', false, [
      'claude',
      'codex',
    ]);
    expect(entry.providers).toEqual(['claude']);
    expect(toggleSupervisorProvider(entry, 'codex', true, ['claude', 'codex']).providers).toEqual([
      'claude',
      'codex',
    ]);
  });
});

describe('toggleSupervisorModel', () => {
  it('starts from every offered model and can empty the list, which blocks the provider', () => {
    const policy = setProjectAllowed(emptySupervisorPolicy(), PATH, true);
    const one = toggleSupervisorModel(policy.projects[PATH], 'codex', 'luna', false, [
      'luna',
      'sol',
    ]);
    expect(one.models.codex).toEqual(['sol']);
    const none = toggleSupervisorModel(one, 'codex', 'sol', false, ['luna', 'sol']);
    expect(none.models.codex).toEqual([]);
    const back = toggleSupervisorModel(none, 'codex', 'luna', true, ['luna', 'sol']);
    expect(back.models.codex).toEqual(['luna']);
  });
});

describe('setSupervisorProviderWeight', () => {
  it('keeps whole shares from 0 to 99 that the parser reads back, and drops a cleared one', () => {
    const policy = setProjectAllowed(emptySupervisorPolicy(), PATH, true);
    let entry = setSupervisorProviderWeight(policy.projects[PATH], 'claude', 2);
    entry = setSupervisorProviderWeight(entry, 'codex', 1.7);
    entry = setSupervisorProviderWeight(entry, 'grok', 500);
    entry = setSupervisorProviderWeight(entry, 'agy', -3);
    expect(entry.providerWeights).toEqual({ claude: 2, codex: 1, grok: 99, agy: 0 });
    const saved = JSON.stringify({ ...policy, projects: { [PATH]: entry } });
    expect(parseSupervisorPolicy(saved).rejected).toEqual([]);
    expect(setSupervisorProviderWeight(entry, 'claude', null).providerWeights).not.toHaveProperty(
      'claude'
    );
  });
});

describe('setSupervisorProviderNote', () => {
  it('stores the note as typed and deletes it for null or a blank text', () => {
    const policy = setProjectAllowed(emptySupervisorPolicy(), PATH, true);
    expect(policy.projects[PATH].providerNotes).toEqual({});
    let entry = setSupervisorProviderNote(policy.projects[PATH], 'claude', ' Source only ');
    entry = setSupervisorProviderNote(entry, 'codex', 'May use databases');
    expect(entry.providerNotes).toEqual({ claude: ' Source only ', codex: 'May use databases' });
    const saved = JSON.stringify({ ...policy, projects: { [PATH]: entry } });
    expect(parseSupervisorPolicy(saved).policy.projects[PATH].providerNotes).toEqual({
      claude: 'Source only',
      codex: 'May use databases',
    });
    expect(setSupervisorProviderNote(entry, 'claude', null).providerNotes).toEqual({
      codex: 'May use databases',
    });
    expect(setSupervisorProviderNote(entry, 'codex', '  \n ').providerNotes).toEqual({
      claude: ' Source only ',
    });
    expect(setSupervisorProviderNote(entry, 'codex', '\uFEFF\u0085').providerNotes).toEqual({
      claude: ' Source only ',
    });
  });
});

describe('offerablePermissionModes', () => {
  it('never offers bypassPermissions or any mode that skips prompts', () => {
    const modes = offerablePermissionModes([
      { value: 'default', label: 'Default', description: '' },
      { value: 'bypassPermissions', label: 'Bypass', description: '' },
      { value: 'acceptEdits', label: 'Accept edits', description: '' },
      { value: 'yolo', label: 'Yolo', description: '', unattended: true },
    ]);
    expect(modes.map((m) => m.value)).toEqual(['default', 'acceptEdits']);
  });
});

describe('unattendedBlockers', () => {
  const agy: ProviderInfo = {
    id: 'agy',
    name: 'Antigravity',
    models: [],
    permissionModes: [
      { value: 'auto', label: 'Auto', description: '', unattended: true },
      { value: 'plan', label: 'Plan', description: '' },
    ],
    defaultModel: '',
    defaultPermissionMode: 'auto',
  };
  const allowed = () => setProjectAllowed(emptySupervisorPolicy(), PATH, true);

  it('names an allowed, ticked provider whose default skips prompts', () => {
    expect(unattendedBlockers(allowed(), [agy], {})).toEqual([{ path: PATH, providerId: 'agy' }]);
  });

  it('clears once an attended mode is named', () => {
    const named = updateSupervisorProject(allowed(), PATH, (e) =>
      setSupervisorPermissionMode(e, 'agy', 'plan')
    );
    expect(unattendedBlockers(named, [agy], {})).toEqual([]);
  });

  it('ignores a disallowed project, an unticked provider and one the project denies', () => {
    const off = setProjectAllowed(allowed(), PATH, false);
    const unticked = updateSupervisorProject(allowed(), PATH, (e) => ({ ...e, providers: [] }));
    expect(unattendedBlockers(off, [agy], {})).toEqual([]);
    expect(unattendedBlockers(unticked, [agy], {})).toEqual([]);
    expect(
      unattendedBlockers(allowed(), [agy], { [PATH]: { allow: null, deny: ['agy'] } })
    ).toEqual([]);
  });
});

describe('setExtraMcpServer', () => {
  const entry = setProjectAllowed(emptySupervisorPolicy(), PATH, true).projects[PATH];

  it('adds a trimmed name once and removes it again', () => {
    const added = setExtraMcpServer(setExtraMcpServer(entry, ' motion ', true), 'motion', true);
    expect(added.extraMcpServers).toEqual(['motion']);
    expect(setExtraMcpServer(added, 'motion', false).extraMcpServers).toEqual([]);
  });

  it('ignores an empty name', () => {
    expect(setExtraMcpServer(entry, '  ', true)).toBe(entry);
  });

  it('survives the policy round trip and drops duplicates a hand edit left in the file', () => {
    const raw = JSON.stringify({
      version: 1,
      projects: { [PATH]: { allowed: true, extraMcpServers: ['a', ' a ', 'b', ''] } },
    });
    expect(parseSupervisorPolicy(raw).policy.projects[PATH].extraMcpServers).toEqual(['a', 'b']);
  });

  it('refuses a project whose extraMcpServers is not a list of strings', () => {
    const raw = JSON.stringify({ version: 1, projects: { [PATH]: { extraMcpServers: [1] } } });
    expect(parseSupervisorPolicy(raw).policy.projects[PATH]).toBeUndefined();
  });
});
