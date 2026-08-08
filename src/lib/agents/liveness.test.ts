import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import {
  AGENT_ACTIVITY_BUMP_MS,
  AGENT_LIVE_WINDOW_MS,
  isAgentIdling,
  isAgentLive,
} from './liveness';

const running = (lastActivityAt?: number): AgentInfo => ({
  id: 'a1',
  name: 'Agent',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  lastActivityAt,
});

describe('agent liveness', () => {
  it('leaves room for at least one missed activity bump plus a UI tick', () => {
    // The store bumps lastActivityAt at most once per AGENT_ACTIVITY_BUMP_MS and
    // the cards re-render on a 1s tick. A window that is not wider than both
    // makes a continuously streaming agent flicker between Live and Idle.
    expect(AGENT_LIVE_WINDOW_MS).toBeGreaterThan(AGENT_ACTIVITY_BUMP_MS + 1_000);
  });

  it('counts an agent as live right after activity', () => {
    const now = 100_000;
    expect(isAgentLive(running(now - 100), now)).toBe(true);
  });

  it('stays live across a full bump interval of silence', () => {
    // A streaming agent's timestamp is up to AGENT_ACTIVITY_BUMP_MS stale by
    // design — that must not read as "gone quiet".
    const now = 100_000;
    expect(isAgentLive(running(now - AGENT_ACTIVITY_BUMP_MS - 500), now)).toBe(true);
  });

  it('drops out of live once the window has passed', () => {
    const now = 100_000;
    expect(isAgentLive(running(now - AGENT_LIVE_WINDOW_MS - 1), now)).toBe(false);
  });

  it('is not live without any recorded activity', () => {
    expect(isAgentLive(running(undefined), 100_000)).toBe(false);
  });

  it('is not live for a finished agent even with fresh activity', () => {
    const now = 100_000;
    const finished: AgentInfo = { ...running(now - 100), status: 'idle' };
    expect(isAgentLive(finished, now)).toBe(false);
  });

  it('treats a quiet running agent as idling', () => {
    const now = 100_000;
    expect(isAgentIdling(running(now - AGENT_LIVE_WINDOW_MS - 1), now)).toBe(true);
    expect(isAgentIdling(running(now - 100), now)).toBe(false);
  });

  it('does not call a stopped agent idling', () => {
    const stopped: AgentInfo = { ...running(undefined), status: 'idle' };
    expect(isAgentIdling(stopped, 100_000)).toBe(false);
  });
});
