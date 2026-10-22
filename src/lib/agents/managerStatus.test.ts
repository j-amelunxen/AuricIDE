import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AGENT_STALL_MS } from './attention';
import { liveSupervisorOfManager, managerMonogram, managerStatus } from './managerStatus';

const NOW = 10_000_000;
const supervisor = (patch: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'sv-1',
  name: 'sv-1',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: NOW - 60_000,
  lastActivityAt: NOW - 1_000,
  role: 'supervisor',
  supervisorKey: 'release-desk',
  ...patch,
});

describe('liveSupervisorOfManager', () => {
  it('finds the supervisor running under the manager key, and only that one', () => {
    const mine = supervisor();
    const other = supervisor({ id: 'sv-2', supervisorKey: 'inbox-triage' });
    expect(liveSupervisorOfManager([other, mine], 'release-desk')).toBe(mine);
    expect(liveSupervisorOfManager([other], 'release-desk')).toBeUndefined();
  });
});

describe('managerStatus', () => {
  it('is idle without a running supervisor', () => {
    expect(managerStatus(undefined, NOW)).toBe('idle');
  });

  it('is running while the supervisor works', () => {
    expect(managerStatus(supervisor(), NOW)).toBe('running');
  });

  it('asks for attention when the supervisor waits on a question', () => {
    expect(managerStatus(supervisor({ awaitingInput: true }), NOW)).toBe('attention');
  });

  it('asks for attention once the supervisor has been silent past the stall window', () => {
    const quiet = supervisor({ lastActivityAt: NOW - AGENT_STALL_MS - 1 });
    expect(managerStatus(quiet, NOW)).toBe('attention');
  });
});

describe('managerMonogram', () => {
  it.each([
    ['Release Desk', 'RD'],
    ['Inbox', 'IN'],
    ['  mail   triage  now ', 'MT'],
    ['Ünal Büro', 'ÜB'],
    ['', ''],
  ])('%j -> %j', (name, expected) => {
    expect(managerMonogram(name)).toBe(expected);
  });
});
