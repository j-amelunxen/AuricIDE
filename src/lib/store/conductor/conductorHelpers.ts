import { isClosedTicketStatus, type ModelPower } from '@/lib/pm/enums';
import { prependTicketSkills } from '@/lib/pm/ticketSkills';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmDependency, PmTestCase, PmTicket } from '@/lib/tauri/pm';
import { getGoalDescendants } from '../goalsSlice';
import { MAX_TICKET_ATTEMPTS, PRIORITY_ORDER, type ConductorPreflight } from './conductorTypes';

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

export function getConductorPreflight(input: {
  tickets: PmTicket[];
  dependencies: PmDependency[];
  goals: PmGoal[];
  goalId: string | null;
  failedTickets: Record<string, number>;
  approvedTickets: string[];
}): ConductorPreflight {
  const { tickets, dependencies, goals, goalId, failedTickets, approvedTickets } = input;
  const scoped = goalId ? filterTicketsForGoal(tickets, goals, goalId) : tickets;

  // Dependencies resolve against ALL tickets: a blocker outside the goal scope
  // still blocks, exactly as it does in the tick.
  const unblocked = new Set(
    getUnblockedOpenTickets(scoped, dependencies, tickets).map((t) => t.id)
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
    if (goal.description) sections.push(goal.description);
    if (goal.successCriteria) {
      sections.push(`The goal counts as achieved when:\n${goal.successCriteria}`);
    }
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
