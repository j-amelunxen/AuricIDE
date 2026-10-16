import { describe, expect, it } from 'vitest';
import { menuSkillEntries, pinSlottedLibrarySkills } from './menuSkills';

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

describe('pinSlottedLibrarySkills', () => {
  const library = [
    { id: 'a1', name: 'Refactor Check', prompt: '/refactor' },
    { id: 'a2', name: 'Docs Check', prompt: '/docs' },
  ];
  const pinned = [{ id: 'p1', label: 'Changelog', prompt: '/changelog' }];

  it('pins a library skill that was put on a slot, under the id the slot holds', () => {
    const skills = pinSlottedLibrarySkills(pinned, ['auric:a2', null], library);
    expect(skills).toEqual([
      ...pinned,
      { id: 'auric:a2', label: 'Docs Check', prompt: '/docs', auricSkillId: 'a2' },
    ]);
  });

  it('leaves the pinned list alone when no slot names a library skill', () => {
    expect(pinSlottedLibrarySkills(pinned, ['p1', null], library)).toBe(pinned);
  });

  it('does not pin a library skill twice once it is pinned', () => {
    const once = pinSlottedLibrarySkills(pinned, ['auric:a1'], library);
    expect(pinSlottedLibrarySkills(once, ['auric:a1'], library)).toBe(once);
  });
});
