import { describe, expect, it } from 'vitest';
import { appendCapped, appendCappedLog } from './appendCapped';

// Both helpers replace copy-twice code on the agent output path. They must
// produce exactly what the old code produced, for every input shape.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('appendCapped', () => {
  it('equals [...existing, ...incoming].slice(-max) for any sizes', () => {
    const rand = rng(7);
    for (let run = 0; run < 2000; run++) {
      const max = 1 + Math.floor(rand() * 20);
      const existing = Array.from({ length: Math.floor(rand() * 30) }, (_, i) => `e${i}`);
      const incoming = Array.from({ length: Math.floor(rand() * 30) }, (_, i) => `n${i}`);
      expect(appendCapped(existing, incoming, max)).toEqual([...existing, ...incoming].slice(-max));
    }
  });

  it('never hands back one of its inputs, so callers get a new array like before', () => {
    const existing = ['a'];
    const incoming = ['b'];
    const out = appendCapped(existing, incoming, 10);
    expect(out).not.toBe(existing);
    expect(out).not.toBe(incoming);
  });
});

/** The code this replaced, verbatim in its logic. */
function reference(
  prev: string[],
  chunks: string[],
  prevBytes: number,
  maxCount: number,
  maxBytes: number
) {
  let updated = [...prev, ...chunks];
  let bytes = prevBytes;
  for (const chunk of chunks) bytes += chunk.length;
  let drop = 0;
  while (updated.length - drop > 1 && (updated.length - drop > maxCount || bytes > maxBytes)) {
    bytes -= updated[drop].length;
    drop++;
  }
  if (drop > 0) updated = updated.slice(drop);
  return { logs: updated, bytes };
}

describe('appendCappedLog', () => {
  it('matches the previous trimming for any mix of counts and sizes', () => {
    const rand = rng(11);
    for (let run = 0; run < 3000; run++) {
      const maxCount = 1 + Math.floor(rand() * 15);
      const maxBytes = 1 + Math.floor(rand() * 200);
      const chunk = () => 'x'.repeat(Math.floor(rand() * 60));
      const prev = Array.from({ length: Math.floor(rand() * 20) }, chunk);
      const prevBytes = prev.reduce((n, c) => n + c.length, 0);
      const chunks = Array.from({ length: 1 + Math.floor(rand() * 20) }, chunk);
      expect(appendCappedLog(prev, chunks, prevBytes, maxCount, maxBytes)).toEqual(
        reference(prev, chunks, prevBytes, maxCount, maxBytes)
      );
    }
  });
});
