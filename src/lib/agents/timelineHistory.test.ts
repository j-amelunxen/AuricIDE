import { describe, expect, it } from 'vitest';
import type { AgentInfo } from './types';
import { buildSupervisorTimeline } from './supervisorTimeline';
import {
  TIMELINE_HISTORY_MS,
  mergeTimelineFleet,
  pruneTimelineHistory,
  snapshotTimelineAgent,
  stampTimelineEnded,
  upsertTimelineHistory,
} from './timelineHistory';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function agent(partial: Partial<AgentInfo> & Pick<AgentInfo, 'id' | 'name'>): AgentInfo {
  return {
    model: 'opus',
    provider: 'claude',
    status: 'running',
    startedAt: NOW - 10 * MIN,
    ...partial,
  };
}

describe('snapshotTimelineAgent', () => {
  it('keeps the fields the timeline draws and drops live-only noise', () => {
    const live = agent({
      id: 'child',
      name: 'Diagnose auric-p',
      model: 'grok-4.6',
      provider: 'xai',
      status: 'idle',
      startedAt: NOW - 20 * MIN,
      finishedAt: NOW - 5 * MIN,
      lastActivityAt: NOW - 5 * MIN,
      currentTask: 'Diagnose the hanging probe',
      currentActivity: 'reading files',
      awaitingInput: true,
      role: 'worker',
      spawnedByAgentId: 'sup',
      headless: true,
      repoPath: '/repo',
      supervisorKey: 'mail',
    });
    expect(snapshotTimelineAgent(live)).toEqual({
      id: 'child',
      name: 'Diagnose auric-p',
      model: 'grok-4.6',
      provider: 'xai',
      status: 'idle',
      startedAt: NOW - 20 * MIN,
      finishedAt: NOW - 5 * MIN,
      lastActivityAt: NOW - 5 * MIN,
      currentTask: 'Diagnose the hanging probe',
      role: 'worker',
      spawnedByAgentId: 'sup',
      headless: true,
      repoPath: '/repo',
      supervisorKey: 'mail',
    });
  });
});

describe('stampTimelineEnded', () => {
  it('closes a still-running run at now so the bar does not keep growing', () => {
    const live = agent({ id: 'a', name: 'Writer', status: 'running' });
    expect(stampTimelineEnded(live, NOW)).toMatchObject({
      id: 'a',
      status: 'idle',
      finishedAt: NOW,
    });
  });

  it('leaves an already finished run alone', () => {
    const done = agent({
      id: 'a',
      name: 'Writer',
      status: 'error',
      finishedAt: NOW - MIN,
    });
    expect(stampTimelineEnded(done, NOW).finishedAt).toBe(NOW - MIN);
    expect(stampTimelineEnded(done, NOW).status).toBe('error');
  });
});

describe('upsertTimelineHistory', () => {
  it('inserts, then overwrites the same id', () => {
    const first = agent({ id: 'a', name: 'Writer', status: 'running' });
    const stopped = { ...first, status: 'idle' as const, finishedAt: NOW };
    const once = upsertTimelineHistory([], [first], NOW);
    expect(once).toHaveLength(1);
    const twice = upsertTimelineHistory(once, [stopped], NOW);
    expect(twice).toHaveLength(1);
    expect(twice[0].status).toBe('idle');
    expect(twice[0].finishedAt).toBe(NOW);
  });
});

describe('pruneTimelineHistory', () => {
  it('drops a finished run whose whole bar sits older than the 24h window', () => {
    const old = agent({
      id: 'old',
      name: 'Old',
      status: 'idle',
      startedAt: NOW - TIMELINE_HISTORY_MS - 2 * MIN,
      finishedAt: NOW - TIMELINE_HISTORY_MS - MIN,
    });
    const recent = agent({
      id: 'recent',
      name: 'Recent',
      status: 'idle',
      startedAt: NOW - 30 * MIN,
      finishedAt: NOW - 10 * MIN,
    });
    const running = agent({
      id: 'live',
      name: 'Live',
      status: 'running',
      startedAt: NOW - TIMELINE_HISTORY_MS - MIN,
    });
    expect(pruneTimelineHistory([old, recent, running], NOW).map((a) => a.id)).toEqual([
      'recent',
      'live',
    ]);
  });
});

describe('mergeTimelineFleet', () => {
  it('lets the live record win when both lists have the same id', () => {
    const historical = agent({ id: 'a', name: 'Old name', status: 'idle', finishedAt: NOW - MIN });
    const live = agent({ id: 'a', name: 'New name', status: 'running' });
    const merged = mergeTimelineFleet([live], [historical]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(live);
  });

  it('keeps a dismissed child so the timeline still draws its bar and hand-off', () => {
    const supervisor = agent({
      id: 'sup',
      name: 'SoftwareDev',
      role: 'supervisor',
      startedAt: NOW - 40 * MIN,
    });
    const child = agent({
      id: 'kid',
      name: 'Diagnose auric-p',
      model: 'grok-4.6',
      spawnedByAgentId: 'sup',
      status: 'idle',
      startedAt: NOW - 20 * MIN,
      finishedAt: NOW - 5 * MIN,
      currentTask: 'Diagnose the hanging probe',
    });
    const fleet = mergeTimelineFleet([supervisor], [snapshotTimelineAgent(child)]);
    const model = buildSupervisorTimeline(fleet, 'sup', NOW, '30m');
    expect(model?.rows.map((row) => row.agent.id)).toEqual(['sup', 'kid']);
    expect(model?.rows[1].bar).toMatchObject({ tone: 'done' });
    expect(model?.handoffs).toEqual([expect.objectContaining({ fromId: 'sup', toId: 'kid' })]);
  });
});
