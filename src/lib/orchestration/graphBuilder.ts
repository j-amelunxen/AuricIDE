import dagre from '@dagrejs/dagre';
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

/** Matches `w-[260px]` in OrchestrationNode. */
const NODE_WIDTH = 260;
/** Tallest node shape: label row plus the progress/detail row. */
const NODE_HEIGHT = 64;
const ORIGIN = { x: 0, y: 0 };

/**
 * Insertion order for the layout: dagre seeds each column's order from it, so
 * siblings of one wave start out next to each other instead of scattering by
 * array order.
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

/** BFS depth of every goal from its root; doubles as the set of rendered goals. */
function computeGoalDepths(goals: PmGoal[]): Map<string, number> {
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
  return depthOf;
}

/** Goals that wait on one of their own siblings. */
function goalsWaitingOnSibling(goals: PmGoal[], dependencies: PmGoalDependency[]): Set<string> {
  const parentOf = new Map(goals.map((g) => [g.id, g.parentId]));
  const waiting = new Set<string>();
  for (const dep of dependencies) {
    const parent = parentOf.get(dep.goalId);
    if (parent !== undefined && parentOf.get(dep.dependsOnGoalId) === parent) {
      waiting.add(dep.goalId);
    }
  }
  return waiting;
}

/**
 * One node per goal, plus its parent edge — except for a goal that waits on a
 * sibling: it already hangs off the parent through that sibling's chain, and a
 * second line from the parent to every later wave is what turned a wide plan
 * into a fan of crossing edges.
 */
function buildGoalNodesAndEdges(
  goalsByRow: PmGoal[],
  goals: PmGoal[],
  tickets: PmTicket[],
  stations: PmGoalStation[],
  depthOf: Map<string, number>,
  dependencies: PmGoalDependency[]
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];
  const waitingOnSibling = goalsWaitingOnSibling(goals, dependencies);
  for (const goal of goalsByRow) {
    const progress = getGoalWorkProgress(goals, tickets, stations, goal.id);
    nodes.push({
      id: `goal-${goal.id}`,
      type: 'orchestration',
      position: ORIGIN,
      data: {
        label: goal.name,
        kind: 'goal',
        status: goal.status,
        detail: goal.priority !== 'normal' ? goal.priority : undefined,
        progress: { done: progress.done, total: progress.total },
        entityId: goal.id,
      },
    });
    if (goal.parentId && depthOf.has(goal.parentId) && !waitingOnSibling.has(goal.id)) {
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
  goalIds: Set<string>
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[]; shownTickets: PmTicket[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];
  const shownTickets = tickets.filter((t) => !!t.goalId && goalIds.has(t.goalId));
  for (const ticket of shownTickets) {
    nodes.push({
      id: `ticket-${ticket.id}`,
      type: 'orchestration',
      position: ORIGIN,
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
  goalIds: Set<string>
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
      position: ORIGIN,
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
 * Places every node with dagre, left to right — the same layout the sub-goal
 * plan graph uses. Tree edges and "waits for" edges both rank, so a serial
 * chain of siblings runs rightward and parallel siblings stack in one column,
 * instead of every child of a goal piling into a single column. Shifted so the
 * leftmost and topmost node sit at 0.
 */
function layoutGraph(nodes: OrchestrationNode[], edges: OrchestrationEdge[]): OrchestrationNode[] {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 16, ranksep: 72 });
  for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) graph.setEdge(edge.source, edge.target, {}, edge.id);
  dagre.layout(graph);

  const centers = nodes.map((node) => graph.node(node.id));
  const minX = Math.min(...centers.map((c) => c.x));
  const minY = Math.min(...centers.map((c) => c.y));
  return nodes.map((node, i) => ({
    ...node,
    position: { x: centers[i].x - minX, y: centers[i].y - minY },
  }));
}

/**
 * Builds the live orchestration graph: the goal tree, tickets attached to
 * goals, and running agents attached to their ticket or goal, laid out by
 * `layoutGraph`. Pure function — feed it store state, render the result.
 */
export function buildOrchestrationGraph(
  goals: PmGoal[],
  tickets: PmTicket[],
  agents: AgentInfo[],
  runs: PmGoalRun[],
  /** Goal stations: a goal worked without tickets shows its station progress. */
  stations: PmGoalStation[] = [],
  /** "Waits for" edges: drawn dashed, and they order siblings left to right. */
  dependencies: PmGoalDependency[] = []
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const depthOf = computeGoalDepths(goals);

  const goalsByRow = orderGoalsForRows(goals, dependencies);
  const goalPhase = buildGoalNodesAndEdges(
    goalsByRow,
    goals,
    tickets,
    stations,
    depthOf,
    dependencies
  );
  const dependencyEdges = buildDependencyEdges(dependencies, depthOf);

  const goalIds = new Set(goals.map((g) => g.id));
  const ticketPhase = buildTicketNodesAndEdges(tickets, goalIds);

  const shownTicketIds = new Set(ticketPhase.shownTickets.map((t) => t.id));
  const agentPhase = buildAgentNodesAndEdges(agents, runs, shownTicketIds, goalIds);

  const nodes = [...goalPhase.nodes, ...ticketPhase.nodes, ...agentPhase.nodes];
  const edges = [...goalPhase.edges, ...dependencyEdges, ...ticketPhase.edges, ...agentPhase.edges];
  return { nodes: nodes.length === 0 ? nodes : layoutGraph(nodes, edges), edges };
}
