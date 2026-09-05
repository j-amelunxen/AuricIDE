import { reopenStationForRetry } from '@/lib/evidence/verdict';
import { notifyConductor } from '@/lib/ide/conductorNotifications';
import type { NotificationInput } from '@/lib/tauri/notifications';
import { getGoalDescendants, getGoalSatisfaction } from '../goalsSlice';
import {
  buildConductorPrompt,
  filterTicketsForGoal,
  getUnblockedOpenTickets,
  modelForPower,
} from './conductorHelpers';
import { applyVerdict } from './conductorReview';
import {
  MAX_TICKET_ATTEMPTS,
  PENDING_REVIEW,
  PENDING_SPAWN,
  REVIEW_TIMEOUT_MS,
  type ConductorDecision,
  type ConductorRunSummary,
  type ConductorSlice,
  type FullConductorStore,
} from './conductorTypes';

export interface ConductorTickContext {
  get: () => ConductorSlice;
  set: (fn: ((s: ConductorSlice) => Partial<ConductorSlice>) | Partial<ConductorSlice>) => void;
  cross: () => FullConductorStore;
  addDecision: (decision: Omit<ConductorDecision, 'id' | 'timestamp'>) => void;
  persist: () => Promise<void>;
  halt: () => void;
  finishRun: (
    outcome: ConductorRunSummary['outcome'],
    goalName: string | null,
    blockers: string[]
  ) => void;
  notifyInbox: (input: Omit<NotificationInput, 'source'>) => void;
}

export async function executeConductorTick(ctx: ConductorTickContext): Promise<void> {
  const { get, set, cross, addDecision, persist, halt, finishRun, notifyInbox } = ctx;
  if (!get().conductorRunning) return;
  const full = cross();
  const allTickets = full.pmDraftTickets ?? [];
  const goals = full.goalsDraft ?? [];
  const goalId = get().conductorGoalId;

  const scoped = goalId ? filterTicketsForGoal(allTickets, goals, goalId) : allTickets;

  // Watchdog: a review with no verdict past REVIEW_TIMEOUT_MS (a hung
  // reviewer, a lost spawn) must not park a ticket in_review forever. Time
  // it out into a rejection; kill a real reviewer, leave the inline marker.
  const nowMs = Date.now();
  for (const [reviewTicketId, startedAt] of Object.entries(get().conductorReviewStartedAt)) {
    if (nowMs - startedAt > REVIEW_TIMEOUT_MS) {
      const reviewer = get().conductorReviewAssignments[reviewTicketId];
      // Reject FIRST so the ticket leaves the review map, THEN kill the
      // process. Killing first would route through conductorHandleAgentKilled
      // (the review-map membership check) and double-handle the same ticket.
      applyVerdict(reviewTicketId, { pass: false, reason: 'Review timed out' }, ctx);
      if (reviewer && reviewer !== PENDING_REVIEW) void full.killRunningAgent?.(reviewer);
    }
  }

  // A judge rejected a ticket-linked station claim (done+claim, with a
  // lastCheckedAt stamp): the station half judged it, the conductor owns
  // reopening the ticket so it is reworked · within the shared attempt
  // ledger. A ticket in any non-done state is handled by the ticket judge;
  // this catches the case where the ticket is already done.
  if (goalId) {
    const subtree = new Set<string>([
      goalId,
      ...getGoalDescendants(goals, goalId).map((g) => g.id),
    ]);
    for (const st of full.goalStationsDraft ?? []) {
      if (
        !st.ticketId ||
        st.evidenceKind !== 'claim' ||
        st.lastCheckedAt === null ||
        !subtree.has(st.goalId)
      ) {
        continue;
      }
      const ticket = allTickets.find((t) => t.id === st.ticketId);
      if (ticket?.status !== 'done') continue;
      const fails = get().conductorFailedTickets[ticket.id] ?? 0;
      if (fails >= MAX_TICKET_ATTEMPTS) continue;
      full.updateTicket?.(ticket.id, { status: 'open' });
      full.updateStation?.(st.id, reopenStationForRetry());
      set((s: ConductorSlice) => ({
        conductorFailedTickets: { ...s.conductorFailedTickets, [ticket.id]: fails + 1 },
      }));
      addDecision({
        action: 'fail',
        detail: `Station "${st.name}" rejected by the judge · ticket reopened`,
        ticketId: ticket.id,
      });
    }
  }

  const assignments = get().conductorAssignments;
  // Both maps count: a run with only reviews in flight is still active and
  // must not auto-achieve the goal.
  const hasActiveAgents =
    Object.keys(assignments).length + Object.keys(get().conductorReviewAssignments).length > 0;

  // Budget spent and nothing in flight → the run stops because it was
  // told to, whether or not the goal has more open work. This must be
  // checked before workLeft below: workLeft alone would keep the loop
  // spawning past the budget on every subsequent tick. Only reachable
  // when a budget is actually set — conductorTicketBudget stays null for
  // an unlimited run, exactly today's behaviour.
  const ticketBudget = get().conductorTicketBudget;
  const budgetReached = ticketBudget !== null && get().conductorRunSpawned >= ticketBudget;
  // A budgeted ticket that failed and still has an attempt left is owed
  // its relaunch — the budget bought that ticket, not its first try. So
  // the run only ends once no such retry is waiting; otherwise the spawn
  // loop below (which exempts retries from the budget) picks it up.
  const retryPending = scoped.some((t) => {
    const fails = get().conductorFailedTickets[t.id] ?? 0;
    return t.status === 'open' && fails > 0 && fails < MAX_TICKET_ATTEMPTS;
  });
  if (budgetReached && !hasActiveAgents && !retryPending) {
    const goalName = goalId ? (goals.find((g) => g.id === goalId)?.name ?? null) : null;
    const spawned = get().conductorRunSpawned;
    halt();
    addDecision({
      action: 'stop',
      detail: `Ticket budget reached (${spawned}/${ticketBudget})`,
    });
    finishRun('budget_reached', goalName, []);
    void notifyConductor('run_finished', '');
    notifyInbox({
      severity: 'info',
      title: 'Conductor run finished · budget reached',
      body: `${spawned} of ${ticketBudget} ticket(s) started.`,
    });
    await persist();
    return;
  }

  // Scope exhausted: no open/in-progress work left and no agents running →
  // machine-check the goal and close the loop.
  const workLeft = scoped.some(
    (t) =>
      (t.status === 'open' && (get().conductorFailedTickets[t.id] ?? 0) < MAX_TICKET_ATTEMPTS) ||
      t.status === 'in_progress' ||
      // A ticket awaiting the judge is work in flight: it must not let the
      // loop auto-achieve the goal before the verdict lands.
      t.status === 'in_review'
  );
  if (!workLeft && !hasActiveAgents) {
    if (goalId) {
      const satisfaction = getGoalSatisfaction(
        goals,
        allTickets,
        full.requirementsDraft ?? [],
        full.goalRequirementLinksDraft ?? [],
        full.goalStationsDraft ?? [],
        goalId
      );
      const goalName = goals.find((g) => g.id === goalId)?.name ?? null;
      if (satisfaction.satisfied) {
        full.achieveGoal?.(goalId);
        addDecision({
          action: 'goal_achieved',
          detail: `Goal ${goalId} achieved · all checks green`,
        });
        halt();
        finishRun('goal_achieved', goalName, []);
        void notifyConductor('goal_achieved', goalName ?? goalId);
        notifyInbox({
          severity: 'success',
          title: `Goal achieved: ${goalName ?? goalId}`,
          body: 'All tickets done, all requirements verified.',
          refKind: 'goal',
          refId: goalId,
          dedupeKey: `goal:${goalId}:achieved`,
          actions: [
            {
              id: 'open',
              label: 'Open goal',
              kind: 'open',
              target: { type: 'goal', goalId },
            },
          ],
        });
      } else {
        halt();
        addDecision({
          action: 'stop',
          detail: `No work left but goal not satisfied: ${satisfaction.blockers.join('; ')}`,
        });
        finishRun('goal_blocked', goalName, satisfaction.blockers);
        void notifyConductor('goal_blocked', satisfaction.blockers.join('; '));
        notifyInbox({
          severity: 'warn',
          title: `Goal blocked: ${goalName ?? goalId}`,
          body: satisfaction.blockers.join(' · '),
          refKind: 'goal',
          refId: goalId,
          dedupeKey: `goal:${goalId}:blocked`,
          actions: [
            {
              id: 'open',
              label: 'Open goal',
              kind: 'open',
              target: { type: 'goal', goalId },
            },
          ],
        });
      }
    } else {
      halt();
      addDecision({ action: 'stop', detail: 'All unblocked tickets processed' });
      finishRun('finished', null, []);
      void notifyConductor('run_finished', '');
      notifyInbox({
        severity: 'info',
        title: 'Conductor run finished',
        body: 'All unblocked tickets are done.',
      });
    }
    await persist();
    return;
  }

  const unblocked = getUnblockedOpenTickets(scoped, full.pmDraftDependencies ?? [], allTickets);
  let mutated = false;

  for (const ticket of unblocked) {
    const state = get();
    if (!state.conductorRunning) break;
    const capacity =
      state.conductorMaxConcurrent -
      Object.keys(state.conductorAssignments).length -
      Object.keys(state.conductorReviewAssignments).length;
    if (capacity <= 0) break;
    if (state.conductorAssignments[ticket.id]) continue;
    if ((state.conductorFailedTickets[ticket.id] ?? 0) >= MAX_TICKET_ATTEMPTS) continue;

    if (ticket.needsHumanSupervision && !state.conductorApprovedTickets.includes(ticket.id)) {
      if (!state.conductorPendingApprovals.includes(ticket.id)) {
        set({ conductorPendingApprovals: [...state.conductorPendingApprovals, ticket.id] });
        addDecision({
          action: 'approval_needed',
          detail: `Ticket "${ticket.name}" needs human approval before launch`,
          ticketId: ticket.id,
        });
        void notifyConductor('approval_needed', ticket.name);
        notifyInbox({
          severity: 'warn',
          title: `Approval needed: ${ticket.name}`,
          body: 'The Conductor is waiting for your approval before it starts.',
          refKind: 'ticket',
          refId: ticket.id,
          dedupeKey: `ticket:${ticket.id}:approval`,
          actions: [
            {
              id: 'open',
              label: 'Open approval',
              kind: 'open',
              target: { type: 'ticket', ticketId: ticket.id },
            },
          ],
        });
      }
      continue;
    }

    const isRetryThisRun = (state.conductorFailedTickets[ticket.id] ?? 0) > 0;
    if (
      state.conductorTicketBudget !== null &&
      !isRetryThisRun &&
      state.conductorRunSpawned >= state.conductorTicketBudget
    ) {
      continue;
    }

    const effectiveGoalId = ticket.goalId ?? goalId ?? undefined;
    const goal = goals.find((g) => g.id === effectiveGoalId);
    const testCases = (full.pmDraftTestCases ?? []).filter((tc) => tc.ticketId === ticket.id);
    const prompt = buildConductorPrompt(ticket, goal, testCases);
    const model = get().conductorModel || modelForPower(ticket.modelPower);
    const providerOverride = get().conductorProviderId ?? undefined;

    // Reserve the ticket synchronously BEFORE the async spawn so a
    // concurrent tick can never double-spawn for the same ticket.
    set((s: ConductorSlice) => ({
      conductorAssignments: { ...s.conductorAssignments, [ticket.id]: PENDING_SPAWN },
    }));

    let agent;
    try {
      agent = await full.spawnNewAgent?.({
        name: `conductor:${ticket.name.slice(0, 40)}`,
        model,
        provider: providerOverride,
        task: prompt,
        cwd: ticket.workingDirectory ?? full.rootPath ?? undefined,
        headless: true,
        spawnedByTicketId: ticket.id,
        spawnedByGoalId: effectiveGoalId,
        runSource: 'conductor',
      });
    } catch {
      agent = undefined;
    }

    if (!agent) {
      set((s: ConductorSlice) => {
        const { [ticket.id]: _released, ...rest } = s.conductorAssignments;
        return {
          conductorAssignments: rest,
          conductorFailedTickets: {
            ...s.conductorFailedTickets,
            [ticket.id]: (s.conductorFailedTickets[ticket.id] ?? 0) + 1,
          },
        };
      });
      addDecision({
        action: 'fail',
        detail: `Failed to launch agent for "${ticket.name}"`,
        ticketId: ticket.id,
      });
      mutated = true;
      continue;
    }

    full.updateTicket?.(ticket.id, { status: 'in_progress' });
    set((s: ConductorSlice) => ({
      conductorAssignments: { ...s.conductorAssignments, [ticket.id]: agent.id },
      conductorRunSpawned: isRetryThisRun ? s.conductorRunSpawned : s.conductorRunSpawned + 1,
    }));
    addDecision({
      action: 'spawn',
      detail: `Launched ${model} agent for "${ticket.name}"`,
      ticketId: ticket.id,
      agentId: agent.id,
    });
    mutated = true;
  }

  if (mutated) await persist();
}
