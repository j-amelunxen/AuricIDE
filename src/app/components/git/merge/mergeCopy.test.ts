import { describe, expect, it } from 'vitest';
import {
  foldClean,
  pairedWordSpans,
  pickOptions,
  previewSummary,
  stepLine,
  stepCopy,
  resolutionBreakdown,
  resolutionSummary,
  segmentLineNumbers,
  sideName,
} from './mergeCopy';

const labels = { ours: 'main', theirs: 'feature/x' };

describe('mergeCopy', () => {
  it('names every side by its branch, never ours/theirs alone', () => {
    expect(sideName(labels, 'ours')).toBe('main (yours)');
    expect(sideName(labels, 'theirs')).toBe('feature/x (incoming)');
    expect(resolutionSummary({ kind: 'both', first: 'theirs' }, labels)).toBe(
      'Kept both, feature/x first'
    );
    expect(resolutionSummary({ kind: 'custom', lines: [], source: 'agent' }, labels)).toBe(
      'Accepted the agent proposal'
    );
  });

  it('offers the deletion as one of the sides on a delete/modify conflict', () => {
    const options = pickOptions('deleted-by-them', labels);
    expect(options.map((o) => o.pick)).toEqual(['ours', 'theirs']);
    expect(options[1]).toMatchObject({ label: 'Delete it, like feature/x', deletes: true });
    expect(pickOptions('binary', labels).map((o) => o.pick)).toEqual(['ours', 'theirs', 'delete']);
  });

  it('sums up how the conflicts were settled, automatic ones first', () => {
    expect(
      resolutionBreakdown(
        {
          0: { kind: 'ours' },
          1: { kind: 'theirs' },
          2: { kind: 'ours' },
          3: { kind: 'custom', lines: [], source: 'agent' },
          4: { kind: 'theirs' },
        },
        { 2: 'Only your side changed this region.', 4: 'Only the incoming side changed.' },
        labels
      )
    ).toBe('5 resolved: 2 automatic, 1 yours, 1 incoming, 1 agent');
    expect(resolutionBreakdown({}, {}, labels)).toBeNull();
  });

  it('word-diffs only when the sides line up one to one', () => {
    expect(pairedWordSpans(['a', 'b'], ['a'])).toBeNull();
    const spans = pairedWordSpans(['const x = 1;', 'same'], ['const x = 2;', 'same'])!;
    expect(spans.ours[1]).toBeNull();
    expect(spans.ours[0]!.filter((s) => s.changed).map((s) => s.text)).toEqual(['1']);
  });

  it('folds clean runs to context around conflicts, and leaves short runs whole', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const middle = foldClean(lines, 1, { first: false, last: false });
    expect(middle.head.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    expect(middle.hidden).toHaveLength(14);
    expect(middle.tail.map((l) => l.text)).toEqual(['l17', 'l18', 'l19']);

    const leading = foldClean(lines, 1, { first: true, last: false });
    expect(leading.head).toEqual([]);
    expect(leading.tail).toHaveLength(3);

    expect(foldClean(lines.slice(0, 8), 1, { first: false, last: false }).hidden).toEqual([]);
  });

  it('numbers lines in both files across conflicts of different length', () => {
    const numbers = segmentLineNumbers([
      { kind: 'clean', lines: ['a', 'b'] },
      { kind: 'conflict', index: 0, ours: ['x'], base: null, theirs: ['y', 'z', 'w'] },
      { kind: 'clean', lines: ['c'] },
    ]);
    expect(numbers).toEqual([
      { ours: 1, theirs: 1 },
      { ours: 3, theirs: 3 },
      { ours: 4, theirs: 6 },
    ]);
  });
});

describe('merge preview copy', () => {
  it('says what a merge would do before it starts', () => {
    expect(previewSummary({ outcome: 'up-to-date', conflicts: [], commits: 0 })).toBe(
      'Already merged'
    );
    expect(previewSummary({ outcome: 'fast-forward', conflicts: [], commits: 1 })).toBe(
      '1 commit · fast-forward'
    );
    expect(previewSummary({ outcome: 'clean', conflicts: [], commits: 3 })).toBe(
      '3 commits · merges cleanly'
    );
    expect(
      previewSummary({ outcome: 'conflicts', conflicts: ['src/a.ts', 'ci/b.yml'], commits: 4 })
    ).toBe('Conflicts in 2 files: a.ts, b.yml');
  });

  it('names at most three conflicting files', () => {
    const conflicts = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];
    expect(previewSummary({ outcome: 'conflicts', conflicts, commits: 1 })).toBe(
      'Conflicts in 5 files: a.ts, b.ts, c.ts and 2 more'
    );
  });
});

describe('operation step copy', () => {
  it('reads a rebase step as a progress line', () => {
    expect(stepLine({ current: 2, total: 5, subject: 'Add the parser', branch: 'feature/x' })).toBe(
      'Replaying commit 2 of 5: Add the parser'
    );
    expect(stepLine({ current: 1, total: 3, subject: null, branch: null })).toBe(
      'Replaying commit 1 of 3'
    );
    expect(stepLine(null)).toBeNull();
    expect(stepLine(undefined)).toBeNull();
  });

  it('names each button after its operation and says what abort gives back', () => {
    const rebase = stepCopy('rebase', 'feature/x');
    expect(rebase.continueLabel).toBe('Continue rebase');
    expect(rebase.abortLabel).toBe('Abort rebase');
    expect(rebase.abortMessage).toContain('feature/x goes back');
    expect(stepCopy('cherry-pick', 'main').continueLabel).toBe('Continue cherry-pick');
    expect(stepCopy('revert', 'main').abortLabel).toBe('Abort revert');
  });
});
