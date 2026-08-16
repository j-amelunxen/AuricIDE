import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedAgentEvent } from '@/lib/tauri/agentLog';

const agentLogAppend = vi.fn<(events: PersistedAgentEvent[]) => Promise<void>>(
  async () => undefined
);
const agentLogPrune = vi.fn<(retentionDays: number, maxRows: number) => Promise<number>>(
  async () => 0
);

vi.mock('@/lib/tauri/agentLog', () => ({
  agentLogAppend: (events: PersistedAgentEvent[]) => agentLogAppend(events),
  agentLogPrune: (retentionDays: number, maxRows: number) => agentLogPrune(retentionDays, maxRows),
}));

import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { NOTE_MAX_CHARS } from './providers/shared';
import { REDACTED } from './redact';
import {
  flushAgentLog,
  pruneAgentLogHistory,
  recordAgentLogEvents,
  resetAgentLogWriter,
} from './persistence';
import type { AgentEvent } from './types';

const AGENT = { id: 'a1', name: 'Waitlist', repoPath: '/repos/acme-app' };
const event = (label: string, at = 1000, seq = 0): AgentEvent => ({
  kind: 'edit',
  label,
  at,
  seq,
});

function setPersist(on: boolean) {
  localStorage.setItem(APP_CONFIG_KEYS.agentLogPersist, String(on));
}

beforeEach(() => {
  localStorage.clear();
  resetAgentLogWriter();
  agentLogAppend.mockClear();
  agentLogPrune.mockClear();
});

afterEach(() => {
  resetAgentLogWriter();
});

describe('recordAgentLogEvents — the off switch', () => {
  it('writes nothing at all while persistence is off', async () => {
    // The invariant: off does not mean "written then discarded", it means the
    // events never leave memory.
    setPersist(false);
    recordAgentLogEvents(AGENT, [event('Edited a.ts')]);
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('writes nothing when the setting was never chosen', async () => {
    // Opt-in: an install must not start recording on the user's behalf.
    recordAgentLogEvents(AGENT, [event('Edited a.ts')]);
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('drops what it had buffered when the setting goes off mid-session', async () => {
    setPersist(true);
    recordAgentLogEvents(AGENT, [event('Edited a.ts')]);
    setPersist(false);
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });
});

describe('recordAgentLogEvents — writing', () => {
  beforeEach(() => setPersist(true));

  it('writes the batch once flushed', async () => {
    recordAgentLogEvents(AGENT, [event('Edited a.ts')]);
    await flushAgentLog();

    expect(agentLogAppend).toHaveBeenCalledTimes(1);
    expect(agentLogAppend.mock.calls[0][0]).toEqual([
      {
        agentId: 'a1',
        agentName: 'Waitlist',
        repoPath: '/repos/acme-app',
        kind: 'edit',
        label: 'Edited a.ts',
        path: undefined,
        at: 1000,
        seq: 0,
      },
    ]);
  });

  it('coalesces several agents into one write', async () => {
    // The store flushes per agent roughly once a second; a round trip each
    // would be one IPC call per agent per second for no gain.
    recordAgentLogEvents(AGENT, [event('Edited a.ts', 1000)]);
    recordAgentLogEvents({ id: 'b1', name: 'Linter' }, [event('Edited b.ts', 1001)]);
    await flushAgentLog();

    expect(agentLogAppend).toHaveBeenCalledTimes(1);
    expect(agentLogAppend.mock.calls[0][0]).toHaveLength(2);
  });

  it('carries the path through when the event has one', async () => {
    recordAgentLogEvents(AGENT, [{ ...event('Edited a.ts'), path: 'src/a.ts' }]);
    await flushAgentLog();

    expect(agentLogAppend.mock.calls[0][0][0]).toMatchObject({ path: 'src/a.ts' });
  });

  it('records an agent with no repo without inventing one', async () => {
    recordAgentLogEvents({ id: 'b1', name: 'Nomad' }, [event('Ran build')]);
    await flushAgentLog();

    expect(agentLogAppend.mock.calls[0][0][0].repoPath).toBeUndefined();
  });

  it('ignores an empty batch instead of writing nothing to disk', async () => {
    recordAgentLogEvents(AGENT, []);
    await flushAgentLog();

    expect(agentLogAppend).not.toHaveBeenCalled();
  });

  it('empties its buffer once written, so a second flush is not a duplicate', async () => {
    recordAgentLogEvents(AGENT, [event('Edited a.ts')]);
    await flushAgentLog();
    await flushAgentLog();

    expect(agentLogAppend).toHaveBeenCalledTimes(1);
  });

  it('keeps recording after a failed write rather than wedging', async () => {
    agentLogAppend.mockRejectedValueOnce(new Error('disk full'));
    recordAgentLogEvents(AGENT, [event('first')]);
    await flushAgentLog();

    recordAgentLogEvents(AGENT, [event('second', 2000)]);
    await flushAgentLog();

    expect(agentLogAppend).toHaveBeenCalledTimes(2);
    expect(agentLogAppend.mock.calls[1][0][0].label).toBe('second');
  });

  it('does not let a write failure reach the caller', async () => {
    // This runs off the PTY stream. A rejected promise here would surface as
    // an unhandled rejection in the middle of ordinary agent output.
    agentLogAppend.mockRejectedValueOnce(new Error('disk full'));
    recordAgentLogEvents(AGENT, [event('first')]);

    await expect(flushAgentLog()).resolves.toBeUndefined();
  });
});

describe('recordAgentLogEvents — what the on-disk copy may contain', () => {
  beforeEach(() => setPersist(true));

  it('masks a credential in the label it writes', async () => {
    recordAgentLogEvents(AGENT, [
      { kind: 'run', label: 'Ran EXAMPLE_API_KEY=sk-ant-000000000000000000 pnpm test', at: 1000 },
    ]);
    await flushAgentLog();

    expect(agentLogAppend.mock.calls[0][0][0].label).toBe(
      `Ran EXAMPLE_API_KEY=${REDACTED} pnpm test`
    );
  });

  it('leaves the caller its verbatim event, so the live feed still shows the real command', async () => {
    // Only the disk copy is masked. Redacting in place would blank the command
    // on screen, where seeing it is the point.
    const events: AgentEvent[] = [
      { kind: 'run', label: 'Ran EXAMPLE_API_KEY=sk-ant-000000000000000000 pnpm test', at: 1000 },
    ];
    recordAgentLogEvents(AGENT, events);
    await flushAgentLog();

    expect(events[0].label).toBe('Ran EXAMPLE_API_KEY=sk-ant-000000000000000000 pnpm test');
  });

  it('elides an error label, which reaches it with no cap of its own', async () => {
    // `note` labels are truncated by the extractor; `error` labels are the raw
    // result line, so the bound has to be applied here or nowhere.
    const shouted = `Failed: ${'x'.repeat(500)}`;
    recordAgentLogEvents(AGENT, [{ kind: 'error', label: shouted, at: 1000 }]);
    await flushAgentLog();

    const written = agentLogAppend.mock.calls[0][0][0].label;
    expect(written).toHaveLength(NOTE_MAX_CHARS + 1);
    expect(written.endsWith('…')).toBe(true);
  });

  it('keeps a short error label whole', async () => {
    recordAgentLogEvents(AGENT, [{ kind: 'error', label: 'Error: exit 1', at: 1000 }]);
    await flushAgentLog();

    expect(agentLogAppend.mock.calls[0][0][0].label).toBe('Error: exit 1');
  });

  it('does not elide a long label of another kind', async () => {
    // The cap exists because `error` bypasses the extractor's; nothing else
    // asked for its labels to be shortened on the way to disk.
    const long = `Ran ${'x'.repeat(500)}`;
    recordAgentLogEvents(AGENT, [{ kind: 'run', label: long, at: 1000 }]);
    await flushAgentLog();

    expect(agentLogAppend.mock.calls[0][0][0].label).toBe(long);
  });
});

describe('pruneAgentLogHistory', () => {
  it('does not touch the store while persistence is off', async () => {
    setPersist(false);
    await pruneAgentLogHistory();
    expect(agentLogPrune).not.toHaveBeenCalled();
  });

  it('prunes with the configured retention and the row cap', async () => {
    setPersist(true);
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, '7');
    await pruneAgentLogHistory();

    expect(agentLogPrune).toHaveBeenCalledWith(7, 200_000);
  });

  it('passes a retention of zero through as "no age limit"', async () => {
    // 0 is a real choice, not a missing value — the row cap still bounds it.
    setPersist(true);
    localStorage.setItem(APP_CONFIG_KEYS.agentLogRetentionDays, '0');
    await pruneAgentLogHistory();

    expect(agentLogPrune).toHaveBeenCalledWith(0, 200_000);
  });

  it('uses the two-day default when nothing was chosen', async () => {
    setPersist(true);
    await pruneAgentLogHistory();

    expect(agentLogPrune).toHaveBeenCalledWith(2, 200_000);
  });

  it('survives the store being unreachable', async () => {
    setPersist(true);
    agentLogPrune.mockRejectedValueOnce(new Error('no db'));
    await expect(pruneAgentLogHistory()).resolves.toBeUndefined();
  });
});
