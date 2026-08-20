import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { runningAgentCount, quitWhileAgentsRunningRequest } from './closeGuard';

const agent = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status,
  startedAt: 0,
});

describe('runningAgentCount', () => {
  it('is zero when nobody is running', () => {
    expect(runningAgentCount([])).toBe(0);
    expect(runningAgentCount([agent('a', 'idle'), agent('b', 'error')])).toBe(0);
  });

  it('counts running agents, parked ones included, and ignores the rest', () => {
    expect(
      runningAgentCount([
        agent('run', 'running'),
        agent('parked-but-running', 'running'),
        agent('queued', 'queued'),
        agent('done', 'idle'),
      ])
    ).toBe(2);
  });

  it('does not treat a queued agent as running', () => {
    expect(runningAgentCount([agent('next', 'queued')])).toBe(0);
  });
});

describe('quitWhileAgentsRunningRequest', () => {
  it('names the one agent in the singular', () => {
    const request = quitWhileAgentsRunningRequest(1);
    expect(request.title).toBe('Agents are still running');
    expect(request.message).toMatch(/1 running agent/);
    expect(request.message).not.toMatch(/agents/);
    expect(request.confirmLabel).toBe('Close anyway');
  });

  it('names several agents in the plural', () => {
    const request = quitWhileAgentsRunningRequest(3);
    expect(request.message).toMatch(/3 running agents/);
    expect(request.confirmLabel).toBe('Close anyway');
  });
});
