import type { PmGoal, PmGoalDependency, PmGoalRun, PmGoalStation } from '../tauri/goals';
import type { PmTicket } from '../tauri/pm';
import type { AgentInfo } from '../tauri/agents';
import {
  getGoalWorkProgress,
  getRootGoals,
  getGoalChildren,
  getSiblingWaves,
} from '../store/goalsSlice';

export interface OrchestrationNodeData {
  label: string;
  kind: 'goal' | 'ticket' | 'agent';
  status: string;
  detail?: string;
  /** goal nodes: ticket progress across the subtree */
  progress?: { done: number; total: number };
  /** original entity id (goal id / ticket id / agent id) */
  entityId: string;
  [key: string]: unknown;
}

export interface OrchestrationNode {
  id: string;
  type: 'orchestration';
  position: { x: number; y: number };
  data: OrchestrationNodeData;
}

export interface OrchestrationEdge {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  /** A "waits for" edge, drawn dashed and kept apart from the parent→child tree. */
  kind?: 'dependency';
}

const COL_WIDTH = 320;
const ROW_HEIGHT = 96;

/**
 * Row order within a column follows the sibling wave: a serial chain reads
 * top to bottom in the order it actually runs, and parallel or bundled
 * siblings land next to each other instead of scattering by insertion order.
 */
function orderGoalsForRows(goals: PmGoal[], dependencies: PmGoalDependency[]): PmGoal[] {
  const waveOf = new Map<string, number>();
  for (const parentId of new Set(goals.map((g) => g.parentId))) {
    getSiblingWaves(goals, dependencies, parentId).forEach((wave, index) =>
      wave.forEach((id) => waveOf.set(id, index))
    );
  }
  return [...goals].sort(
    (a, b) =>
      (a.parentId ?? '').localeCompare(b.parentId ?? '') ||
      (waveOf.get(a.id) ?? 0) - (waveOf.get(b.id) ?? 0) ||
      a.sortOrder - b.sortOrder
  );
}

/**
 * Dashed, prerequisite → dependent edges, kept apart from the parent-child
 * tree edges so the two never look alike. Drops an edge whose endpoint fell
 * outside the rendered goal set (an orphaned or not-yet-loaded goal).
 */
function buildDependencyEdges(
  dependencies: PmGoalDependency[],
  depthOf: Map<string, number>
): OrchestrationEdge[] {
  const edges: OrchestrationEdge[] = [];
  for (const dep of dependencies) {
    if (!depthOf.has(dep.goalId) || !depthOf.has(dep.dependsOnGoalId)) continue;
    edges.push({
      id: `e-dep-${dep.dependsOnGoalId}-${dep.goalId}`,
      source: `goal-${dep.dependsOnGoalId}`,
      target: `goal-${dep.goalId}`,
      animated: false,
      kind: 'dependency',
    });
  }
  return edges;
}

/** BFS depth of every goal from its root, and the deepest column reached. */
function computeGoalDepths(goals: PmGoal[]): { depthOf: Map<string, number>; maxDepth: number } {
  const depthOf = new Map<string, number>();
  let frontier = getRootGoals(goals);
  let depth = 0;
  while (frontier.length > 0) {
    const next: PmGoal[] = [];
    for (const goal of frontier) {
      if (depthOf.has(goal.id)) continue;
      depthOf.set(goal.id, depth);
      next.push(...getGoalChildren(goals, goal.id));
    }
    frontier = next;
    depth += 1;
  }
  return { depthOf, maxDepth: Math.max(0, ...Array.from(depthOf.values())) };
}

/** One node per goal (columns by depth, rows by `orderGoalsForRows`), plus its parent edge. */
function buildGoalNodesAndEdges(
  goalsByRow: PmGoal[],
  goals: PmGoal[],
  tickets: PmTicket[],
  stations: PmGoalStation[],
  depthOf: Map<string, number>,
  nextRow: (col: number) => number
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];
  for (const goal of goalsByRow) {
    const goalDepth = depthOf.get(goal.id) ?? 0;
    const progress = getGoalWorkProgress(goals, tickets, stations, goal.id);
    nodes.push({
      id: `goal-${goal.id}`,
      type: 'orchestration',
      position: { x: goalDepth * COL_WIDTH, y: nextRow(goalDepth) * ROW_HEIGHT },
      data: {
        label: goal.name,
        kind: 'goal',
        status: goal.status,
        detail: goal.priority !== 'normal' ? goal.priority : undefined,
        progress: { done: progress.done, total: progress.total },
        entityId: goal.id,
      },
    });
    if (goal.parentId && depthOf.has(goal.parentId)) {
      edges.push({
        id: `e-goal-${goal.parentId}-${goal.id}`,
        source: `goal-${goal.parentId}`,
        target: `goal-${goal.id}`,
        animated: goal.status === 'in_progress',
      });
    }
  }
  return { nodes, edges };
}

/** One node per ticket attached to a rendered goal, plus its containment edge. */
function buildTicketNodesAndEdges(
  tickets: PmTicket[],
  goalIds: Set<string>,
  ticketCol: number,
  nextRow: (col: number) => number
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[]; shownTickets: PmTicket[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];
  const shownTickets = tickets.filter((t) => !!t.goalId && goalIds.has(t.goalId));
  for (const ticket of shownTickets) {
    nodes.push({
      id: `ticket-${ticket.id}`,
      type: 'orchestration',
      position: { x: ticketCol * COL_WIDTH, y: nextRow(ticketCol) * ROW_HEIGHT },
      data: {
        label: ticket.name,
        kind: 'ticket',
        status: ticket.status,
        entityId: ticket.id,
      },
    });
    edges.push({
      id: `e-ticket-${ticket.goalId}-${ticket.id}`,
      source: `goal-${ticket.goalId}`,
      target: `ticket-${ticket.id}`,
      animated: ticket.status === 'in_progress',
    });
  }
  return { nodes, edges, shownTickets };
}

/**
 * Where a running agent's node attaches: its ticket if that ticket is
 * rendered, else its goal if that goal is rendered, else nowhere — a
 * free-floating agent is not part of the orchestration.
 */
function resolveAgentSource(
  agent: AgentInfo,
  run: PmGoalRun | undefined,
  shownTicketIds: Set<string>,
  goalIds: Set<string>
): string | null {
  const ticketId = agent.spawnedByTicketId ?? run?.ticketId ?? null;
  if (ticketId && shownTicketIds.has(ticketId)) return `ticket-${ticketId}`;
  const goalId = agent.spawnedByGoalId ?? run?.goalId ?? null;
  if (goalId && goalIds.has(goalId)) return `goal-${goalId}`;
  return null;
}

/** One node per running agent attached to its ticket (preferred) or goal. */
function buildAgentNodesAndEdges(
  agents: AgentInfo[],
  runs: PmGoalRun[],
  shownTicketIds: Set<string>,
  goalIds: Set<string>,
  agentCol: number,
  nextRow: (col: number) => number
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];
  const runningRunByAgent = new Map(
    runs.filter((r) => r.outcome === 'running').map((r) => [r.agentId, r])
  );
  for (const agent of agents) {
    if (agent.status !== 'running') continue;
    const run = runningRunByAgent.get(agent.id);
    const source = resolveAgentSource(agent, run, shownTicketIds, goalIds);
    if (!source) continue;

    nodes.push({
      id: `agent-${agent.id}`,
      type: 'orchestration',
      position: { x: agentCol * COL_WIDTH, y: nextRow(agentCol) * ROW_HEIGHT },
      data: {
        label: agent.name,
        kind: 'agent',
        status: agent.status,
        detail: `${agent.model} · ${agent.provider}`,
        entityId: agent.id,
      },
    });
    edges.push({
      id: `e-agent-${agent.id}`,
      source,
      target: `agent-${agent.id}`,
      animated: true,
    });
  }
  return { nodes, edges };
}

/**
 * Builds the live orchestration graph: the goal tree (left to right by depth),
 * tickets attached to goals, and running agents attached to their ticket or
 * goal. Pure function — feed it store state, render the result. Each phase
 * (goals, dependency edges, tickets, agents) is its own step below; they share
 * only the column layout (`depthOf`) and the row counter (`nextRow`).
 */
export function buildOrchestrationGraph(
  goals: PmGoal[],
  tickets: PmTicket[],
  agents: AgentInfo[],
  runs: PmGoalRun[],
  /** Goal stations: a goal worked without tickets shows its station progress. */
  stations: PmGoalStation[] = [],
  /** "Waits for" edges: drawn as dashed edges and used to order a column's rows. */
  dependencies: PmGoalDependency[] = []
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const { depthOf, maxDepth: maxGoalDepth } = computeGoalDepths(goals);

  const rowCounters = new Map<number, number>();
  const nextRow = (col: number): number => {
    const row = rowCounters.get(col) ?? 0;
    rowCounters.set(col, row + 1);
    return row;
  };

  const goalsByRow = orderGoalsForRows(goals, dependencies);
  const goalPhase = buildGoalNodesAndEdges(goalsByRow, goals, tickets, stations, depthOf, nextRow);
  const dependencyEdges = buildDependencyEdges(dependencies, depthOf);

  const ticketCol = maxGoalDepth + 1;
  const goalIds = new Set(goals.map((g) => g.id));
  const ticketPhase = buildTicketNodesAndEdges(tickets, goalIds, ticketCol, nextRow);

  const agentCol = ticketCol + 1;
  const shownTicketIds = new Set(ticketPhase.shownTickets.map((t) => t.id));
  const agentPhase = buildAgentNodesAndEdges(
    agents,
    runs,
    shownTicketIds,
    goalIds,
    agentCol,
    nextRow
  );

  return {
    nodes: [...goalPhase.nodes, ...ticketPhase.nodes, ...agentPhase.nodes],
    edges: [...goalPhase.edges, ...dependencyEdges, ...ticketPhase.edges, ...agentPhase.edges],
  };
}
