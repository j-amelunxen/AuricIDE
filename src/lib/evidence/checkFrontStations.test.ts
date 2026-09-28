import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PmGoalStation, StationPredicate } from '@/lib/tauri/goals';

// The sweep runs on every burst of file changes while agents work. Each save
// writes project.db, and that write comes back through the watcher as a full
// PM/goals reload — so a sweep that saves when nothing changed feeds itself.
const h = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  llmCall: vi.fn(),
}));
vi.mock('@/lib/store', () => ({ useStore: { getState: () => h.state } }));
vi.mock('@/lib/tauri/llm', () => ({ llmCall: h.llmCall }));
vi.mock('@/lib/tauri/git', () => ({ gitLogSince: vi.fn(async () => []) }));

import { checkFrontStations } from './engine';

const TS = '2026-01-10 10:00:00';

function station(
  id: string,
  goalId: string,
  predicate: StationPredicate,
  overrides: Partial<PmGoalStation> = {}
): PmGoalStation {
  return {
    id,
    goalId,
    name: `Step ${id}`,
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate,
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function seedStore(stations: PmGoalStation[], allFilePaths: string[] = []) {
  const updateStation = vi.fn((id: string, updates: Partial<PmGoalStation>) => {
    const st = (h.state.goalStationsDraft as PmGoalStation[]).find((s) => s.id === id);
    if (st) Object.assign(st, updates);
  });
  const saveGoals = vi.fn(async () => undefined);
  h.state = {
    rootPath: '/p',
    pmDraftTickets: [],
    requirementsDraft: [],
    pmDraftTestCases: [],
    allFilePaths,
    judgeLlmConfigured: true,
    goalStationsDraft: stations,
    goalsDraft: [],
    updateStation,
    saveGoals,
  };
  return { updateStation, saveGoals };
}

describe('checkFrontStations', () => {
  beforeEach(() => {
    h.llmCall.mockReset();
    h.llmCall.mockResolvedValue({ content: '{"pass":false,"reason":"not yet"}' });
  });

  it('writes nothing when a re-check comes to the same result', async () => {
    const stations = [
      station(
        's1',
        'g1',
        { type: 'file_exists', glob: 'out/report.md' },
        {
          evidenceNote: 'out/report.md does not exist',
          lastCheckedAt: '2026-01-10 09:00:00',
        }
      ),
    ];
    const { updateStation, saveGoals } = seedStore(stations);

    await checkFrontStations();

    expect(updateStation).not.toHaveBeenCalled();
    expect(saveGoals).not.toHaveBeenCalled();
  });

  it('records a first result and saves it', async () => {
    const stations = [station('s1', 'g1', { type: 'file_exists', glob: 'out/report.md' })];
    const { updateStation, saveGoals } = seedStore(stations);

    await checkFrontStations();

    expect(updateStation).toHaveBeenCalledTimes(1);
    expect(stations[0].evidenceNote).toBe('out/report.md does not exist');
    expect(saveGoals).toHaveBeenCalledTimes(1);
  });

  it('saves once per sweep, however many stations changed', async () => {
    const stations = [
      station('a1', 'g1', { type: 'file_exists', glob: 'a.md' }),
      station('a2', 'g1', { type: 'file_exists', glob: 'b.md' }, { sortOrder: 1 }),
      station('b1', 'g2', { type: 'file_exists', glob: 'c.md' }),
    ];
    const { updateStation, saveGoals } = seedStore(stations, ['/p/a.md', '/p/c.md']);

    await checkFrontStations();

    expect(updateStation).toHaveBeenCalledTimes(3);
    expect(stations[0].status).toBe('done');
    expect(stations[2].status).toBe('done');
    expect(saveGoals).toHaveBeenCalledTimes(1);
  });

  it('leaves judged stations to the judge when asked to skip them', async () => {
    const stations = [station('s1', 'g1', { type: 'judged', prompt: 'is it done?' })];
    const { updateStation } = seedStore(stations);

    await checkFrontStations(undefined, { skipJudged: true });

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(updateStation).not.toHaveBeenCalled();
  });

  it('still judges them on a full sweep', async () => {
    const stations = [station('s1', 'g1', { type: 'judged', prompt: 'is it done?' })];
    seedStore(stations);

    await checkFrontStations('g1');

    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(stations[0].evidenceNote).toBe('not yet');
  });
});
