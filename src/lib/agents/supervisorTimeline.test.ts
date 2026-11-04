import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import type { ExternalAgent } from './externalAgents';
import { buildSupervisorTimeline, timelineBarLabel } from './supervisorTimeline';
import { mergeTimelineFleet } from './timelineHistory';

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

  it('still draws a finished child that is only in the merged history', () => {
    const live = [supervisor, runningChild, grandchild, queuedChild];
    const history = [failedChild];
    const model = buildSupervisorTimeline(mergeTimelineFleet(live, history), 'sup', NOW, '30m')!;
    expect(model.rows.map((row) => row.agent.id)).toEqual([
      'sup',
      'failed',
      'child',
      'grand',
      'queued',
    ]);
    expect(model.rows.find((row) => row.agent.id === 'failed')?.bar?.tone).toBe('error');
    expect(model.handoffs.some((link) => link.fromId === 'sup' && link.toId === 'failed')).toBe(
      true
    );
  });
});

describe('buildSupervisorTimeline: external runs', () => {
  const RUN_DIR = '/tmp/runs/own';
  const owner = agent({
    id: 'owner',
    name: 'Owner',
    role: 'supervisor',
    repoPath: RUN_DIR,
    startedAt: NOW - 20 * MIN,
  });
  const other = agent({
    id: 'other',
    name: 'Other',
    role: 'supervisor',
    repoPath: '/tmp/runs/other',
    startedAt: NOW - 20 * MIN,
  });

  function external(partial: Partial<ExternalAgent> = {}): ExternalAgent {
    return {
      id: 'ext-1',
      externalId: 'box-7',
      runId: null,
      projectPath: '/tmp/example-project',
      name: 'Fix the parser',
      provider: 'claude',
      model: 'opus',
      ticketId: null,
      ticketName: null,
      goalId: null,
      state: 'running',
      stale: false,
      registeredAt: NOW - 10 * MIN,
      lastSeenAt: NOW - MIN,
      finishedAt: null,
      onSpans: [{ from: NOW - 10 * MIN, to: null }],
      ownerRunDir: RUN_DIR,
      ownerAgentId: 'owner',
      closedBy: null,
      report: null,
      booked: false,
      ...partial,
    };
  }

  const build = (
    externals: ExternalAgent[],
    { fleet = [owner, other], id = 'owner', range = '30m' as const } = {}
  ) => buildSupervisorTimeline(fleet, id, NOW, range, externals)!;

  /* testuuid: t_q2nd8wle covers: el_extrow01 categories: happy level: unit */
  it('keeps externals out of the rows, the running count and the hand-offs', () => {
    const model = build([external()]);
    expect(model.rows.map((row) => row.agent.id)).toEqual(['owner']);
    expect(model.runningCount).toBe(1);
    expect(model.outsideCount).toBe(0);
    expect(model.handoffs).toEqual([]);
    expect(model.externalRows).toHaveLength(1);
    expect(model.externalOnCount).toBe(1);
  });

  it('has no external rows when none are passed, as before', () => {
    const model = buildSupervisorTimeline([owner], 'owner', NOW, '30m')!;
    expect(model.externalRows).toEqual([]);
    expect(model.externalOnCount).toBe(0);
  });

  it('draws registration to stop, with only the on time as a segment', () => {
    const model = build([
      external({
        state: 'registered',
        registeredAt: NOW - 20 * MIN,
        onSpans: [{ from: NOW - 15 * MIN, to: NOW - 9 * MIN }],
      }),
    ]);
    const { bar } = model.externalRows[0];
    expect(bar?.tone).toBe('external-off');
    expect(bar?.start).toBeCloseTo(10 / 30);
    expect(bar?.end).toBe(1);
    expect(bar?.clippedStart).toBe(false);
    expect(bar?.segments).toHaveLength(1);
    expect(bar?.segments[0].start).toBeCloseTo(15 / 30);
    expect(bar?.segments[0].end).toBeCloseTo(21 / 30);
    // Known but off: on the chart, not in the figure.
    expect(model.externalOnCount).toBe(0);
  });

  it('clips the bar and its segments to the window, and drops a segment outside it', () => {
    const model = build([
      external({
        registeredAt: NOW - 90 * MIN,
        onSpans: [
          { from: NOW - 80 * MIN, to: NOW - 70 * MIN },
          { from: NOW - 40 * MIN, to: NOW - 25 * MIN },
          { from: NOW - 5 * MIN, to: null },
        ],
      }),
    ]);
    const { bar } = model.externalRows[0];
    expect(bar?.start).toBe(0);
    expect(bar?.clippedStart).toBe(true);
    expect(bar?.segments).toHaveLength(2);
    expect(bar?.segments[0].start).toBe(0);
    expect(bar?.segments[0].end).toBeCloseTo(5 / 30);
    expect(bar?.segments[1].start).toBeCloseTo(25 / 30);
    expect(bar?.segments[1].end).toBe(1);
  });

  it('puts the ticket first in the label', () => {
    const model = build([external({ ticketName: 'Parser ticket' })]);
    expect(model.externalRows[0].bar?.label).toBe('Parser ticket · Fix the parser');
    expect(build([external()]).externalRows[0].bar?.label).toBe('Fix the parser');
  });

  it('reads tone from the state, with stale above running and off', () => {
    const tone = (partial: Partial<ExternalAgent>) =>
      build([external(partial)]).externalRows[0].bar?.tone;
    expect(tone({})).toBe('external-on');
    expect(tone({ state: 'registered' })).toBe('external-off');
    expect(tone({ lastSeenAt: NOW - 27 * 60 * MIN })).toBe('external-stale');
    expect(tone({ state: 'stopped', finishedAt: NOW - MIN })).toBe('done');
    expect(tone({ state: 'failed', finishedAt: NOW - MIN })).toBe('error');
  });

  it('does not count a stale entry as on', () => {
    const model = build([external({ lastSeenAt: NOW - 27 * 60 * MIN })]);
    expect(model.externalRows[0].stale).toBe(true);
    expect(model.externalOnCount).toBe(0);
  });

  it('hides an entry another live supervisor owns', () => {
    const foreign = external({ ownerRunDir: '/tmp/runs/other' });
    expect(build([foreign]).externalRows).toEqual([]);
    expect(build([foreign], { id: 'other' }).externalRows).toHaveLength(1);
  });

  it('shows a live entry with no owner in the fleet to every supervisor, marked', () => {
    const orphan = external({ ownerRunDir: '/tmp/runs/gone' });
    for (const id of ['owner', 'other']) {
      const [row] = build([orphan], { id }).externalRows;
      expect(row.orphaned).toBe(true);
    }
    expect(build([external()]).externalRows[0].orphaned).toBe(false);
  });

  it('does not show a final entry of a gone owner: there is nothing left to close', () => {
    const closed = external({
      ownerRunDir: '/tmp/runs/gone',
      state: 'stopped',
      finishedAt: NOW - MIN,
    });
    expect(build([closed]).externalRows).toEqual([]);
  });

  it('counts a supervisor started by another as part of its family, not as a stranger', () => {
    const nested = agent({
      id: 'nested',
      name: 'Nested',
      role: 'supervisor',
      repoPath: '/tmp/runs/nested',
      spawnedByAgentId: 'owner',
    });
    const entry = external({ ownerRunDir: '/tmp/runs/nested', ownerAgentId: 'nested' });
    const [row] = build([entry], { fleet: [owner, nested] }).externalRows;
    expect(row.orphaned).toBe(false);
    expect(build([entry], { fleet: [owner, nested, other], id: 'other' }).externalRows).toEqual([]);
  });

  it('filters a final entry by its stop and counts it as outside, keeping a live one', () => {
    const finished = external({
      id: 'ext-old',
      state: 'stopped',
      registeredAt: NOW - 3 * 60 * MIN,
      finishedAt: NOW - 2 * 60 * MIN,
      onSpans: [{ from: NOW - 3 * 60 * MIN, to: NOW - 2 * 60 * MIN }],
    });
    const parked = external({
      id: 'ext-parked',
      state: 'registered',
      registeredAt: NOW - 3 * 60 * MIN,
      onSpans: [],
    });
    const model = build([finished, parked]);
    expect(model.externalRows.map((row) => row.external.id)).toEqual(['ext-parked']);
    expect(model.externalOutsideCount).toBe(1);
    expect(model.outsideCount).toBe(0);
  });

  it('reaches back to the earliest registration when the range is All', () => {
    const early = external({ registeredAt: NOW - 500 * MIN, onSpans: [] });
    const model = buildSupervisorTimeline([owner], 'owner', NOW, 'all', [early])!;
    expect(model.windowStart).toBe(NOW - 500 * MIN);
    expect(model.externalRows[0].bar?.start).toBe(0);
    expect(model.externalRows[0].bar?.clippedStart).toBe(false);
  });

  it('does not stretch All for an entry that is not shown', () => {
    const foreign = external({ ownerRunDir: '/tmp/runs/other', registeredAt: NOW - 500 * MIN });
    const model = build([foreign], { range: 'all' as never });
    expect(model.windowStart).toBe(NOW - 20 * MIN);
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
