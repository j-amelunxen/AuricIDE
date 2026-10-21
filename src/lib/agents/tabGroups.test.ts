import { describe, it, expect } from 'vitest';
import { groupAgentTabs } from './tabGroups';
import type { AgentInfo } from '../tauri/agents';

function makeAgent(id: string, repoPath?: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    name: id,
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: 0,
    ...(repoPath !== undefined ? { repoPath } : {}),
    ...extra,
  };
}

describe('groupAgentTabs', () => {
  it('returns nothing for an empty fleet', () => {
    expect(groupAgentTabs([])).toEqual([]);
  });

  it('groups agents by their repo path', () => {
    const groups = groupAgentTabs([
      makeAgent('a', '/work/alpha'),
      makeAgent('b', '/work/beta'),
      makeAgent('c', '/work/alpha'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].repoPath).toBe('/work/alpha');
    expect(groups[0].agents.map((a) => a.id)).toEqual(['a', 'c']);
    expect(groups[1].agents.map((a) => a.id)).toEqual(['b']);
  });

  /**
   * The strip is a row of running work. A group that changes place because an
   * agent finished would move every tab after it under the cursor.
   */
  it('keeps groups in the order their first agent appears', () => {
    const groups = groupAgentTabs([makeAgent('a', '/work/zulu'), makeAgent('b', '/work/alpha')]);
    expect(groups.map((g) => g.repoPath)).toEqual(['/work/zulu', '/work/alpha']);
  });

  it('labels a group with its folder name', () => {
    const [group] = groupAgentTabs([makeAgent('a', '/work/open-source/AuricIDE')]);
    expect(group.label).toBe('AuricIDE');
  });

  it('drops a trailing slash before taking the folder name', () => {
    const [group] = groupAgentTabs([makeAgent('a', '/work/alpha/')]);
    expect(group.label).toBe('alpha');
  });

  /**
   * Two checkouts of the same project under different parents are exactly the
   * case where a bare folder name tells the user nothing.
   */
  it('disambiguates groups that would share a folder name', () => {
    const groups = groupAgentTabs([
      makeAgent('a', '/work/client/api'),
      makeAgent('b', '/work/internal/api'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['client/api', 'internal/api']);
  });

  it('leaves unique labels alone when another group collides elsewhere', () => {
    const groups = groupAgentTabs([
      makeAgent('a', '/work/client/api'),
      makeAgent('b', '/work/internal/api'),
      makeAgent('c', '/work/web'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['client/api', 'internal/api', 'web']);
  });

  it('collects agents without a repo path into one group at the end', () => {
    const groups = groupAgentTabs([makeAgent('a'), makeAgent('b', '/work/alpha'), makeAgent('c')]);

    expect(groups.map((g) => g.repoPath)).toEqual(['/work/alpha', null]);
    expect(groups[1].agents.map((a) => a.id)).toEqual(['a', 'c']);
    expect(groups[1].label).toBe('Unknown');
  });

  it('keeps every agent exactly once', () => {
    const agents = [
      makeAgent('a', '/work/alpha'),
      makeAgent('b'),
      makeAgent('c', '/work/beta'),
      makeAgent('d', '/work/alpha'),
    ];
    const ids = groupAgentTabs(agents).flatMap((g) => g.agents.map((a) => a.id));
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('groupAgentTabs with supervisors', () => {
  const RUN_A = '/home/me/.auric/supervisors/2026-10-21_090000';
  const RUN_B = '/home/me/.auric/supervisors/2026-10-21_100000';

  it('keys a repo group by its path and the ungrouped one by the shared key', () => {
    const groups = groupAgentTabs([makeAgent('a', '/work/alpha'), makeAgent('b')]);
    expect(groups.map((g) => g.key)).toEqual(['/work/alpha', 'Unknown']);
    expect(groups.every((g) => g.supervisorId === null)).toBe(true);
  });

  it('makes one group per supervisor family, across repositories, supervisor first', () => {
    const groups = groupAgentTabs([
      makeAgent('a-1', '/work/alpha', { spawnedByAgentId: 'sup-a' }),
      makeAgent('plain', '/work/alpha'),
      makeAgent('sup-a', RUN_A, { role: 'supervisor', name: 'Supervisor' }),
      makeAgent('a-2', '/work/beta', { spawnedByAgentId: 'sup-a' }),
      makeAgent('sup-b', RUN_B, { role: 'supervisor', supervisorKey: 'mail-triage' }),
      makeAgent('a-1-1', '/work/gamma', { spawnedByAgentId: 'a-1' }),
      makeAgent('b-1', '/work/alpha', { spawnedByAgentId: 'sup-b' }),
    ]);

    expect(groups.map((g) => g.key)).toEqual([
      'supervisor:sup-a',
      '/work/alpha',
      'supervisor:sup-b',
    ]);
    expect(groups[0].agents.map((a) => a.id)).toEqual(['sup-a', 'a-1', 'a-2', 'a-1-1']);
    expect(groups[0]).toMatchObject({ label: 'Supervisor', supervisorId: 'sup-a', repoPath: null });
    expect(groups[1].agents.map((a) => a.id)).toEqual(['plain']);
    expect(groups[2]).toMatchObject({ label: 'mail-triage', supervisorId: 'sup-b' });
    expect(groups[2].agents.map((a) => a.id)).toEqual(['sup-b', 'b-1']);
  });

  it('leaves a child whose supervisor is gone from the list in its repo group', () => {
    const groups = groupAgentTabs([
      makeAgent('sup', RUN_A, { role: 'supervisor' }),
      makeAgent('orphan', '/work/alpha', { spawnedByAgentId: 'cleared' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['supervisor:sup', '/work/alpha']);
    expect(groups[1].agents.map((a) => a.id)).toEqual(['orphan']);
  });

  it('groups by repo as before when families are switched off', () => {
    const groups = groupAgentTabs(
      [
        makeAgent('sup', RUN_A, { role: 'supervisor' }),
        makeAgent('child', '/work/alpha', { spawnedByAgentId: 'sup' }),
      ],
      { families: false }
    );
    expect(groups.map((g) => g.key)).toEqual([RUN_A, '/work/alpha']);
  });

  it('keeps every agent exactly once, so the strip order is the flattened groups', () => {
    const agents = [
      makeAgent('c', '/work/alpha', { spawnedByAgentId: 'sup' }),
      makeAgent('x'),
      makeAgent('sup', RUN_A, { role: 'supervisor' }),
      makeAgent('d', '/work/alpha'),
    ];
    const order = groupAgentTabs(agents).flatMap((g) => g.agents.map((a) => a.id));
    expect(order).toEqual(['sup', 'c', 'd', 'x']);
  });
});
