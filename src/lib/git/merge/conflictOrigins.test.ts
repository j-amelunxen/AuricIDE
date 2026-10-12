import { describe, expect, it } from 'vitest';
import { parseMergedText, type MergeSegment } from './conflictModel';
import { commitAge, conflictOrigins, conflictSideRanges, intentFor } from './conflictOrigins';
import type { GitConflictOrigins, OriginCommit } from '../../tauri/gitMerge';

const LABELS = { ours: 'main', theirs: 'feature', base: 'base' };

function commit(oid: string, summary: string, time: number): OriginCommit {
  return { oid, shortOid: oid.slice(0, 7), summary, author: 'Dev', time };
}

function segments(merged: string): MergeSegment[] {
  return parseMergedText(merged, { labels: LABELS }).segments;
}

const MERGED = [
  'a',
  '<<<<<<< main',
  'pool=2',
  '||||||| base',
  'pool=4',
  '=======',
  'pool=8',
  '>>>>>>> feature',
  'c',
  'D',
  'e',
  '',
].join('\n');

describe('conflictSideRanges', () => {
  it('counts clean lines on both sides and each side only its own conflict lines', () => {
    const merged = [
      '<<<<<<< main',
      'o1',
      'o2',
      '=======',
      't1',
      '>>>>>>> feature',
      'mid',
      '<<<<<<< main',
      'o3',
      '=======',
      't2',
      't3',
      't4',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const ranges = conflictSideRanges(segments(merged), {
      ours: 'o1\no2\nmid\no3\n',
      theirs: 't1\nmid\nt2\nt3\nt4\n',
    });
    expect(ranges[0]).toEqual({ ours: { start: 1, count: 2 }, theirs: { start: 1, count: 1 } });
    expect(ranges[1]).toEqual({ ours: { start: 4, count: 1 }, theirs: { start: 3, count: 3 } });
  });

  it('finds the region in the stage text when a clean run hides a one-sided insert', () => {
    // git merged theirs' two new lines at the top cleanly, so the merged text
    // has them but the ours stage does not: walking alone would point ours two
    // lines too far down.
    const merged = [
      'new1',
      'new2',
      'a',
      '<<<<<<< main',
      'x-ours',
      '=======',
      'x-theirs',
      '>>>>>>> feature',
      'z',
      '<<<<<<< main',
      'y-ours',
      '=======',
      'y-theirs',
      '>>>>>>> feature',
      '',
    ].join('\n');
    const ranges = conflictSideRanges(segments(merged), {
      ours: 'a\nx-ours\nz\ny-ours\n',
      theirs: 'new1\nnew2\na\nx-theirs\nz\ny-theirs\n',
    });
    expect(ranges[0].ours).toEqual({ start: 2, count: 1 });
    expect(ranges[0].theirs).toEqual({ start: 4, count: 1 });
    expect(ranges[1].ours).toEqual({ start: 4, count: 1 });
    expect(ranges[1].theirs).toEqual({ start: 6, count: 1 });
  });

  it('gives no range for a side whose stage text is absent', () => {
    const ranges = conflictSideRanges(segments(MERGED), { ours: null, theirs: null });
    expect(ranges[0]).toEqual({ ours: null, theirs: null });
  });

  it('reads CRLF stage texts', () => {
    const ranges = conflictSideRanges(segments(MERGED), {
      ours: 'a\r\npool=2\r\nc\r\nD\r\ne\r\n',
      theirs: 'a\r\npool=8\r\nc\r\nD\r\ne\r\n',
    });
    expect(ranges[0].ours).toEqual({ start: 2, count: 1 });
  });
});

describe('conflictOrigins', () => {
  const lower = commit('1111111aaaa', 'Lower pool size', 100);
  const raise = commit('2222222bbbb', 'Raise pool size', 200);
  const shout = commit('3333333cccc', 'Shout d', 300);
  const origins: GitConflictOrigins = {
    ours: [{ line: 2, oid: lower.oid }],
    theirs: [
      { line: 2, oid: raise.oid },
      { line: 4, oid: shout.oid },
    ],
    commits: [shout, raise, lower],
  };
  const sides = { ours: 'a\npool=2\nc\nd\ne\n', theirs: 'a\npool=8\nc\nD\ne\n' };

  it('names the commits that changed each side of a conflict, and only those lines', () => {
    expect(conflictOrigins(segments(MERGED), sides, origins)).toEqual({
      0: { ours: [lower], theirs: [raise] },
    });
  });

  it('says nothing for a side that did not change since the base', () => {
    const result = conflictOrigins(segments(MERGED), sides, { ...origins, ours: [] });
    expect(result[0].ours).toEqual([]);
  });

  it('lists each commit once, newest first', () => {
    const merged = MERGED.replace('pool=8\n', 'pool=8\nextra\nmore\n');
    const threeLines: GitConflictOrigins = {
      ours: [],
      theirs: [
        { line: 2, oid: raise.oid },
        { line: 3, oid: shout.oid },
        { line: 4, oid: raise.oid },
      ],
      commits: [shout, raise],
    };
    const theirs = 'a\npool=8\nextra\nmore\nc\nD\ne\n';
    const result = conflictOrigins(segments(merged), { ours: sides.ours, theirs }, threeLines);
    expect(result[0].theirs.map((c) => c.summary)).toEqual(['Shout d', 'Raise pool size']);
  });

  it('skips a line whose commit is not in the list rather than inventing one', () => {
    const result = conflictOrigins(segments(MERGED), sides, { ...origins, commits: [] });
    expect(result[0]).toEqual({ ours: [], theirs: [] });
  });
});

describe('intentFor', () => {
  it('turns each side into its commit subjects', () => {
    const lower = commit('1111111', 'Lower pool size', 1);
    expect(intentFor({ ours: [lower], theirs: [] })).toEqual({
      ours: ['Lower pool size'],
      theirs: [],
    });
  });

  it('is undefined when no side has a commit', () => {
    expect(intentFor({ ours: [], theirs: [] })).toBeUndefined();
    expect(intentFor(undefined)).toBeUndefined();
  });
});

describe('commitAge', () => {
  const now = Date.UTC(2026, 9, 9, 12, 0, 0);
  const ago = (seconds: number) => commitAge(now / 1000 - seconds, now);

  it('reads like a person would say it', () => {
    expect(ago(10)).toBe('just now');
    expect(ago(60)).toBe('1 minute ago');
    expect(ago(5 * 60)).toBe('5 minutes ago');
    expect(ago(3600)).toBe('1 hour ago');
    expect(ago(3 * 86400)).toBe('3 days ago');
    expect(ago(14 * 86400)).toBe('2 weeks ago');
    expect(ago(90 * 86400)).toBe('3 months ago');
    expect(ago(800 * 86400)).toBe('2 years ago');
  });

  it('treats a commit from the future (clock skew) as just now', () => {
    expect(ago(-3600)).toBe('just now');
  });
});
