import { describe, expect, it } from 'vitest';
import { AGENT_EVENT_KINDS, isAgentEventKind } from './types';

describe('AGENT_EVENT_KINDS', () => {
  it('lists every kind AgentEvent can carry', () => {
    expect(AGENT_EVENT_KINDS).toEqual(['read', 'edit', 'run', 'ask', 'done', 'error', 'note']);
  });
});

describe('isAgentEventKind', () => {
  it('accepts every real event kind', () => {
    for (const kind of AGENT_EVENT_KINDS) {
      expect(isAgentEventKind(kind)).toBe(true);
    }
  });

  it('rejects a string that is not a real event kind', () => {
    expect(isAgentEventKind('bogus')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isAgentEventKind('')).toBe(false);
  });
});
