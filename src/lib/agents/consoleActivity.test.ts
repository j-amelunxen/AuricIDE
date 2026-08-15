import { describe, it, expect } from 'vitest';
import type { AgentEvent } from './events/types';
import { describeRightNow } from './consoleActivity';

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return { kind: 'note', label: 'x', at: 0, ...overrides };
}

describe('describeRightNow', () => {
  it('reads an edit event as present-continuous, preferring the path', () => {
    const line = describeRightNow({
      state: 'working',
      lastEvent: event({ kind: 'edit', label: 'Edited src/x.ts', path: 'src/x.ts' }),
    });
    expect(line).toBe('Editing src/x.ts');
  });

  it('reads a read event as present-continuous', () => {
    const line = describeRightNow({
      state: 'working',
      lastEvent: event({ kind: 'read', label: 'Read src/y.ts', path: 'src/y.ts' }),
    });
    expect(line).toBe('Reading src/y.ts');
  });

  it('reads a run event by its command, dropping the "Ran " prefix', () => {
    const line = describeRightNow({
      state: 'working',
      lastEvent: event({ kind: 'run', label: 'Ran pnpm lint' }),
    });
    expect(line).toBe('Running pnpm lint');
  });

  it('falls back to currentActivity with no structured event yet', () => {
    const line = describeRightNow({ state: 'working', currentActivity: 'Compiling…' });
    expect(line).toBe('Compiling…');
  });

  it('falls back to "Starting…" with neither an event nor an activity line', () => {
    expect(describeRightNow({ state: 'working' })).toBe('Starting…');
  });

  it('names the permission request when waiting on you', () => {
    const line = describeRightNow({
      state: 'yours',
      lastEvent: event({ kind: 'ask', label: 'Permission requested: Bash(pnpm test)' }),
    });
    expect(line).toBe('Waiting on permission: Bash(pnpm test)');
  });

  it('falls back to a plain wait line when yours but the ask event is missing', () => {
    expect(describeRightNow({ state: 'yours' })).toBe('Waiting on you');
  });

  it('reports the silence duration and the last thing seen when stalled', () => {
    const line = describeRightNow({
      state: 'stalled',
      quietFor: '6m',
      lastEvent: event({ kind: 'run', label: 'Ran cargo build --release' }),
    });
    expect(line).toBe('No output for 6m · last: Ran cargo build --release');
  });

  it('leads with Done for a finished agent', () => {
    const line = describeRightNow({
      state: 'done',
      lastEvent: event({ kind: 'note', label: '7 files created, 3 updated' }),
    });
    expect(line).toBe('Done · 7 files created, 3 updated');
  });

  it('leads with Failed for an errored agent', () => {
    const line = describeRightNow({
      state: 'error',
      lastEvent: event({ kind: 'error', label: '2 tests failing' }),
    });
    expect(line).toBe('Failed · 2 tests failing');
  });
});
