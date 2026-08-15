import { describe, it, expect } from 'vitest';
import { groupAgentTabs } from './tabGroups';
import type { AgentInfo } from '../tauri/agents';

function makeAgent(id: string, repoPath?: string): AgentInfo {
  return {
    id,
    name: id,
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: 0,
    ...(repoPath !== undefined ? { repoPath } : {}),
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
