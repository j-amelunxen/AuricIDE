import { reopenStationForRetry } from '@/lib/evidence/verdict';
import { notifyConductor } from '@/lib/ide/conductorNotifications';
import type { PmGoal } from '@/lib/tauri/goals';
import type { NotificationInput } from '@/lib/tauri/notifications';
import { getGoalCompletion, getGoalDescendants } from '../goalsSlice';
import { describeSubtreeDependencyBlocks } from '../goals/goalDependencyAdapters';
import { achieveFinishedDescendants, bundleHoldBlockers, closableWith } from './conductorGoalSweep';
import {
  buildConductorPrompt,
  filterTicketsForGoal,
  getUnblockedOpenTickets,
  isConductorGoalAgent,
  conductorModelFor,
  conductorProviderInfo,
  ticketsWithUnblockedGoal,
} from './conductorHelpers';
import { withHumanWaitsFirst } from './conductorHumanStations';
import { type ExhaustedGoal, summarizeRunBlockers } from './conductorRunBlockers';
import { applyVerdict } from './conductorReview';
import {
  getPlanningWork,
  getStationGoalWork,
  ticketsWorkedAsTickets,
} from './conductorStationGoals';
import { spawnGoalAgents } from './conductorGoalAgents';
import {
  notifySpawnFailure,
  spawnFailureReason,
  withSpawnFailureReason,
} from './conductorSpawnFailure';
import {
  GOAL_AGENT_TIMEOUT_MS,
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

/**
 * Goal-level agents in scope: one per stations goal with open agent work, one
 * planning agent per goal with no work at all. Both need a project folder to
 * run in, so without one nothing is launchable.
 */
function collectGoalAgentWork(
  ctx: ConductorTickContext,
  goals: PmGoal[],
  goalId: string | null
): {
  launchableGoals: PmGoal[];
  launchablePlans: PmGoal[];
  goalAgentsInFlight: number;
  exhausted: ExhaustedGoal[];
} {
  const full = ctx.cross();
  const state = ctx.get();
  const input = {
    goals,
    tickets: full.pmDraftTickets ?? [],
    stations: full.goalStationsDraft ?? [],
    goalId,
    notifications: full.notifications ?? [],
    agents: full.agents ?? [],
    projectPath: full.rootPath ?? null,
    attempts: state.conductorGoalAttempts,
    judgeConfigured: full.judgeLlmConfigured === true,
    goalDependencies: full.goalDependenciesDraft ?? [],
  };
  const stationWork = getStationGoalWork(input);
  const planWork = getPlanningWork({ ...input, planAttempts: state.conductorPlanAttempts });
  const hasFolder = Boolean(full.rootPath);
  return {
    launchableGoals: hasFolder ? stationWork.launchable : [],
    launchablePlans: hasFolder ? planWork.launchable : [],
    goalAgentsInFlight: stationWork.inFlight.length + planWork.inFlight.length,
    exhausted: [
      ...stationWork.exhausted.map((id) => ({
        goalId: id,
        purpose: 'work' as const,
        attempts: state.conductorGoalAttempts[id] ?? 0,
      })),
      ...planWork.exhausted.map((id) => ({
        goalId: id,
        purpose: 'plan' as const,
        attempts: state.conductorPlanAttempts[id] ?? 0,
      })),
    ],
  };
}

/**
 * Watchdog: a goal or planning agent this run started that is still running
 * past GOAL_AGENT_TIMEOUT_MS is ended. While it lives its goal counts as in
 * flight and holds a slot, so one agent that never exits would hold the run.
 * Its attempt was counted at spawn; the next tick retries or gives up as for
 * any agent that ended with work open. Agents a person started are left alone.
 */
function endOverdueGoalAgents(
  ctx: ConductorTickContext,
  goals: PmGoal[],
  goalId: string,
  nowMs: number
): void {
  const full = ctx.cross();
  const inRun = new Set([goalId, ...getGoalDescendants(goals, goalId).map((g) => g.id)]);
  const spawnConfigs = full.agentSpawnConfigs ?? {};
  for (const agent of full.agents ?? []) {
    if (
      !isConductorGoalAgent(agent, spawnConfigs) ||
      agent.status !== 'running' ||
      !inRun.has(agent.spawnedByGoalId ?? '') ||
      nowMs - agent.startedAt <= GOAL_AGENT_TIMEOUT_MS
    ) {
      continue;
    }
    const name = goals.find((g) => g.id === agent.spawnedByGoalId)?.name ?? agent.spawnedByGoalId;
    ctx.addDecision({
      action: 'fail',
      detail: `Agent for "${name}" still running after ${GOAL_AGENT_TIMEOUT_MS / 3_600_000} h · ended`,
      agentId: agent.id,
    });
    void full.killRunningAgent?.(agent.id);
  }
}

/** The goal list this tick works with: finished sub-goals of a scoped run closed first. */
function goalsAfterSweep(ctx: ConductorTickContext, goalId: string | null): PmGoal[] {
  const goals = ctx.cross().goalsDraft ?? [];
  return goalId ? achieveFinishedDescendants(ctx, goals, goalId) : goals;
}

export async function executeConductorTick(ctx: ConductorTickContext): Promise<void> {
  const { get, set, cross, addDecision, persist, halt, finishRun, notifyInbox } = ctx;
  if (!get().conductorRunning) return;
  const full = cross();
  const allTickets = full.pmDraftTickets ?? [];
  const goalDependencies = full.goalDependenciesDraft ?? [];
  const goalId = get().conductorGoalId;
  // Finished sub-goals close first, so what depends on them is released below.
  const goals = goalsAfterSweep(ctx, goalId);

  // Tickets of a stations goal belong to its goal agent, never to ticket agents.
  const workable = ticketsWorkedAsTickets(allTickets, goals, full.goalStationsDraft ?? []);
  const scoped = goalId ? filterTicketsForGoal(workable, goals, goalId) : workable;

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

  if (goalId) endOverdueGoalAgents(ctx, goals, goalId, nowMs);

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

  const { launchableGoals, launchablePlans, goalAgentsInFlight, exhausted } = collectGoalAgentWork(
    ctx,
    goals,
    goalId
  );

  const assignments = get().conductorAssignments;
  // Both maps count: a run with only reviews in flight is still active and
  // must not auto-achieve the goal. So does a goal agent asked for or running.
  const hasActiveAgents =
    Object.keys(assignments).length +
      Object.keys(get().conductorReviewAssignments).length +
      goalAgentsInFlight >
    0;

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
  const retryPending =
    scoped.some((t) => {
      const fails = get().conductorFailedTickets[t.id] ?? 0;
      return t.status === 'open' && fails > 0 && fails < MAX_TICKET_ATTEMPTS;
    }) ||
    launchableGoals.some((g) => (get().conductorGoalAttempts[g.id] ?? 0) > 0) ||
    launchablePlans.some((g) => (get().conductorPlanAttempts[g.id] ?? 0) > 0);
  if (budgetReached && !hasActiveAgents && !retryPending) {
    const goalName = goalId ? (goals.find((g) => g.id === goalId)?.name ?? null) : null;
    const spawned = get().conductorRunSpawned;
    halt();
    addDecision({
      action: 'stop',
      detail: `Budget reached (${spawned}/${ticketBudget})`,
    });
    finishRun('budget_reached', goalName, []);
    void notifyConductor('run_finished', '');
    notifyInbox({
      severity: 'info',
      title: 'Conductor run finished · budget reached',
      body: `${spawned} of ${ticketBudget} started.`,
    });
    await persist();
    return;
  }

  // A ticket whose goal is held by a dependency edge is not this tick's turn.
  const launchableTickets = ticketsWithUnblockedGoal(scoped, goals, goalDependencies);

  // Scope exhausted: no open/in-progress work left and no agents running →
  // machine-check the goal and close the loop. Held tickets do not count as
  // work left: with nothing running, what holds them cannot change any more,
  // and an unattended run must end and say why rather than idle.
  const workLeft =
    launchableGoals.length > 0 ||
    launchablePlans.length > 0 ||
    launchableTickets.some(
      (t) =>
        (t.status === 'open' && (get().conductorFailedTickets[t.id] ?? 0) < MAX_TICKET_ATTEMPTS) ||
        t.status === 'in_progress' ||
        // A ticket awaiting the judge is work in flight: it must not let the
        // loop auto-achieve the goal before the verdict lands.
        t.status === 'in_review'
    );
  if (!workLeft && !hasActiveAgents) {
    if (goalId) {
      // The completion transition decides, the same rule the UI and MCP
      // evaluate_goal use, whether the goal is worked by tickets or stations.
      const completion = getGoalCompletion(
        goals,
        allTickets,
        full.requirementsDraft ?? [],
        full.goalRequirementLinksDraft ?? [],
        full.goalStationsDraft ?? [],
        goalId
      );
      const goalName = goals.find((g) => g.id === goalId)?.name ?? null;
      const emitGoalBlocked = (found: string[]) => {
        const summarized = summarizeRunBlockers({
          blockers: found,
          goals,
          stations: full.goalStationsDraft ?? [],
          goalDependencies,
          rootId: goalId,
          exhausted,
        });
        const { blockers, onlyHuman } = withHumanWaitsFirst(
          summarized,
          goals,
          full.goalStationsDraft ?? [],
          goalId
        );
        halt();
        addDecision({
          action: 'stop',
          detail: `No work left but goal not satisfied: ${blockers.join('; ')}`,
        });
        finishRun('goal_blocked', goalName, blockers);
        void notifyConductor('goal_blocked', blockers.join('; '));
        notifyInbox({
          severity: 'warn',
          title: `${onlyHuman ? 'Goal waits for you' : 'Goal blocked'}: ${goalName ?? goalId}`,
          body: blockers.join(' · '),
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
      };
      if (completion.achievable) {
        // The run's own target may itself be a bundle member of a goal
        // outside its scope (a sibling) — closed together, never alone, and
        // only once every open member could itself close (not failed, not in
        // review, no agent still running on it).
        const closeable = closableWith(ctx, goals, goalId);
        if (closeable.length === 0) {
          emitGoalBlocked([...completion.blockers, ...bundleHoldBlockers(ctx, goals, goalId)]);
        } else {
          for (const id of closeable) full.achieveGoal?.(id);
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
            body:
              completion.mode === 'stations'
                ? 'All stations verified, all requirements verified.'
                : 'All tickets done, all requirements verified.',
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
        }
      } else {
        emitGoalBlocked([
          ...completion.blockers,
          ...describeSubtreeDependencyBlocks(goals, goalDependencies, goalId),
        ]);
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

  const unblocked = getUnblockedOpenTickets(
    launchableTickets,
    full.pmDraftDependencies ?? [],
    allTickets
  );
  let mutated = false;

  for (const ticket of unblocked) {
    const state = get();
    if (!state.conductorRunning) break;
    // One limit for ticket and goal agents: a goal agent asked for or
    // running takes a slot too.
    const capacity =
      state.conductorMaxConcurrent -
      Object.keys(state.conductorAssignments).length -
      Object.keys(state.conductorReviewAssignments).length -
      goalAgentsInFlight;
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
    const providerOverride = get().conductorProviderId ?? undefined;
    const model = conductorModelFor(
      [get().conductorModel],
      ticket.modelPower,
      conductorProviderInfo(full.providers, providerOverride)
    );

    // Reserve the ticket synchronously BEFORE the async spawn so a
    // concurrent tick can never double-spawn for the same ticket.
    set((s: ConductorSlice) => ({
      conductorAssignments: { ...s.conductorAssignments, [ticket.id]: PENDING_SPAWN },
    }));

    let agent;
    let spawnError: string | null = null;
    try {
      agent = await full.spawnNewAgent?.({
        name: `conductor:${ticket.name.slice(0, 40)}`,
        model,
        provider: providerOverride,
        task: prompt,
        projectPath: full.rootPath ?? null,
        cwd: ticket.workingDirectory ?? full.rootPath ?? undefined,
        headless: true,
        spawnedByTicketId: ticket.id,
        spawnedByGoalId: effectiveGoalId,
        runSource: 'conductor',
      });
    } catch (err) {
      agent = undefined;
      spawnError = spawnFailureReason(err);
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
        detail: withSpawnFailureReason(`Failed to launch agent for "${ticket.name}"`, spawnError),
        ticketId: ticket.id,
      });
      notifySpawnFailure(ctx, spawnError);
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

  const workAgents = await spawnGoalAgents(ctx, launchableGoals, 'work', goalAgentsInFlight);
  const inFlightNow = goalAgentsInFlight + workAgents;
  const planAgents = await spawnGoalAgents(ctx, launchablePlans, 'plan', inFlightNow);
  if (workAgents + planAgents > 0) mutated = true;

  if (mutated) await persist();
}
