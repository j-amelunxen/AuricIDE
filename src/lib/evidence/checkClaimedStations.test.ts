import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PmGoalStation } from '@/lib/tauri/goals';

// Controlled store + judge model, so the sweep runs end-to-end (buildEvidenceContext
// → llmJudge → parseVerdictJson → applyJudgeVerdict → updateStation) without IPC.
const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  llmCall: vi.fn(),
}));
vi.mock('@/lib/store', () => ({ useStore: { getState: () => h.state } }));
vi.mock('@/lib/tauri/llm', () => ({ llmCall: h.llmCall }));
vi.mock('@/lib/tauri/git', () => ({ gitLogSince: vi.fn(async () => []) }));

import { checkClaimedStations } from './engine';

const TS = '2026-01-10 10:00:00';

function claim(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Build the parser',
    kind: 'normal',
    status: 'done',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    evidenceNote: 'implemented it',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: TS,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function seedStore(stations: PmGoalStation[], judgeConfigured = true) {
  const updateStation = vi.fn((id: string, updates: Partial<PmGoalStation>) => {
    const st = (h.state.goalStationsDraft as PmGoalStation[]).find((s) => s.id === id);
    if (st) Object.assign(st, updates);
  });
  h.state = {
    rootPath: '/p',
    pmDraftTickets: [],
    requirementsDraft: [],
    pmDraftTestCases: [],
    allFilePaths: [],
    judgeLlmConfigured: judgeConfigured,
    goalStationsDraft: stations,
    goalsDraft: [{ id: 'g1', name: 'Goal', successCriteria: 'ship it' }],
    updateStation,
    saveGoals: vi.fn(),
  };
  return updateStation;
}

describe('checkClaimedStations', () => {
  beforeEach(() => {
    h.llmCall.mockReset();
  });

  it('promotes a fresh passing claim to judged', async () => {
    const stations = [claim()];
    seedStore(stations);
    h.llmCall.mockResolvedValue({ content: '{"pass":true,"reason":"looks right"}' });

    await checkClaimedStations('g1');

    expect(stations[0].evidenceKind).toBe('judged');
    expect(stations[0].status).toBe('done');
    expect(stations[0].evidenceNote).toBe('looks right');
    expect(h.llmCall).toHaveBeenCalledTimes(1);
    // It used the judge model, not the implementer's.
    expect(h.llmCall.mock.calls[0][0]).toMatchObject({ role: 'judge' });
  });

  it('leaves a rejected claim blocking with the reason', async () => {
    const stations = [claim()];
    seedStore(stations);
    h.llmCall.mockResolvedValue({ content: '{"pass":false,"reason":"note is vague"}' });

    await checkClaimedStations('g1');

    expect(stations[0].evidenceKind).toBe('claim');
    expect(stations[0].evidenceNote).toContain('note is vague');
    expect(stations[0].lastCheckedAt).not.toBeNull(); // a judge ruled, stamped with the real now
  });

  it('judges each claim exactly once — a ruled claim is skipped (anti-thrash)', async () => {
    const stations = [claim({ lastCheckedAt: TS })]; // already ruled on
    seedStore(stations);

    await checkClaimedStations('g1');

    expect(h.llmCall).not.toHaveBeenCalled();
  });

  it('never promotes when no judge model is configured', async () => {
    const stations = [claim()];
    seedStore(stations, false);

    await checkClaimedStations('g1');

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(stations[0].evidenceKind).toBe('claim');
    expect(stations[0].lastCheckedAt).toBeNull(); // stays retryable once configured
  });

  it('treats a broken judge as a rejection, not a pass', async () => {
    const stations = [claim()];
    seedStore(stations);
    h.llmCall.mockResolvedValue({ content: 'not json at all' });

    await checkClaimedStations('g1');

    expect(stations[0].evidenceKind).toBe('claim');
    expect(stations[0].evidenceNote).toContain('judge unavailable');
    expect(stations[0].lastCheckedAt).not.toBeNull(); // a judge ruled, stamped with the real now
  });
});
