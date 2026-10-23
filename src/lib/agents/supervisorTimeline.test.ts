import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import { buildSupervisorTimeline, timelineBarLabel } from './supervisorTimeline';

const NOW = 1_000_000_000_000;
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

const supervisor = agent({
  id: 'sup',
  name: 'Supervisor',
  role: 'supervisor',
  startedAt: NOW - 40 * MIN,
  currentTask: 'You are the AuricIDE supervisor. '.repeat(20),
});

describe('buildSupervisorTimeline', () => {
  const runningChild = agent({
    id: 'child',
    name: 'Writer',
    spawnedByAgentId: 'sup',
    startedAt: NOW - 10 * MIN,
    currentTask: 'Draft the pricing page',
    model: 'sonnet',
  });
  const failedChild = agent({
    id: 'failed',
    name: 'Ops',
    spawnedByAgentId: 'sup',
    status: 'error',
    startedAt: NOW - 20 * MIN,
    finishedAt: NOW - 15 * MIN,
    currentTask: 'Sync CRM',
  });
  const queuedChild = agent({
    id: 'queued',
    name: 'Reviewer',
    spawnedByAgentId: 'sup',
    status: 'queued',
    startedAt: NOW - 2 * MIN,
    model: 'gpt',
    provider: 'codex',
  });
  const earlierChild = agent({
    id: 'earlier',
    name: 'Researcher',
    spawnedByAgentId: 'sup',
    status: 'idle',
    startedAt: NOW - 120 * MIN,
    finishedAt: NOW - 90 * MIN,
  });
  const grandchild = agent({
    id: 'grand',
    name: 'Checker',
    spawnedByAgentId: 'child',
    startedAt: NOW - 5 * MIN,
    currentTask: 'Check the draft',
  });
  const otherSupervisor = agent({
    id: 'other',
    name: 'Other',
    role: 'supervisor',
    startedAt: NOW - 10 * MIN,
  });
  const stranger = agent({
    id: 'plain',
    name: 'Plain',
    spawnedByAgentId: 'other',
    startedAt: NOW - 8 * MIN,
  });

  const fleet = [
    stranger,
    earlierChild,
    queuedChild,
    supervisor,
    failedChild,
    runningChild,
    grandchild,
    otherSupervisor,
  ];

  it('puts the supervisor first and only its own family, oldest start first', () => {
    const model = buildSupervisorTimeline(fleet, 'sup', NOW, '30m');
    expect(model).not.toBeNull();
    expect(model?.rows.map((row) => [row.agent.id, row.depth])).toEqual([
      ['sup', 0],
      ['failed', 1],
      ['child', 1],
      ['grand', 2],
      ['queued', 1],
    ]);
    expect(model?.outsideCount).toBe(1);
    expect(model?.runningCount).toBe(3);
  });

  it('clips a run that started before the window and ends a finished run at finishedAt', () => {
    const model = buildSupervisorTimeline(fleet, 'sup', NOW, '30m')!;
    const own = model.rows[0].bar!;
    expect(own.clippedStart).toBe(true);
    expect(own.start).toBe(0);
    expect(own.end).toBe(1);
    expect(own.tone).toBe('running');
    expect(own.label).toBe('Supervisor');

    const failed = model.rows.find((row) => row.agent.id === 'failed')!.bar!;
    expect(failed.tone).toBe('error');
    expect(failed.start).toBeCloseTo(10 / 30);
    expect(failed.end).toBeCloseTo(15 / 30);
    expect(failed.label).toBe('Sync CRM');

    const writer = model.rows.find((row) => row.agent.id === 'child')!.bar!;
    expect(writer.label).toBe('Draft the pricing page');
    expect(writer.start).toBeCloseTo(20 / 30);
    expect(writer.end).toBe(1);

    const queued = model.rows.find((row) => row.agent.id === 'queued')!.bar!;
    expect(queued.tone).toBe('queued');
    expect(queued.start).toBeCloseTo(28 / 30);
  });

  it('draws a hand-off from the parent that was alive when the child started', () => {
    const model = buildSupervisorTimeline(fleet, 'sup', NOW, '30m')!;
    const toChild = model.handoffs.find((link) => link.toId === 'child');
    expect(toChild).toMatchObject({ fromId: 'sup', fromX: toChild?.toX });
    expect(toChild?.toX).toBeCloseTo(20 / 30);

    const toGrand = model.handoffs.find((link) => link.toId === 'grand');
    expect(toGrand?.fromId).toBe('child');
    expect(toGrand?.toX).toBeCloseTo(25 / 30);
    expect(toGrand?.fromX).toBeCloseTo(25 / 30);
  });

  it('leaves the connector at the parent bar end when the parent had already stopped', () => {
    const stopped = agent({
      ...supervisor,
      status: 'idle',
      finishedAt: NOW - 20 * MIN,
    });
    const model = buildSupervisorTimeline([stopped, runningChild], 'sup', NOW, '30m')!;
    expect(model.rows[0].bar).toMatchObject({ tone: 'done', start: 0 });
    expect(model.rows[0].bar?.end).toBeCloseTo(10 / 30);
    expect(model.handoffs).toEqual([
      expect.objectContaining({
        fromId: 'sup',
        toId: 'child',
        fromX: expect.closeTo(10 / 30),
        toX: expect.closeTo(20 / 30),
      }),
    ]);
  });

  it('labels a 30 minute window the way the axis reads: -25m through now', () => {
    const model = buildSupervisorTimeline([supervisor], 'sup', NOW, '30m')!;
    expect(model.ticks.map((tick) => tick.label)).toEqual([
      '-25m',
      '-20m',
      '-15m',
      '-10m',
      '-5m',
      'now',
    ]);
    expect(model.ticks[0].at).toBeCloseTo(5 / 30);
    expect(model.ticks.at(-1)?.at).toBe(1);
  });

  it('widens to every run still in the list when the range is All', () => {
    const model = buildSupervisorTimeline(fleet, 'sup', NOW, 'all')!;
    expect(model.rows.map((row) => row.agent.id)).toContain('earlier');
    expect(model.outsideCount).toBe(0);
    expect(model.windowStart).toBe(NOW - 120 * MIN);
    expect(model.rows.find((row) => row.agent.id === 'earlier')?.bar?.tone).toBe('done');
  });

  it('returns nothing for an agent that is not a supervisor', () => {
    expect(buildSupervisorTimeline(fleet, 'plain', NOW, '30m')).toBeNull();
    expect(buildSupervisorTimeline(fleet, 'missing', NOW, '30m')).toBeNull();
  });
});

describe('timelineBarLabel', () => {
  it('uses a short task and the agent name when the task is a long prompt', () => {
    expect(timelineBarLabel(supervisor)).toBe('Supervisor');
    expect(
      timelineBarLabel(agent({ id: 'w', name: 'Writer', currentTask: 'Draft the pricing page' }))
    ).toBe('Draft the pricing page');
    expect(timelineBarLabel(agent({ id: 'w', name: 'Writer' }))).toBe('Writer');
  });
});
