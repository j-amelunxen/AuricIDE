import { describe, expect, it } from 'vitest';
import { nextScratchName, compareScratchNames, isScratchPath } from './naming';

describe('nextScratchName', () => {
  it('starts at scratch-1.md when nothing exists', () => {
    expect(nextScratchName([])).toBe('scratch-1.md');
  });

  it('uses max existing number + 1, not the smallest gap', () => {
    expect(nextScratchName(['scratch-1.md', 'scratch-3.md'])).toBe('scratch-4.md');
  });

  it('ignores names that do not match the scratch pattern', () => {
    expect(nextScratchName(['notes.md', 'scratch-x.md', 'scratch-2.md.bak'])).toBe('scratch-1.md');
  });

  it('never reuses the name of a just-deleted scratch', () => {
    // scratch-1 was deleted; the highest surviving number still wins
    expect(nextScratchName(['scratch-5.md'])).toBe('scratch-6.md');
  });
});

describe('compareScratchNames', () => {
  it('sorts numbered scratches highest-first (newest on top)', () => {
    const names = ['scratch-2.md', 'scratch-10.md', 'scratch-1.md'];
    expect([...names].sort(compareScratchNames)).toEqual([
      'scratch-10.md',
      'scratch-2.md',
      'scratch-1.md',
    ]);
  });

  it('puts renamed (non-pattern) scratches after numbered ones, alphabetically', () => {
    const names = ['ideas.md', 'scratch-2.md', 'api-notes.md'];
    expect([...names].sort(compareScratchNames)).toEqual([
      'scratch-2.md',
      'api-notes.md',
      'ideas.md',
    ]);
  });
});

describe('isScratchPath', () => {
  it('is false when the scratch dir is unknown', () => {
    expect(isScratchPath('/anywhere/scratch-1.md', null)).toBe(false);
  });

  it('matches only paths inside the scratch dir', () => {
    expect(isScratchPath('/data/scratches/scratch-1.md', '/data/scratches')).toBe(true);
    expect(isScratchPath('/data/scratches-other/a.md', '/data/scratches')).toBe(false);
    expect(isScratchPath('/project/scratch-1.md', '/data/scratches')).toBe(false);
  });
});
