import { goalBriefSections } from '@/lib/goals/goalBrief';
import { isClosedTicketStatus, type ModelPower } from '@/lib/pm/enums';
import { prependTicketSkills } from '@/lib/pm/ticketSkills';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import type { PmGoal, PmGoalDependency, PmGoalStation } from '@/lib/tauri/goals';
import type { PmDependency, PmTestCase, PmTicket } from '@/lib/tauri/pm';
import { getGoalDescendants } from '../goalsSlice';
import { isGoalBlockedByDependency } from '../goals/goalDependencyAdapters';
import { getStationGoalWork, ticketsWorkedAsTickets } from './conductorStationGoals';
import { MAX_TICKET_ATTEMPTS, PRIORITY_ORDER, type ConductorPreflight } from './conductorTypes';

/**
 * A goal or planning agent the conductor started. These never enter
 * `conductorAssignments` (that map is keyed by ticket), so anything that
 * counts or stops the run's agents has to add them through this.
 * Agents a person started for a goal are not the conductor's to count or end.
 */
export function isConductorGoalAgent(
  agent: Pick<AgentInfo, 'id' | 'spawnedByGoalId' | 'spawnedByTicketId'>,
  spawnConfigs: Record<string, AgentConfig>
): boolean {
  return (
    spawnConfigs[agent.id]?.runSource === 'conductor' &&
    Boolean(agent.spawnedByGoalId) &&
    !agent.spawnedByTicketId
  );
}

/**
 * What a conductor run covers: the open project and, for a scoped run, its
 * goal and everything below it. Goal agents outlive the run that started them
 * (a budget stop leaves them working), so "a conductor goal agent" alone says
 * nothing about whether it is this run's to count or to end.
 */
export interface ConductorRunScope {
  rootPath: string | null;
  goalId: string | null;
  goals: PmGoal[];
}

/** The scope of the run the store holds, read from the fields that decide it. */
export function conductorRunScope(s: {
  rootPath?: string | null;
  conductorGoalId?: string | null;
  goalsDraft?: PmGoal[];
}): ConductorRunScope {
  return {
    rootPath: s.rootPath ?? null,
    goalId: s.conductorGoalId ?? null,
    goals: s.goalsDraft ?? [],
  };
}

/** Whether `goalId` is `rootId` or lies below it. Walks up, so it costs the depth. */
function isGoalWithin(goals: PmGoal[], goalId: string, rootId: string): boolean {
  const seen = new Set<string>();
  let current: string | null = goalId;
  while (current && !seen.has(current)) {
    if (current === rootId) return true;
    seen.add(current); // guards against corrupted cyclic data
    const at: string = current;
    current = goals.find((g) => g.id === at)?.parentId ?? null;
  }
  return false;
}

function isInRun(agent: AgentInfo, scope: ConductorRunScope): boolean {
  // An agent without a project path predates the field; its goal still decides.
  if (agent.projectPath && scope.rootPath && agent.projectPath !== scope.rootPath) return false;
  if (!scope.goalId) return true;
  return isGoalWithin(scope.goals, agent.spawnedByGoalId ?? '', scope.goalId);
}

function isLiveGoalAgent(
  agent: AgentInfo,
  spawnConfigs: Record<string, AgentConfig>,
  scope: ConductorRunScope
): boolean {
  return (
    (agent.status === 'running' || agent.status === 'queued') &&
    isConductorGoalAgent(agent, spawnConfigs) &&
    isInRun(agent, scope)
  );
}

/** Ids of this run's goal and planning agents that are still alive. */
export function liveConductorGoalAgentIds(
  agents: AgentInfo[],
  spawnConfigs: Record<string, AgentConfig>,
  scope: ConductorRunScope
): string[] {
  return agents.filter((a) => isLiveGoalAgent(a, spawnConfigs, scope)).map((a) => a.id);
}

/** How many of them there are — a number, so a store selector stays stable. */
export function countConductorGoalAgents(
  agents: AgentInfo[],
  spawnConfigs: Record<string, AgentConfig>,
  scope: ConductorRunScope
): number {
  return agents.filter((a) => isLiveGoalAgent(a, spawnConfigs, scope)).length;
}

/**
 * Mirrors the MCP `fetch_next_unblocked_task` semantics: a ticket is blocked
 * while any dependency target ticket is still live work. Sorted by priority
 * (critical > high > normal > low), then sortOrder.
 */
export function getUnblockedOpenTickets(
  scopedTickets: PmTicket[],
  dependencies: PmDependency[],
  allTickets: PmTicket[]
): PmTicket[] {
  const byId = new Map(allTickets.map((t) => [t.id, t]));
  const isBlocked = (ticket: PmTicket): boolean =>
    dependencies.some((d) => {
      if (d.sourceId !== ticket.id || d.targetType !== 'ticket') return false;
      const target = byId.get(d.targetId);
      return target !== undefined && !isClosedTicketStatus(target.status);
    });

  return scopedTickets
    .filter((t) => t.status === 'open' && !isBlocked(t))
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4) ||
        a.sortOrder - b.sortOrder
    );
}

/** Tickets attached to the goal or any goal in its subtree. */
export function filterTicketsForGoal(
  tickets: PmTicket[],
  goals: PmGoal[],
  goalId: string
): PmTicket[] {
  const ids = new Set<string>([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  return tickets.filter((t) => !!t.goalId && ids.has(t.goalId));
}

/**
 * Tickets whose goal (or an inherited edge from an ancestor) is not held by a
 * dependency: the ones the conductor may actually consider for a launch this
 * tick. A blocked-goal ticket stays put — still open, just not this run's turn
 * — so callers filter with this before `getUnblockedOpenTickets`, not instead
 * of it.
 */
export function ticketsWithUnblockedGoal(
  tickets: PmTicket[],
  goals: PmGoal[],
  goalDependencies: PmGoalDependency[]
): PmTicket[] {
  return tickets.filter(
    (t) => !t.goalId || !isGoalBlockedByDependency(goals, goalDependencies, t.goalId)
  );
}

// code-gate: complexity-cyclomatic - one status-bucketing function: each scoped ticket lands in exactly one of 8 mutually exclusive counters; splitting it would scatter that single classification across several functions
export function getConductorPreflight(input: {
  tickets: PmTicket[];
  dependencies: PmDependency[];
  goals: PmGoal[];
  goalId: string | null;
  failedTickets: Record<string, number>;
  approvedTickets: string[];
  /** Absent reads as "no stations": ticket-only callers need not pass it. */
  stations?: PmGoalStation[];
  /** Absent reads as "no goal dependencies". */
  goalDependencies?: PmGoalDependency[];
}): ConductorPreflight {
  const { tickets, dependencies, goals, goalId, failedTickets, approvedTickets } = input;
  const stations = input.stations ?? [];
  const goalDependencies = input.goalDependencies ?? [];
  // Tickets of a stations goal are the goal agent's, exactly as in the tick.
  const workable = ticketsWorkedAsTickets(tickets, goals, stations);
  const scoped = goalId ? filterTicketsForGoal(workable, goals, goalId) : workable;
  // Same predicate the tick uses to ask for goal agents, before anything is
  // in flight.
  const stationWork = getStationGoalWork({
    goals,
    tickets,
    stations,
    goalId,
    notifications: [],
    agents: [],
    projectPath: null,
    attempts: {},
    judgeConfigured: false,
    goalDependencies,
  });

  // Dependencies resolve against ALL tickets: a blocker outside the goal scope
  // still blocks, exactly as it does in the tick. A ticket whose goal is held
  // by a goal dependency is excluded the same way the tick excludes it before
  // spawning, so it reads here as "blocked" rather than "ready".
  const launchableTickets = ticketsWithUnblockedGoal(scoped, goals, goalDependencies);
  const unblocked = new Set(
    getUnblockedOpenTickets(launchableTickets, dependencies, tickets).map((t) => t.id)
  );

  const result: ConductorPreflight = {
    total: scoped.length,
    done: scoped.filter((ticket) => ticket.status === 'done').length,
    ready: 0,
    blocked: 0,
    needsApproval: 0,
    inProgress: 0,
    inReview: 0,
    toTest: 0,
    exhausted: 0,
    stationGoals: stationWork.inScope.length,
    stationGoalsReady: stationWork.launchable.length,
    stationGoalsBlocked: stationWork.blocked.length,
  };

  for (const ticket of scoped) {
    if (ticket.status === 'in_progress') {
      result.inProgress++;
      continue;
    }
    if (ticket.status === 'to_test') {
      result.toTest++;
      continue;
    }
    if (ticket.status === 'in_review') {
      result.inReview++;
      continue;
    }
    if (ticket.status !== 'open') continue;

    if ((failedTickets[ticket.id] ?? 0) >= MAX_TICKET_ATTEMPTS) {
      result.exhausted++;
    } else if (!unblocked.has(ticket.id)) {
      result.blocked++;
    } else if (ticket.needsHumanSupervision && !approvedTickets.includes(ticket.id)) {
      result.needsApproval++;
    } else {
      result.ready++;
    }
  }

  return result;
}

/** Maps a ticket's declared capability need to a concrete model. */
export function modelForPower(power: ModelPower | undefined): string {
  switch (power) {
    case 'low':
      return 'haiku';
    case 'high':
      return 'opus';
    default:
      return 'sonnet';
  }
}

/** Deterministic goal-aware prompt for a ticket agent. */
export function buildConductorPrompt(
  ticket: PmTicket,
  goal: PmGoal | undefined,
  testCases: PmTestCase[]
): string {
  const sections: string[] = [];
  sections.push(`# Task: ${ticket.name}`);
  if (ticket.description) sections.push(ticket.description);

  if (goal) {
    sections.push(
      `## Goal context\nThis task serves the goal "${goal.name}" (goalId: ${goal.id}). ` +
        'Use this exact goalId with the auric-pm MCP tools (e.g. get_goal, evaluate_goal) · ' +
        'do not look it up by name.'
    );
    sections.push(...goalBriefSections(goal));
  }

  if (testCases.length > 0) {
    sections.push(
      `## Acceptance tests\n${testCases.map((tc) => `- ${tc.title}: ${tc.body}`).join('\n')}`
    );
  }

  const contextItems = ticket.context ?? [];
  if (contextItems.length > 0) {
    sections.push(
      `## Context\n${contextItems
        .map((c) => (c.type === 'file' ? `Relevant file: ${c.value}` : c.value))
        .join('\n\n')}`
    );
  }

  sections.push(
    '## Working agreement\n' +
      'Work autonomously and stay strictly within the scope of this task. ' +
      'If the auric-pm MCP tools are available, you may add findings as context items, ' +
      'but do NOT change ticket statuses and do NOT call record_goal_run · the conductor ' +
      'already tracks this run and its completion. ' +
      'Exit with a non-zero code if you could not complete the task.'
  );

  const prompt = sections.join('\n\n');
  // Ticket work that serves a goal invokes the /goal command first.
  const withGoal = goal ? `/goal\n\n${prompt}` : prompt;
  return prependTicketSkills(ticket.skills, withGoal);
}
