import { describe, expect, it } from 'vitest';
import { editedRows, findClashes, rebaseDraft } from './draftMerge';

interface Row {
  id: string;
  status: string;
  note: string;
  predicate?: { type: string };
}

const row = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  status: 'active',
  note: '',
  ...over,
});

describe('rebaseDraft', () => {
  it('takes the fresh value of every field the draft left as it was', () => {
    const base = [row('a')];
    const draft = [row('a', { note: 'mine' })];
    const fresh = [row('a', { status: 'blocked' })];
    expect(rebaseDraft(draft, base, fresh)).toEqual([
      row('a', { note: 'mine', status: 'blocked' }),
    ]);
  });

  it('keeps the draft value of a field edited on both sides', () => {
    const base = [row('a')];
    const draft = [row('a', { status: 'paused' })];
    const fresh = [row('a', { status: 'blocked' })];
    expect(rebaseDraft(draft, base, fresh)[0].status).toBe('paused');
  });

  it('compares object fields by value, not identity', () => {
    const base = [row('a', { predicate: { type: 'human' } })];
    const draft = [row('a', { predicate: { type: 'human' } })];
    const fresh = [row('a', { predicate: { type: 'file_exists' } })];
    expect(rebaseDraft(draft, base, fresh)[0].predicate).toEqual({ type: 'file_exists' });
  });

  it('drops a row deleted elsewhere and keeps a row created locally', () => {
    const base = [row('gone')];
    const draft = [row('gone', { note: 'edited' }), row('local')];
    expect(rebaseDraft(draft, base, []).map((r) => r.id)).toEqual(['local']);
  });

  it('adds rows created elsewhere but not rows deleted locally', () => {
    const base = [row('deleted-here')];
    const draft: Row[] = [];
    const fresh = [row('deleted-here'), row('created-there')];
    expect(rebaseDraft(draft, base, fresh).map((r) => r.id)).toEqual(['created-there']);
  });
});

describe('editedRows', () => {
  it('returns new and edited rows, with a base only for rows that have one', () => {
    const base = [row('same'), row('edited')];
    const draft = [row('same'), row('edited', { note: 'x' }), row('new')];
    const { rows, bases } = editedRows(draft, base);
    expect(rows.map((r) => r.id)).toEqual(['edited', 'new']);
    expect(bases).toEqual([row('edited')]);
  });

  it('treats an equal object field as unchanged', () => {
    const base = [row('a', { predicate: { type: 'human' } })];
    const draft = [row('a', { predicate: { type: 'human' } })];
    expect(editedRows(draft, base).rows).toEqual([]);
  });
});

describe('findClashes', () => {
  it('names a field both sides changed to different values', () => {
    const base = [row('a')];
    const draft = [row('a', { status: 'paused', note: 'mine' })];
    const fresh = [row('a', { status: 'in_review', note: '' })];
    expect(findClashes(draft, base, fresh)).toEqual([{ id: 'a', columns: ['status'] }]);
  });

  it('does not count a field both sides set to the same value', () => {
    const draft = [row('a', { status: 'paused' })];
    const fresh = [row('a', { status: 'paused' })];
    expect(findClashes(draft, [row('a')], fresh)).toEqual([]);
  });

  it('ignores updatedAt, rows only one side touched, and rows gone or new', () => {
    const base = [
      { ...row('a'), updatedAt: '1' },
      { ...row('b'), updatedAt: '1' },
      { ...row('gone'), updatedAt: '1' },
    ];
    const draft = [
      { ...row('a', { note: 'mine' }), updatedAt: '2' },
      { ...row('b'), updatedAt: '1' },
      { ...row('gone', { status: 'paused' }), updatedAt: '2' },
      { ...row('new'), updatedAt: '2' },
    ];
    const fresh = [
      { ...row('a', { status: 'blocked' }), updatedAt: '3' },
      { ...row('b', { status: 'blocked' }), updatedAt: '3' },
    ];
    expect(findClashes(draft, base, fresh)).toEqual([]);
  });

  it('compares parsed JSON fields by value', () => {
    const base = [row('a', { predicate: { type: 'undefined' } })];
    const draft = [row('a', { predicate: { type: 'human' } })];
    const fresh = [row('a', { predicate: { type: 'human' } })];
    expect(findClashes(draft, base, fresh)).toEqual([]);
  });
});
