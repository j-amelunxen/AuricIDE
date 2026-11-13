import { describe, expect, it } from 'vitest';
import { sliceModelJson } from './modelJson';

describe('sliceModelJson', () => {
  it('takes the object out of fences and prose, whatever the fence case', () => {
    expect(sliceModelJson('Sure:\n```JSON\n{"a": 1}\n```\nDone.')).toEqual({
      ok: true,
      text: '{"a": 1}',
    });
  });

  it('spans nested objects to the last closer', () => {
    expect(sliceModelJson('x {"a": {"b": 2}} y')).toEqual({ ok: true, text: '{"a": {"b": 2}}' });
  });

  it('takes an array only when asked to', () => {
    expect(sliceModelJson('[1, 2]', { arrays: true })).toEqual({ ok: true, text: '[1, 2]' });
    expect(sliceModelJson('[1, 2]')).toEqual({ ok: false, reason: 'none' });
  });

  it('says whether nothing opened or nothing closed', () => {
    expect(sliceModelJson('no json here')).toEqual({ ok: false, reason: 'none' });
    expect(sliceModelJson('{"a": 1')).toEqual({ ok: false, reason: 'unterminated' });
  });
});
