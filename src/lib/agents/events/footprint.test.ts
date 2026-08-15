import { describe, expect, it } from 'vitest';
import { filesTouched } from './footprint';
import type { AgentEvent } from './types';

const edit = (path: string): AgentEvent => ({
  kind: 'edit',
  label: `Edited ${path}`,
  path,
  at: 0,
  seq: 0,
});
const read = (path: string): AgentEvent => ({
  kind: 'read',
  label: `Read ${path}`,
  path,
  at: 0,
  seq: 0,
});

describe('filesTouched', () => {
  it('collects paths from edit events only, ignoring reads', () => {
    expect(filesTouched([read('src/a.ts'), edit('src/b.ts')])).toEqual(['src/b.ts']);
  });

  it('keeps first-seen order and drops later duplicates', () => {
    expect(filesTouched([edit('src/a.ts'), edit('src/b.ts'), edit('src/a.ts')])).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('skips edit events with no path', () => {
    const noPath: AgentEvent = { kind: 'edit', label: 'Edited something', at: 0, seq: 0 };
    expect(filesTouched([noPath, edit('src/a.ts')])).toEqual(['src/a.ts']);
  });

  it('returns an empty array for no events', () => {
    expect(filesTouched([])).toEqual([]);
  });
});
