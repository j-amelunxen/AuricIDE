import { afterEach, describe, expect, it } from 'vitest';
import {
  accumulateHeartbeatBytes,
  drainHeartbeatBytes,
  dropAgentExtractor,
  extractorForAgent,
  pruneAgentRuntime,
  resetAgentExtractors,
} from './registry';

afterEach(() => resetAgentExtractors());

describe('extractorForAgent', () => {
  it('creates one extractor per agent id and reuses it on later calls', () => {
    const first = extractorForAgent('agent-1', 'claude');
    const second = extractorForAgent('agent-1', 'claude');
    expect(second).toBe(first);
  });

  it('gives independent agents independent extractors', () => {
    const a = extractorForAgent('agent-a', 'claude');
    const b = extractorForAgent('agent-b', 'claude');
    expect(a).not.toBe(b);
  });

  it('keeps buffered partial-line state across calls for the same agent', () => {
    extractorForAgent('agent-1', 'generic').push('$ pnpm te', 0);
    const events = extractorForAgent('agent-1', 'generic').push('st:run\n', 1);
    expect(events).toEqual([{ kind: 'run', label: 'Ran pnpm test:run', at: 1, seq: 0 }]);
  });

  it('runs the generic matcher when the agent has not landed in the fleet yet', () => {
    // Tauri does not order PTY output against the spawn result — a chunk can
    // arrive for an id appendAgentLog cannot yet resolve to a provider.
    const events = extractorForAgent('agent-1', undefined).push('$ pnpm build\n', 0);
    expect(events).toEqual([{ kind: 'run', label: 'Ran pnpm build', at: 0, seq: 0 }]);
  });

  it('rebuilds with the real matcher the first time a provider id becomes known', () => {
    extractorForAgent('agent-1', undefined); // agent unknown when the first chunk arrived
    // Now the agent has landed in `agents` and appendAgentLog can pass its
    // real provider — the extractor must actually start using it.
    const events = extractorForAgent('agent-1', 'claude').push('⏺ Read(src/x.ts)\n', 1);
    expect(events).toEqual([
      { kind: 'read', label: 'Read src/x.ts', path: 'src/x.ts', at: 1, seq: 0 },
    ]);
  });

  it('only rebuilds once — a provider id is confirmed and does not change again', () => {
    extractorForAgent('agent-1', undefined);
    const confirmed = extractorForAgent('agent-1', 'claude');
    // A later call (even with yet another provider id) must not rebuild —
    // once real, the provider never changes for a given agent.
    const stillConfirmed = extractorForAgent('agent-1', 'codex');
    expect(stillConfirmed).toBe(confirmed);
  });

  it('does not rebuild when the same known provider is passed again', () => {
    const first = extractorForAgent('agent-1', 'claude');
    const second = extractorForAgent('agent-1', 'claude');
    expect(second).toBe(first);
  });
});

describe('dropAgentExtractor', () => {
  it('makes the next call for that id build a fresh extractor', () => {
    const first = extractorForAgent('agent-1', 'claude');
    dropAgentExtractor('agent-1');
    const second = extractorForAgent('agent-1', 'claude');
    expect(second).not.toBe(first);
  });

  it('is a no-op for an id that was never created', () => {
    expect(() => dropAgentExtractor('never-seen')).not.toThrow();
  });

  it('also clears any pending, not-yet-drained heartbeat bytes', () => {
    accumulateHeartbeatBytes('agent-1', 100);
    dropAgentExtractor('agent-1');
    expect(drainHeartbeatBytes('agent-1')).toBe(0);
  });
});

describe('heartbeat byte accumulation', () => {
  it('accumulates bytes across calls until drained', () => {
    accumulateHeartbeatBytes('agent-1', 10);
    accumulateHeartbeatBytes('agent-1', 5);
    expect(drainHeartbeatBytes('agent-1')).toBe(15);
  });

  it('resets to zero once drained', () => {
    accumulateHeartbeatBytes('agent-1', 10);
    drainHeartbeatBytes('agent-1');
    expect(drainHeartbeatBytes('agent-1')).toBe(0);
  });

  it('returns zero for an id that never accumulated anything', () => {
    expect(drainHeartbeatBytes('never-seen')).toBe(0);
  });

  it('keeps different agents independent', () => {
    accumulateHeartbeatBytes('agent-a', 10);
    accumulateHeartbeatBytes('agent-b', 20);
    expect(drainHeartbeatBytes('agent-a')).toBe(10);
    expect(drainHeartbeatBytes('agent-b')).toBe(20);
  });
});

describe('pruneAgentRuntime', () => {
  it('drops the extractor and pending heartbeat bytes for ids not in the kept set', () => {
    const first = extractorForAgent('agent-1', 'claude');
    accumulateHeartbeatBytes('agent-1', 42);

    pruneAgentRuntime(['agent-2']);

    expect(extractorForAgent('agent-1', 'claude')).not.toBe(first);
    expect(drainHeartbeatBytes('agent-1')).toBe(0);
  });

  it('leaves ids in the kept set untouched', () => {
    const first = extractorForAgent('agent-1', 'claude');
    accumulateHeartbeatBytes('agent-1', 42);

    pruneAgentRuntime(['agent-1']);

    expect(extractorForAgent('agent-1', 'claude')).toBe(first);
    expect(drainHeartbeatBytes('agent-1')).toBe(42);
  });
});
