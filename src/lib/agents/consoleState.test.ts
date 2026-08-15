import { describe, it, expect } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { consoleAgentState, consoleStateLabel, CONSOLE_STATE_RANK } from './consoleState';

const NOW = 1_000_000;

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'Agent',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    startedAt: NOW - 10_000,
    ...overrides,
  };
}

describe('consoleAgentState', () => {
  it('is "error" for a failed agent', () => {
    expect(consoleAgentState(agent({ status: 'error' }), false, NOW)).toBe('error');
  });

  it('is "error" for a reviewed failed agent too — only the label softens', () => {
    expect(consoleAgentState(agent({ status: 'error' }), true, NOW)).toBe('error');
  });

  it('is "done" for a finished agent', () => {
    expect(consoleAgentState(agent({ status: 'idle' }), false, NOW)).toBe('done');
  });

  it('is "yours" when the agent awaits input', () => {
    expect(consoleAgentState(agent({ awaitingInput: true }), false, NOW)).toBe('yours');
  });

  it('is "stalled" when running silently past the stall window', () => {
    expect(consoleAgentState(agent({ lastActivityAt: NOW - 130_000 }), false, NOW)).toBe('stalled');
  });

  it('is "working" for an ordinary running agent', () => {
    expect(consoleAgentState(agent({ lastActivityAt: NOW - 1000 }), false, NOW)).toBe('working');
  });

  it('is "working" for a queued agent — not yet worth a distinct bucket', () => {
    expect(consoleAgentState(agent({ status: 'queued' }), false, NOW)).toBe('working');
  });
});

describe('consoleStateLabel', () => {
  it('labels every bucket', () => {
    expect(consoleStateLabel('yours', false)).toBe('Waiting on you');
    expect(consoleStateLabel('error', false)).toBe('Failed');
    expect(consoleStateLabel('error', true)).toBe('Failed');
    expect(consoleStateLabel('stalled', false)).toBe('Possibly stalled');
    expect(consoleStateLabel('working', false)).toBe('Running');
  });

  it('marks an unreviewed finish distinctly from a reviewed one', () => {
    expect(consoleStateLabel('done', false)).toBe('Done, unreviewed');
    expect(consoleStateLabel('done', true)).toBe('Done');
  });
});

describe('CONSOLE_STATE_RANK', () => {
  it('ranks urgency ahead of routine work, done last', () => {
    expect(CONSOLE_STATE_RANK.yours).toBeLessThan(CONSOLE_STATE_RANK.error);
    expect(CONSOLE_STATE_RANK.error).toBeLessThan(CONSOLE_STATE_RANK.stalled);
    expect(CONSOLE_STATE_RANK.stalled).toBeLessThan(CONSOLE_STATE_RANK.working);
    expect(CONSOLE_STATE_RANK.working).toBeLessThan(CONSOLE_STATE_RANK.done);
  });
});
