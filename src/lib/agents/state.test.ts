import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { AGENT_STATE_LABEL, agentState } from './state';

const NOW = 1_000_000;

const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'a1',
  name: 'Agent',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  ...overrides,
});

describe('agentState', () => {
  it('calls a streaming agent working', () => {
    expect(agentState(agent({ lastActivityAt: NOW - 100 }), NOW)).toBe('working');
  });

  it('calls a running but quiet agent waiting', () => {
    expect(agentState(agent({ lastActivityAt: NOW - 60_000 }), NOW)).toBe('waiting');
  });

  it('separates a finished agent from a quiet one', () => {
    // The raw status field calls both of these "idle"; a person does not.
    expect(agentState(agent({ status: 'idle' }), NOW)).toBe('done');
    expect(agentState(agent({ status: 'running' }), NOW)).toBe('waiting');
  });

  it('reports a failed agent', () => {
    expect(agentState(agent({ status: 'error' }), NOW)).toBe('error');
  });

  it('reports a queued agent', () => {
    expect(agentState(agent({ status: 'queued' }), NOW)).toBe('queued');
  });

  it('labels every state', () => {
    const states = ['working', 'waiting', 'done', 'error', 'queued'] as const;
    states.forEach((state) => expect(AGENT_STATE_LABEL[state]).toBeTruthy());
  });

  it('never labels two different states the same way', () => {
    const labels = Object.values(AGENT_STATE_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
