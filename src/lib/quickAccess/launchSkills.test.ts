import { describe, expect, it } from 'vitest';
import type {
  QuickAccessCombo,
  QuickAccessSkill,
  StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { launchEntriesForProject, wheelKnownIds, wheelSlotId } from './launchSkills';

const skill = (id: string, label: string, invocation?: string): QuickAccessSkill => ({
  id,
  label,
  prompt: invocation ?? `/${id}`,
  invocation,
});

const combo = (id: string, label: string, steps: QuickAccessSkill[]): QuickAccessCombo => ({
  id,
  label,
  steps,
});

const project = (overrides: Partial<StarredProject> = {}): StarredProject => ({
  path: '/a/website',
  name: 'website',
  starredAt: 1,
  ...overrides,
});

describe('launchEntriesForProject', () => {
  it('returns pinned skills', () => {
    const changelog = skill('s1', 'Changelog', '/changelog');
    expect(launchEntriesForProject(project({ skills: [changelog] }))).toEqual([
      { kind: 'skill', skill: changelog },
    ]);
  });

  it('offers the combo and its steps', () => {
    const draft = skill('c1', 'Draft', '/blog-article');
    const polish = skill('c2', 'Humanize', '/blog-finalize');
    const write = combo('combo-1', 'Write Blog Article', [draft, polish]);
    const listed = launchEntriesForProject(project({ combos: [write] }));
    expect(listed).toEqual([
      { kind: 'combo', combo: write },
      { kind: 'skill', skill: draft },
      { kind: 'skill', skill: polish },
    ]);
  });

  it('lists combos first, then pinned skills, then leftover combo steps', () => {
    const changelog = skill('s1', 'Changelog');
    const draft = skill('c1', 'Draft');
    const write = combo('combo-1', 'Write', [draft]);
    const listed = launchEntriesForProject(project({ skills: [changelog], combos: [write] }));
    expect(
      listed.map((entry) => ('skill' in entry ? entry.skill.label : entry.combo.label))
    ).toEqual(['Write', 'Changelog', 'Draft']);
  });

  it('does not list a combo step twice when it is already a pinned skill', () => {
    const draft = skill('s1', 'Draft', '/blog-article');
    const write = combo('combo-1', 'Write', [draft]);
    const listed = launchEntriesForProject(project({ skills: [draft], combos: [write] }));
    expect(listed.filter((entry) => entry.kind === 'skill')).toHaveLength(1);
  });

  it('is empty when Configure has nothing stored', () => {
    expect(launchEntriesForProject(project())).toEqual([]);
  });
});

describe('wheelSlotId', () => {
  it('namespaces combo ids so they cannot collide with a skill id', () => {
    expect(wheelSlotId({ kind: 'combo', combo: combo('same', 'Write', []) })).toBe('combo:same');
    expect(wheelSlotId({ kind: 'skill', skill: skill('same', 'Same') })).toBe('same');
  });
});

describe('wheelKnownIds', () => {
  it('accepts both skill ids and namespaced combo ids', () => {
    const ids = wheelKnownIds(
      project({
        skills: [skill('s1', 'Changelog')],
        combos: [combo('c1', 'Write', [])],
      })
    );
    expect(ids).toContain('combo:c1');
    expect(ids).toContain('s1');
  });
});
