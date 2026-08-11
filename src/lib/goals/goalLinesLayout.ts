import type {
  PmGoal,
  PmGoalRequirementLink,
  PmGoalRun,
  PmGoalStation,
  StationSourceContext,
} from '../tauri/goals';
import type { PmDependency, PmTicket } from '../tauri/pm';
import type { PmRequirement } from '../tauri/requirements';
import type { AgentInfo } from '../tauri/agents';
import { getGoalDescendants, getGoalSatisfaction, getRootGoals } from '../store/goalsSlice';
import { orderedStations } from './stationOrder';
import { staleStations } from '../evidence/staleness';
import { lineHue } from './lineColors';

export type StationState = 'done' | 'front' | 'planned' | 'fog';
export type EvidenceKind = 'proof' | 'judged' | 'claim' | 'human';
export type StationNodeKind = 'normal' | 'gate' | 'human' | 'terminus';

export interface LineStation {
  /** `ticket-<id>` | `req-<id>` | `terminus-<goalId>` in the derived board. */
  id: string;
  label: string;
  kind: StationNodeKind;
  state: StationState;
  /**
   * How sure we are the station's "done" is real. A ticket an agent marked
   * done is a claim, not a proof — the map draws it hollow on purpose.
   */
  evidence: EvidenceKind;
  /** 0..1 proximity to the terminus; the terminus is exactly 1. */
  x: number;
  ticketId?: string;
  requirementId?: string;
  /** Running agents currently perched at this station. */
  agentIds: string[];
  detail?: string;
  /** True when a machine predicate backs this station — a Verify can run. */
  checkable?: boolean;
  /** Machine evidence past its window: a proof from weeks ago is a memory. */
  stale?: boolean;
  /** Durable notes and frame references imported with this station. */
  sourceContext?: StationSourceContext;
}

export interface GoalLine {
  goalId: string;
  name: string;
  /** Explicit hex from lineColors — never the user-swappable accent. */
  hue: string;
  /** Ordered left → right; the terminus is always the last entry. */
  stations: LineStation[];
  lastDone: LineStation | null;
  now: LineStation | null;
  next: LineStation | null;
  /**
   * Epoch ms of the newest signal on this line; undefined while a running
   * agent works it — a worked line is never idle.
   */
  idleSince?: number;
  satisfied: boolean;
  blockers: string[];
  /** True when the line renders committed stations (reorderable), not derived tickets. */
  planCommitted: boolean;
}

export interface GoalLinesInput {
  goals: PmGoal[];
  tickets: PmTicket[];
  dependencies: PmDependency[];
  requirements: PmRequirement[];
  requirementLinks: PmGoalRequirementLink[];
  stations: PmGoalStation[];
  runs: PmGoalRun[];
  agents: AgentInfo[];
  now: number;
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** App timestamps are 'YYYY-MM-DD HH:MM:SS'; parse them the one way. */
function parseTs(ts: string): number {
  return Date.parse(ts.replace(' ', 'T'));
}

/**
 * Mirrors the conductor's blocking rule (and the MCP fetch_next_unblocked_task
 * semantics): a ticket is blocked while any of its dependency targets is not
 * done/archived.
 */
function isBlocked(
  ticket: PmTicket,
  dependencies: PmDependency[],
  ticketsById: Map<string, PmTicket>
): PmTicket | null {
  for (const dep of dependencies) {
    if (dep.sourceType !== 'ticket' || dep.sourceId !== ticket.id) continue;
    if (dep.targetType !== 'ticket') continue;
    const target = ticketsById.get(dep.targetId);
    if (target && target.status !== 'done' && target.status !== 'archived') {
      return target;
    }
  }
  return null;
}

/** Spread `count` stations across [from, to], strictly increasing. */
function spread(count: number, from: number, to: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + i * step);
}

/**
 * One goal as a metro line, derived entirely from data the app already
 * maintains — nothing on the board is hand-fed. Returns null for goals with
 * nothing attached: a line with no work would only pretend.
 */
export function buildGoalLine(input: GoalLinesInput, goalId: string): GoalLine | null {
  const {
    goals,
    tickets,
    dependencies,
    requirements,
    requirementLinks,
    stations: storedStations,
    runs,
    agents,
    now,
  } = input;
  const goal = goals.find((g) => g.id === goalId);
  if (!goal || goal.status === 'archived') return null;

  const subtreeIds = new Set<string>([
    goalId,
    ...getGoalDescendants(goals, goalId).map((g) => g.id),
  ]);
  const scopedTickets = tickets.filter(
    (t) => !!t.goalId && subtreeIds.has(t.goalId) && t.status !== 'archived'
  );
  const scopedLinks = requirementLinks.filter((l) => subtreeIds.has(l.goalId));
  // Subtree stations count toward satisfaction; drawn on the line are the
  // goal's own — child-goal stations surface through the blockers list.
  const goalStations = orderedStations(storedStations, goalId);
  if (scopedTickets.length === 0 && scopedLinks.length === 0 && goalStations.length === 0) {
    return null;
  }

  const ticketsById = new Map(tickets.map((t) => [t.id, t]));

  // --- Partition tickets by line state ---
  const done = scopedTickets
    .filter((t) => t.status === 'done')
    .sort((a, b) => a.statusUpdatedAt.localeCompare(b.statusUpdatedAt));
  const front = scopedTickets.filter((t) => t.status === 'in_progress');
  const open = scopedTickets.filter((t) => t.status === 'open');
  const blockedBy = new Map<string, PmTicket>();
  for (const t of open) {
    const blocker = isBlocked(t, dependencies, ticketsById);
    if (blocker) blockedBy.set(t.id, blocker);
  }
  const planned = open
    .filter((t) => !blockedBy.has(t.id))
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) ||
        a.sortOrder - b.sortOrder
    );
  const fog = open.filter((t) => blockedBy.has(t.id));

  const ticketStation = (t: PmTicket, state: StationState): LineStation => ({
    id: `ticket-${t.id}`,
    label: t.name,
    kind: t.needsHumanSupervision ? 'gate' : 'normal',
    state,
    evidence: t.needsHumanSupervision ? 'human' : 'claim',
    x: 0, // assigned below
    ticketId: t.id,
    agentIds: [],
    detail: state === 'fog' ? `blocked by "${blockedBy.get(t.id)!.name}"` : undefined,
  });

  // --- Requirement gates sit just before the terminus ---
  const linkedReqIds = new Set(scopedLinks.map((l) => l.requirementId));
  const gates: LineStation[] = requirements
    .filter((r) => linkedReqIds.has(r.id))
    .map((r) => ({
      id: `req-${r.id}`,
      label: r.title,
      kind: 'gate' as const,
      state: (r.status === 'verified' ? 'done' : 'planned') as StationState,
      evidence: 'claim' as const,
      x: 0,
      requirementId: r.id,
      agentIds: [],
      detail: r.status === 'verified' ? 'stamped, not machine-checked' : undefined,
    }));

  const satisfaction = getGoalSatisfaction(
    goals,
    tickets,
    requirements,
    requirementLinks,
    storedStations,
    goalId
  );

  const terminus: LineStation = {
    id: `terminus-${goalId}`,
    label: 'Goal',
    kind: 'terminus',
    state: satisfaction.satisfied || goal.status === 'achieved' ? 'done' : 'planned',
    evidence: 'proof', // satisfaction is machine-derived from statuses
    x: 1,
    agentIds: [],
  };

  let stations: LineStation[];
  if (goalStations.length > 0) {
    // --- Station-backed line: the stored plan is the map ---
    const staleIds = new Set(staleStations(goalStations, now).map((s) => s.id));
    const firstPendingId = goalStations.find((s) => s.status === 'planned')?.id;
    const mapped: LineStation[] = goalStations.map((st) => {
      const linked = st.ticketId ? ticketsById.get(st.ticketId) : undefined;
      const state: StationState =
        st.status === 'done'
          ? 'done'
          : st.status === 'fog'
            ? 'fog'
            : linked?.status === 'in_progress' || st.id === firstPendingId
              ? 'front'
              : 'planned';
      const detail =
        st.predicate.type === 'undefined'
          ? 'check to be defined'
          : st.status === 'done' && st.evidenceNote
            ? st.evidenceNote
            : undefined;
      return {
        id: st.id, // raw id so reorder targets resolve
        label: st.name,
        kind: st.kind === 'gate' ? 'gate' : st.kind === 'human' ? 'human' : 'normal',
        state,
        evidence: st.evidenceKind,
        x: 0,
        ticketId: st.ticketId ?? undefined,
        agentIds: [],
        detail,
        checkable: st.predicate.type !== 'human' && st.predicate.type !== 'undefined',
        stale: staleIds.has(st.id) || undefined,
        sourceContext: st.sourceContext,
      };
    });
    const sequence = [...mapped, ...gates];
    const xs = spread(sequence.length, 0.06, 0.92);
    sequence.forEach((s, i) => (s.x = xs[i]));
    stations = [...sequence, terminus];
  } else {
    // --- Derived line: tickets as stations (goals without a committed plan) ---
    const doneStations = done.map((t) => ticketStation(t, 'done'));
    const activeStations = [
      ...front.map((t) => ticketStation(t, 'front')),
      ...planned.map((t) => ticketStation(t, 'planned')),
      ...fog.map((t) => ticketStation(t, 'fog')),
      ...gates,
    ];

    // Geometry: done compressed left, active spread right, terminus at 1
    const doneXs = spread(doneStations.length, 0.05, 0.4);
    doneStations.forEach((s, i) => (s.x = doneXs[i]));
    const activeXs = spread(activeStations.length, 0.48, 0.92);
    activeStations.forEach((s, i) => (s.x = activeXs[i]));

    stations = [...doneStations, ...activeStations, terminus];
  }

  // --- Agents perched ---
  const running = agents.filter((a) => a.status === 'running');
  const byTicketStation = new Map(stations.filter((s) => s.ticketId).map((s) => [s.ticketId!, s]));
  const frontStation =
    stations.find((s) => s.state === 'front') ??
    stations.find((s) => s.state === 'planned') ??
    terminus;
  for (const agent of running) {
    const viaTicket = agent.spawnedByTicketId
      ? byTicketStation.get(agent.spawnedByTicketId)
      : undefined;
    if (viaTicket) {
      viaTicket.agentIds.push(agent.id);
    } else if (agent.spawnedByGoalId && subtreeIds.has(agent.spawnedByGoalId)) {
      frontStation.agentIds.push(agent.id);
    }
  }

  // --- idleSince: the newest signal, or nothing while an agent works ---
  const lineAgentIds = new Set(stations.flatMap((s) => s.agentIds));
  let idleSince: number | undefined;
  if (lineAgentIds.size === 0) {
    const signals: number[] = [];
    for (const t of scopedTickets) signals.push(parseTs(t.statusUpdatedAt));
    for (const r of runs) {
      if (subtreeIds.has(r.goalId) && r.finishedAt) signals.push(parseTs(r.finishedAt));
    }
    for (const a of agents) {
      const onLine =
        (a.spawnedByGoalId && subtreeIds.has(a.spawnedByGoalId)) ||
        (a.spawnedByTicketId && byTicketStation.has(a.spawnedByTicketId));
      if (onLine && a.finishedAt !== undefined) signals.push(a.finishedAt);
    }
    const newest = signals.filter((s) => Number.isFinite(s) && s <= now + 1);
    if (newest.length > 0) idleSince = Math.max(...newest);
  }

  const nonTerminus = stations.slice(0, -1);
  const lastDone = [...nonTerminus].reverse().find((s) => s.state === 'done') ?? null;
  const nowStation = nonTerminus.find((s) => s.state === 'front') ?? null;
  const nextStation = nonTerminus.find((s) => s.state === 'planned') ?? null;

  return {
    goalId,
    name: goal.name,
    hue: lineHue(goalId),
    stations,
    lastDone,
    now: nowStation,
    next: nextStation,
    idleSince,
    satisfied: satisfaction.satisfied,
    blockers: satisfaction.blockers,
    planCommitted: goalStations.length > 0,
  };
}

/**
 * Insertion index for a horizontal drop at x (0..1) among the line's
 * non-terminus stations: how many others sit left of the drop point.
 * Pure — the clamp against done work happens in stationOrder.moveStation.
 */
export function stationIndexForX(line: GoalLine, x: number, excludeId: string): number {
  return line.stations.filter((s) => s.kind !== 'terminus' && s.id !== excludeId && s.x < x).length;
}

/** All root goals with attached work, each as one line. */
export function buildGoalLines(input: GoalLinesInput): GoalLine[] {
  return getRootGoals(input.goals)
    .map((goal) => buildGoalLine(input, goal.id))
    .filter((line): line is GoalLine => line !== null);
}
