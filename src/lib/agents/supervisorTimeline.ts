import type { AgentInfo } from '../tauri/agents';
import {
  externalCountsAsOn,
  isExternalLive,
  isExternalStale,
  type ExternalAgent,
} from './externalAgents';
import { supervisorFamilyRoots } from './supervisorFamily';

/**
 * One supervisor family drawn as a time chart.
 *
 * Each agent in the fleet is one bar: the run the IDE already booked
 * (when it started, when it stopped, how it ended). Finished and dismissed
 * agents stay in that fleet via `agentTimelineHistory`; a bar is not a task
 * list. Nothing in the agent record distinguishes one chore from the next, so
 * inventing several bars would draw work that did not happen.
 *
 * A dotted hand-off is the spawn itself. It leaves the parent that was alive
 * when the child started, and it is omitted when that moment sits outside the
 * window — the curve would otherwise point at a time the chart does not show.
 *
 * External runs (`docs/design-external-agents.md`) get rows of their own and
 * figures of their own. They are not agents, so they stay out of `rows`,
 * `runningCount`, `outsideCount` and `handoffs`.
 */

const MINUTE = 60_000;

export const TIMELINE_RANGES = [
  { id: '30m', label: 'Last 30m', ms: 30 * MINUTE },
  { id: '2h', label: 'Last 2h', ms: 2 * 60 * MINUTE },
  { id: '24h', label: 'Last 24h', ms: 24 * 60 * MINUTE },
  { id: 'all', label: 'All', ms: null },
] as const;

export type TimelineRangeId = (typeof TIMELINE_RANGES)[number]['id'];

export type TimelineTone = 'running' | 'done' | 'error' | 'queued';

/** A task line longer than this is a launch prompt, not a bar caption. */
const BAR_LABEL_MAX = 48;

/** Below this, "All" would divide by a window that has no width. */
const MIN_ALL_SPAN = MINUTE;

const TICK_STEPS = [
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  60 * MINUTE,
  2 * 60 * MINUTE,
  4 * 60 * MINUTE,
  6 * 60 * MINUTE,
  12 * 60 * MINUTE,
  24 * 60 * MINUTE,
];

export interface TimelineBar {
  /** 0 at the left edge of the window, 1 at now. */
  start: number;
  end: number;
  /** The run began before the window; the bar is cut flush with the left edge. */
  clippedStart: boolean;
  tone: TimelineTone;
  label: string;
}

export interface TimelineRow {
  agent: AgentInfo;
  /** 0 is the supervisor. Each spawn step adds one. */
  depth: number;
  bar: TimelineBar | null;
}

export type ExternalTimelineTone =
  'external-on' | 'external-off' | 'external-stale' | 'done' | 'error';

export interface ExternalTimelineBar {
  start: number;
  end: number;
  clippedStart: boolean;
  /** The on-spans cut to the window, on the same 0..1 scale as the bar. */
  segments: { start: number; end: number }[];
  tone: ExternalTimelineTone;
  label: string;
}

export interface ExternalTimelineRow {
  external: ExternalAgent;
  /** Its owner has left the fleet; shown so that somebody can still close it. */
  orphaned: boolean;
  stale: boolean;
  bar: ExternalTimelineBar | null;
}

export interface TimelineHandoff {
  fromId: string;
  toId: string;
  fromRow: number;
  toRow: number;
  fromX: number;
  toX: number;
}

export interface TimelineTick {
  at: number;
  label: string;
}

export interface SupervisorTimelineModel {
  supervisorId: string;
  range: TimelineRangeId;
  windowStart: number;
  windowEnd: number;
  runningCount: number;
  /** Family members whose whole run sits outside the window. */
  outsideCount: number;
  rows: TimelineRow[];
  handoffs: TimelineHandoff[];
  ticks: TimelineTick[];
  externalRows: ExternalTimelineRow[];
  /** Entries reported as working and still heard from. */
  externalOnCount: number;
  /** Finished external runs of this timeline whose whole run sits outside the window. */
  externalOutsideCount: number;
}

export function timelineBarLabel(agent: Pick<AgentInfo, 'name' | 'currentTask'>): string {
  const first = agent.currentTask?.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!first || first.length > BAR_LABEL_MAX) return agent.name;
  return first;
}

export function buildSupervisorTimeline(
  agents: readonly AgentInfo[],
  supervisorId: string,
  now: number,
  range: TimelineRangeId,
  externals: readonly ExternalAgent[] = []
): SupervisorTimelineModel | null {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const supervisor = byId.get(supervisorId);
  if (!supervisor || supervisor.role !== 'supervisor') return null;

  const roots = supervisorFamilyRoots(agents);
  const family = agents.filter((agent) => roots.get(agent.id) === supervisorId);
  const ordered = [...family].sort((a, b) => compareRows(a, b, supervisorId));
  const own = externalsOf(externals, agents, family);
  const starts = [
    ...ordered.map((agent) => agent.startedAt),
    ...own.map((entry) => entry.external.registeredAt),
  ];
  const window = timelineWindow(range, now, starts);
  const rows = ordered
    .filter((agent) => agent.id === supervisorId || overlaps(agent, window.start, window.end, now))
    .map((agent) => ({
      agent,
      depth: depthOf(agent, byId, supervisorId),
      bar: placeBar(agent, window.start, window.end, now),
    }));
  const externalRows = own
    .map((entry) => ({
      ...entry,
      stale: isExternalStale(entry.external, now),
      bar: placeExternalBar(entry.external, window.start, window.end, now),
    }))
    .filter((row) => row.bar !== null)
    .sort(
      (a, b) =>
        a.external.registeredAt - b.external.registeredAt ||
        a.external.id.localeCompare(b.external.id)
    );

  return {
    supervisorId,
    range,
    windowStart: window.start,
    windowEnd: window.end,
    runningCount: rows.filter((row) => row.agent.status === 'running').length,
    outsideCount: ordered.length - rows.length,
    rows,
    handoffs: handoffsFor(rows, supervisorId),
    ticks: timelineTicks(window.start, window.end),
    externalRows,
    externalOnCount: externalRows.filter((row) => externalCountsAsOn(row.external, now)).length,
    externalOutsideCount: own.length - externalRows.length,
  };
}

/**
 * Entries of this family's supervisors, plus live ones nobody owns any more. The
 * family counts rather than the top supervisor alone: a supervisor started by
 * another shares its timeline, and its entries would otherwise show nowhere.
 */
function externalsOf(
  externals: readonly ExternalAgent[],
  agents: readonly AgentInfo[],
  family: readonly AgentInfo[]
): Pick<ExternalTimelineRow, 'external' | 'orphaned'>[] {
  const supervisorDirs = (list: readonly AgentInfo[]) =>
    new Set(list.filter((agent) => agent.role === 'supervisor').map((agent) => agent.repoPath));
  const familyDirs = supervisorDirs(family);
  const allDirs = supervisorDirs(agents);
  return externals.flatMap((external): Pick<ExternalTimelineRow, 'external' | 'orphaned'>[] => {
    if (familyDirs.has(external.ownerRunDir)) return [{ external, orphaned: false }];
    const orphaned = isExternalLive(external) && !allDirs.has(external.ownerRunDir);
    return orphaned ? [{ external, orphaned }] : [];
  });
}

function compareRows(a: AgentInfo, b: AgentInfo, supervisorId: string): number {
  if (a.id === supervisorId) return -1;
  if (b.id === supervisorId) return 1;
  return a.startedAt - b.startedAt || a.id.localeCompare(b.id);
}

function timelineWindow(
  range: TimelineRangeId,
  now: number,
  starts: readonly number[]
): { start: number; end: number } {
  const spec = TIMELINE_RANGES.find((item) => item.id === range) ?? TIMELINE_RANGES[0];
  if (spec.ms !== null) return { start: now - spec.ms, end: now };
  const earliest = starts.reduce((min, start) => Math.min(min, start), now);
  const start = Math.min(earliest, now);
  if (now - start < MIN_ALL_SPAN) return { start: now - MIN_ALL_SPAN, end: now };
  return { start, end: now };
}

function runEnd(agent: AgentInfo, now: number): number {
  if (agent.status === 'running' || agent.status === 'queued') {
    return Math.max(now, agent.startedAt);
  }
  const ended = agent.finishedAt ?? agent.lastActivityAt ?? agent.startedAt;
  return Math.max(ended, agent.startedAt);
}

function overlaps(agent: AgentInfo, windowStart: number, windowEnd: number, now: number): boolean {
  return runEnd(agent, now) > windowStart && agent.startedAt < windowEnd;
}

function barTone(agent: AgentInfo): TimelineTone {
  if (agent.status === 'running') return 'running';
  if (agent.status === 'queued') return 'queued';
  if (agent.status === 'error') return 'error';
  return 'done';
}

function placeBar(
  agent: AgentInfo,
  windowStart: number,
  windowEnd: number,
  now: number
): TimelineBar | null {
  const span = windowEnd - windowStart;
  const ended = runEnd(agent, now);
  if (span <= 0 || ended <= windowStart || agent.startedAt >= windowEnd) return null;
  return {
    start: Math.max(0, (agent.startedAt - windowStart) / span),
    end: Math.min(1, (ended - windowStart) / span),
    clippedStart: agent.startedAt < windowStart,
    tone: barTone(agent),
    label: timelineBarLabel(agent),
  };
}

function externalEnd(external: ExternalAgent, now: number): number {
  if (isExternalLive(external)) return Math.max(now, external.registeredAt);
  const ended = external.finishedAt ?? external.lastSeenAt;
  return Math.max(ended, external.registeredAt);
}

function externalTone(external: ExternalAgent, now: number): ExternalTimelineTone {
  if (external.state === 'failed') return 'error';
  if (external.state === 'stopped') return 'done';
  if (isExternalStale(external, now)) return 'external-stale';
  return external.state === 'running' ? 'external-on' : 'external-off';
}

function placeExternalBar(
  external: ExternalAgent,
  windowStart: number,
  windowEnd: number,
  now: number
): ExternalTimelineBar | null {
  const span = windowEnd - windowStart;
  const ended = externalEnd(external, now);
  if (span <= 0 || ended <= windowStart || external.registeredAt >= windowEnd) return null;
  const toWindow = (at: number) => Math.min(1, Math.max(0, (at - windowStart) / span));
  const segments = external.onSpans
    .map((on) => ({ from: on.from, to: on.to ?? ended }))
    .filter((on) => on.to > windowStart && on.from < windowEnd && on.to > on.from)
    .map((on) => ({ start: toWindow(on.from), end: toWindow(on.to) }));
  return {
    start: toWindow(external.registeredAt),
    end: toWindow(ended),
    clippedStart: external.registeredAt < windowStart,
    segments,
    tone: externalTone(external, now),
    label: external.ticketName ? `${external.ticketName} · ${external.name}` : external.name,
  };
}

function depthOf(agent: AgentInfo, byId: Map<string, AgentInfo>, supervisorId: string): number {
  let depth = 0;
  let current = agent;
  const seen = new Set([agent.id]);
  while (current.id !== supervisorId) {
    const parentId = current.spawnedByAgentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent || seen.has(parent.id)) return depth;
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

function handoffsFor(rows: readonly TimelineRow[], supervisorId: string): TimelineHandoff[] {
  const indexOf = new Map(rows.map((row, index) => [row.agent.id, index]));
  const links: TimelineHandoff[] = [];
  for (const row of rows) {
    if (row.agent.id === supervisorId || !row.bar || row.bar.clippedStart) continue;
    const parentIndex = parentIndexOf(row, indexOf, supervisorId);
    if (parentIndex === undefined) continue;
    const parent = rows[parentIndex];
    if (!parent.bar) continue;
    const toX = row.bar.start;
    const parentCovers = parent.bar.start <= toX && parent.bar.end >= toX;
    links.push({
      fromId: parent.agent.id,
      toId: row.agent.id,
      fromRow: parentIndex,
      toRow: indexOf.get(row.agent.id) ?? 0,
      fromX: parentCovers ? toX : Math.min(parent.bar.end, toX),
      toX,
    });
  }
  return links;
}

function parentIndexOf(
  row: TimelineRow,
  indexOf: Map<string, number>,
  supervisorId: string
): number | undefined {
  const parentId = row.agent.spawnedByAgentId;
  if (parentId && indexOf.has(parentId)) return indexOf.get(parentId);
  if (row.agent.id !== supervisorId && indexOf.has(supervisorId)) return indexOf.get(supervisorId);
  return undefined;
}

/** Even steps back from now, plus the "now" mark. About six labels, never the left edge. */
export function timelineTicks(start: number, end: number): TimelineTick[] {
  const span = end - start;
  if (span <= 0) return [{ at: 1, label: 'now' }];
  let step = TICK_STEPS[TICK_STEPS.length - 1];
  for (const candidate of TICK_STEPS) {
    if (span / candidate <= 6) {
      step = candidate;
      break;
    }
  }
  const ticks: TimelineTick[] = [];
  for (let ago = step; ago < span - step * 0.15; ago += step) {
    ticks.push({ at: 1 - ago / span, label: formatAgo(ago) });
  }
  ticks.reverse();
  ticks.push({ at: 1, label: 'now' });
  return ticks;
}

function formatAgo(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return `-${Math.max(1, Math.round(ms / 1000))}s`;
  if (minutes < 60) return `-${minutes}m`;
  const hours = ms / (60 * MINUTE);
  if (hours < 24) {
    const rounded = Math.round(hours * 2) / 2;
    return `-${rounded}h`;
  }
  return `-${Math.round(hours / 24)}d`;
}
