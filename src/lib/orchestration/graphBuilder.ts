import type { PmGoal, PmGoalRun } from '../tauri/goals';
import type { PmTicket } from '../tauri/pm';
import type { AgentInfo } from '../tauri/agents';
import { getGoalProgress, getRootGoals, getGoalChildren } from '../store/goalsSlice';

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
}

const COL_WIDTH = 320;
const ROW_HEIGHT = 96;

/**
 * Builds the live orchestration graph: the goal tree (left to right by depth),
 * tickets attached to goals, and running agents attached to their ticket or
 * goal. Pure function — feed it store state, render the result.
 */
export function buildOrchestrationGraph(
  goals: PmGoal[],
  tickets: PmTicket[],
  agents: AgentInfo[],
  runs: PmGoalRun[]
): { nodes: OrchestrationNode[]; edges: OrchestrationEdge[] } {
  const nodes: OrchestrationNode[] = [];
  const edges: OrchestrationEdge[] = [];

  // --- Goal columns by depth (BFS, cycle-safe) ---
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
  const maxGoalDepth = Math.max(0, ...Array.from(depthOf.values()));

  const rowCounters = new Map<number, number>();
  const nextRow = (col: number): number => {
    const row = rowCounters.get(col) ?? 0;
    rowCounters.set(col, row + 1);
    return row;
  };

  for (const goal of goals) {
    const goalDepth = depthOf.get(goal.id) ?? 0;
    const progress = getGoalProgress(goals, tickets, goal.id);
    nodes.push({
      id: `goal-${goal.id}`,
      type: 'orchestration',
      position: { x: goalDepth * COL_WIDTH, y: nextRow(goalDepth) * ROW_HEIGHT },
      data: {
        label: goal.name,
        kind: 'goal',
        status: goal.status,
        detail: goal.priority !== 'normal' ? goal.priority : undefined,
        progress: { done: progress.doneTickets, total: progress.totalTickets },
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

  // --- Tickets attached to goals ---
  const ticketCol = maxGoalDepth + 1;
  const goalIds = new Set(goals.map((g) => g.id));
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

  // --- Running agents attached to ticket (preferred) or goal ---
  const agentCol = ticketCol + 1;
  const shownTicketIds = new Set(shownTickets.map((t) => t.id));
  const runningRunByAgent = new Map(
    runs.filter((r) => r.outcome === 'running').map((r) => [r.agentId, r])
  );
  for (const agent of agents) {
    if (agent.status !== 'running') continue;
    const run = runningRunByAgent.get(agent.id);
    const ticketId = agent.spawnedByTicketId ?? run?.ticketId ?? null;
    const goalId = agent.spawnedByGoalId ?? run?.goalId ?? null;
    const source =
      ticketId && shownTicketIds.has(ticketId)
        ? `ticket-${ticketId}`
        : goalId && goalIds.has(goalId)
          ? `goal-${goalId}`
          : null;
    if (!source) continue; // free-floating agents are not part of the orchestration

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
