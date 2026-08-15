import { describe, expect, it } from 'vitest';
import { deriveAgentPhase } from './phase';
import type { AgentEvent } from './types';

const event = (kind: AgentEvent['kind']): AgentEvent => ({ kind, label: 'x', at: 0, seq: 0 });

describe('deriveAgentPhase', () => {
  it('is failed once the agent errors, regardless of its last event', () => {
    expect(deriveAgentPhase({ status: 'error', hasOutput: true, lastEvent: event('edit') })).toBe(
      'failed'
    );
  });

  it('is done once the agent goes idle, regardless of its last event', () => {
    expect(deriveAgentPhase({ status: 'idle', hasOutput: true, lastEvent: event('run') })).toBe(
      'done'
    );
  });

  it('is starting while queued, even with an event already recorded', () => {
    expect(deriveAgentPhase({ status: 'queued', hasOutput: true, lastEvent: event('read') })).toBe(
      'starting'
    );
  });

  it('is starting for a running agent with no output yet', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: false })).toBe('starting');
  });

  it('is waiting when awaitingInput is set, even if the last event was an edit', () => {
    expect(
      deriveAgentPhase({
        status: 'running',
        hasOutput: true,
        awaitingInput: true,
        lastEvent: event('edit'),
      })
    ).toBe('waiting');
  });

  it('is waiting when the last event itself was a permission ask', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true, lastEvent: event('ask') })).toBe(
      'waiting'
    );
  });

  it('maps an edit event to editing', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true, lastEvent: event('edit') })).toBe(
      'editing'
    );
  });

  it('maps a run event to running', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true, lastEvent: event('run') })).toBe(
      'running'
    );
  });

  it('maps a read event to reading', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true, lastEvent: event('read') })).toBe(
      'reading'
    );
  });

  it('falls back to planning for a note event', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true, lastEvent: event('note') })).toBe(
      'planning'
    );
  });

  it('falls back to planning when there is output but no event yet', () => {
    expect(deriveAgentPhase({ status: 'running', hasOutput: true })).toBe('planning');
  });
});
