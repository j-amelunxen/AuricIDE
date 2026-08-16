import { describe, expect, it } from 'vitest';
import { menuSkillEntries } from './menuSkills';

describe('menuSkillEntries', () => {
  it('appends every Auric Skill from the library when nothing is pinned', () => {
    const entries = menuSkillEntries(
      [],
      [{ id: 'a1', name: 'Refactor Check', prompt: 'Look for refactor opportunities.' }]
    );
    expect(entries).toEqual([
      {
        id: 'auric:a1',
        label: 'Refactor Check',
        prompt: 'Look for refactor opportunities.',
        auricSkillId: 'a1',
      },
    ]);
  });

  it('lists pinned skills first, then unpinned library skills', () => {
    const pinned = [{ id: 'p1', label: 'Changelog', prompt: '/changelog' }];
    const library = [{ id: 'a1', name: 'Refactor Check', prompt: '/refactor' }];
    const entries = menuSkillEntries(pinned, library);
    expect(entries.map((e) => e.label)).toEqual(['Changelog', 'Refactor Check']);
  });

  it('does not repeat a library skill that is already pinned to the project', () => {
    const pinned = [{ id: 'p1', label: 'Refactor Check', prompt: '/refactor', auricSkillId: 'a1' }];
    const library = [{ id: 'a1', name: 'Refactor Check', prompt: '/refactor' }];
    const entries = menuSkillEntries(pinned, library);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('p1');
  });

  it('returns just the pinned skills when the library is empty', () => {
    const pinned = [{ id: 'p1', label: 'Changelog', prompt: '/changelog' }];
    expect(menuSkillEntries(pinned, [])).toEqual(pinned);
  });
});
