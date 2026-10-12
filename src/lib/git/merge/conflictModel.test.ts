import { describe, expect, it } from 'vitest';
import {
  autoResolution,
  composeResult,
  hasConflictMarkers,
  parseMergedText,
  resolutionLines,
  type ConflictSegment,
  type MergeDoc,
  type Resolution,
} from './conflictModel';

const DIFF3 = [
  'line one',
  '<<<<<<< main',
  'ours a',
  '||||||| base',
  'base a',
  '=======',
  'theirs a',
  '>>>>>>> feature/x',
  'line after',
  '',
].join('\n');

function conflicts(doc: MergeDoc): ConflictSegment[] {
  return doc.segments.filter((s): s is ConflictSegment => s.kind === 'conflict');
}

function conflict(
  ours: string[],
  base: string[] | null,
  theirs: string[],
  index = 0
): ConflictSegment {
  return { kind: 'conflict', index, ours, base, theirs };
}

describe('parseMergedText', () => {
  it('splits diff3 output into clean and conflict segments', () => {
    const doc = parseMergedText(DIFF3);
    expect(doc.segments).toEqual([
      { kind: 'clean', lines: ['line one'] },
      { kind: 'conflict', index: 0, ours: ['ours a'], base: ['base a'], theirs: ['theirs a'] },
      { kind: 'clean', lines: ['line after'] },
    ]);
    expect(doc.conflictCount).toBe(1);
    expect(doc.eol).toBe('\n');
    expect(doc.endsWithNewline).toBe(true);
  });

  it('reads a conflict without a base section as base null', () => {
    const text = ['<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b'].join('\n');
    const doc = parseMergedText(text);
    expect(doc.segments).toEqual([
      { kind: 'conflict', index: 0, ours: ['x'], base: null, theirs: ['y'] },
    ]);
    expect(doc.endsWithNewline).toBe(false);
  });

  it('numbers several conflicts in order, including at file start and end', () => {
    const text = [
      '<<<<<<< a',
      '1',
      '||||||| o',
      '0',
      '=======',
      '2',
      '>>>>>>> b',
      'mid',
      '<<<<<<< a',
      '3',
      '||||||| o',
      '=======',
      '>>>>>>> b',
      '',
    ].join('\n');
    const doc = parseMergedText(text);
    expect(doc.conflictCount).toBe(2);
    expect(doc.segments[0]).toMatchObject({ kind: 'conflict', index: 0 });
    expect(doc.segments[1]).toEqual({ kind: 'clean', lines: ['mid'] });
    expect(doc.segments[2]).toEqual({
      kind: 'conflict',
      index: 1,
      ours: ['3'],
      base: [],
      theirs: [],
    });
  });

  it('keeps CRLF line endings and strips them from the lines', () => {
    const doc = parseMergedText(DIFF3.replace(/\n/g, '\r\n'));
    expect(doc.eol).toBe('\r\n');
    expect(conflicts(doc)[0].ours).toEqual(['ours a']);
    const out = composeResult(doc, { 0: { kind: 'theirs' } });
    expect(out).toBe('line one\r\ntheirs a\r\nline after\r\n');
  });

  it('treats a file with no markers as one clean segment', () => {
    const doc = parseMergedText('a\nb\n');
    expect(doc.segments).toEqual([{ kind: 'clean', lines: ['a', 'b'] }]);
    expect(doc.conflictCount).toBe(0);
    expect(composeResult(doc, {})).toBe('a\nb\n');
  });

  it('handles an empty file', () => {
    const doc = parseMergedText('');
    expect(doc.segments).toEqual([]);
    expect(composeResult(doc, {})).toBe('');
  });

  it.each([
    ['nested open', ['<<<<<<< a', '<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b']],
    ['missing end', ['<<<<<<< a', 'x', '=======', 'y']],
    ['stray end', ['a', '>>>>>>> b']],
    ['base after separator', ['<<<<<<< a', 'x', '=======', '||||||| o', 'y', '>>>>>>> b']],
    ['end before separator', ['<<<<<<< a', 'x', '>>>>>>> b']],
  ])('returns one unparsed segment for unbalanced markers (%s)', (_name, lines) => {
    const text = lines.join('\n') + '\n';
    const doc = parseMergedText(text);
    expect(doc.segments).toEqual([{ kind: 'unparsed', text }]);
    expect(doc.conflictCount).toBe(0);
    expect(composeResult(doc, {})).toBeNull();
  });

  it('reads a separator or base line outside a conflict as clean text (setext heading)', () => {
    const text = ['Title', '=======', '', 'body', '||||||| art'].join('\n') + '\n';
    const doc = parseMergedText(text);
    expect(doc.segments).toEqual([
      { kind: 'clean', lines: ['Title', '=======', '', 'body', '||||||| art'] },
    ]);
    expect(composeResult(doc, {})).toBe(text);
  });

  it('keeps a setext heading next to a real conflict as clean text', () => {
    const text = ['Title', '=======', '<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b', ''].join('\n');
    const doc = parseMergedText(text);
    expect(doc.segments[0]).toEqual({ kind: 'clean', lines: ['Title', '======='] });
    expect(doc.conflictCount).toBe(1);
  });

  it('does not take a longer run of = or a marker without label space as a marker', () => {
    const doc = parseMergedText('========\n<<<<<<<<x\n');
    expect(doc.segments).toEqual([{ kind: 'clean', lines: ['========', '<<<<<<<<x'] }]);
  });
});

describe('resolutionLines', () => {
  const c = conflict(['o1', 'o2'], ['b'], ['t1']);
  it.each<[Resolution, string[]]>([
    [{ kind: 'ours' }, ['o1', 'o2']],
    [{ kind: 'theirs' }, ['t1']],
    [{ kind: 'base' }, ['b']],
    [{ kind: 'both', first: 'ours' }, ['o1', 'o2', 't1']],
    [{ kind: 'both', first: 'theirs' }, ['t1', 'o1', 'o2']],
    [{ kind: 'custom', lines: ['z'], source: 'manual' }, ['z']],
  ])('%j', (resolution, expected) => {
    expect(resolutionLines(c, resolution)).toEqual(expected);
  });

  it('gives no lines for base when there is no base', () => {
    expect(resolutionLines(conflict(['a'], null, ['b']), { kind: 'base' })).toEqual([]);
  });
});

describe('autoResolution', () => {
  it('takes theirs when only theirs changed', () => {
    const r = autoResolution(conflict(['b'], ['b'], ['t']));
    expect(r?.resolution).toEqual({ kind: 'theirs' });
    expect(r?.reason).toMatch(/only the incoming side/i);
  });

  it('takes ours when only ours changed', () => {
    expect(autoResolution(conflict(['o'], ['b'], ['b']))?.resolution).toEqual({ kind: 'ours' });
  });

  it('takes ours when both sides made the same change', () => {
    const r = autoResolution(conflict(['x'], ['b'], ['x']));
    expect(r?.resolution).toEqual({ kind: 'ours' });
    expect(r?.reason).toMatch(/same change/i);
  });

  it('takes ours when the sides differ only in whitespace', () => {
    const r = autoResolution(conflict(['  a  b'], ['c'], ['a b ']));
    expect(r?.resolution).toEqual({ kind: 'ours' });
    expect(r?.reason).toMatch(/whitespace/i);
  });

  it('leaves a real conflict alone', () => {
    expect(autoResolution(conflict(['o'], ['b'], ['t']))).toBeNull();
  });

  it('without a base only resolves identical sides', () => {
    expect(autoResolution(conflict(['x'], null, ['x']))?.resolution).toEqual({ kind: 'ours' });
    expect(autoResolution(conflict(['x'], null, ['x ']))).toBeNull();
    expect(autoResolution(conflict(['x'], null, ['y']))).toBeNull();
  });
});

describe('composeResult', () => {
  it('returns null while a conflict is unresolved', () => {
    expect(composeResult(parseMergedText(DIFF3), {})).toBeNull();
  });

  it('splices the chosen lines and keeps the trailing newline state', () => {
    const doc = parseMergedText(DIFF3);
    expect(composeResult(doc, { 0: { kind: 'ours' } })).toBe('line one\nours a\nline after\n');
    const noNl = parseMergedText(DIFF3.slice(0, -1));
    expect(composeResult(noNl, { 0: { kind: 'ours' } })).toBe('line one\nours a\nline after');
  });

  it('drops a conflict entirely when the resolution is empty', () => {
    const doc = parseMergedText(DIFF3);
    expect(composeResult(doc, { 0: { kind: 'custom', lines: [], source: 'manual' } })).toBe(
      'line one\nline after\n'
    );
  });
});

describe('hasConflictMarkers', () => {
  it.each([
    ['<<<<<<< HEAD\n', true],
    ['>>>>>>> x', true],
    ['a\n=======\nb\n>>>>>>> x', true],
    ['<<<<<<< a\r\n||||||| base\r\n', true],
    ['Title\n=======\nbody', false],
    ['||||||| base', false],
    ['a\r\n=======\r\n', false],
    ['========', false],
    ['  <<<<<<< indented', false],
    ['plain text', false],
  ])('%j -> %s', (text, expected) => {
    expect(hasConflictMarkers(text)).toBe(expected);
  });
});

describe('final newline when the file ends in a conflict', () => {
  // git's diff3 text ends every marker block with a newline, even when no
  // stage has one; the stage texts say how the file really ends.
  const merged = [
    'top',
    '<<<<<<< main',
    'o',
    '||||||| base',
    'b',
    '=======',
    't',
    '>>>>>>> feature/x',
    '',
  ].join('\n');
  const sides = { ours: 'top\no', theirs: 'top\nt\n', base: 'top\nb' };

  it.each<[Resolution, string]>([
    [{ kind: 'ours' }, 'top\no'],
    [{ kind: 'theirs' }, 'top\nt\n'],
    [{ kind: 'base' }, 'top\nb'],
    [{ kind: 'both', first: 'ours' }, 'top\no\nt\n'],
    [{ kind: 'both', first: 'theirs' }, 'top\nt\no'],
    [{ kind: 'custom', lines: ['c'], source: 'manual' }, 'top\nc\n'],
  ])('%j', (resolution, expected) => {
    const doc = parseMergedText(merged, { sides });
    expect(composeResult(doc, { 0: resolution })).toBe(expected);
  });

  it('uses the side that supplies the last line when the other is empty', () => {
    const empty = ['<<<<<<< main', 'o', '=======', '>>>>>>> feature/x', ''].join('\n');
    const doc = parseMergedText(empty, { sides: { ours: 'o', theirs: '', base: null } });
    expect(composeResult(doc, { 0: { kind: 'both', first: 'ours' } })).toBe('o');
  });

  it('keeps the doc default when the stage texts are unknown', () => {
    const doc = parseMergedText(merged);
    expect(composeResult(doc, { 0: { kind: 'ours' } })).toBe('top\no\n');
  });

  it('a clean last segment keeps the text ending', () => {
    const doc = parseMergedText('<<<<<<< a\nx\n=======\ny\n>>>>>>> b\nend', {
      sides: { ours: 'x\nend\n', theirs: 'y\nend\n', base: null },
    });
    expect(composeResult(doc, { 0: { kind: 'ours' } })).toBe('x\nend');
  });
});

describe('mixed line endings', () => {
  it('reads CRLF marker lines in a file that is not CRLF throughout', () => {
    const text = 'a\n<<<<<<< main\r\nx\r\n=======\r\ny\n>>>>>>> feature/x\r\nb\n';
    const doc = parseMergedText(text);
    expect(doc.eol).toBe('\n');
    expect(doc.conflictCount).toBe(1);
    expect(doc.segments[1]).toEqual({
      kind: 'conflict',
      index: 0,
      ours: ['x\r'],
      base: null,
      theirs: ['y'],
    });
    expect(composeResult(doc, { 0: { kind: 'ours' } })).toBe('a\nx\r\nb\n');
  });
});

describe('labels', () => {
  const labels = { ours: 'main', theirs: 'feature/x', base: 'base' };

  it('treats marker-shaped lines with another label as text', () => {
    const text = [
      'const fixture = `',
      '<<<<<<< HEAD',
      'a',
      '=======',
      'b',
      '>>>>>>> other',
      '`;',
      '<<<<<<< main',
      'ours',
      '||||||| base',
      'base',
      '=======',
      'theirs',
      '>>>>>>> feature/x',
      '',
    ].join('\n');
    const doc = parseMergedText(text, { labels });
    expect(doc.conflictCount).toBe(1);
    expect(doc.segments[0]).toEqual({
      kind: 'clean',
      lines: ['const fixture = `', '<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> other', '`;'],
    });
    expect(composeResult(doc, { 0: { kind: 'theirs' } })).toContain('<<<<<<< HEAD');
  });

  it('hasConflictMarkers with labels only flags what git wrote', () => {
    expect(hasConflictMarkers('<<<<<<< HEAD\n>>>>>>> other\n', labels)).toBe(false);
    expect(hasConflictMarkers('x\n<<<<<<< main\n', labels)).toBe(true);
    expect(hasConflictMarkers('x\r\n>>>>>>> feature/x\r\n', labels)).toBe(true);
    expect(hasConflictMarkers('<<<<<<< HEAD\n')).toBe(true);
  });
});
