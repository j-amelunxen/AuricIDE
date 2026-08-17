import type { StateCreator } from 'zustand';
import type { AgentInfo } from '../tauri/agents';
import type { PmDependency, PmTestCase, PmTicket } from '../tauri/pm';
import type { PmGoal } from '../tauri/goals';
import type { AgentSlice } from './agentSlice';
import type { GoalsSlice } from './goalsSlice';
import { getGoalDescendants, getGoalSatisfaction } from './goalsSlice';
import type { PmRequirement } from '../tauri/requirements';
import type { ModelPower } from '../pm/enums';
import { notifyConductor } from '../ide/conductorNotifications';
import { setProjectConfigValue } from '../config/projectConfig';
import type { NotificationInput } from '../tauri/notifications';
import {
  buildReviewAgentPrompt,
  createJudgeBackend,
  type AgentJudgeDeps,
  type JudgeVerdict,
} from '../conductor/judgeBackend';
import { reopenStationForRetry } from '../evidence/verdict';
import { pmLatestTicketReview } from '../tauri/reviews';

export const MAX_TICKET_ATTEMPTS = 2;
export const MAX_CONDUCTOR_DECISIONS = 200;

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export interface ConductorDecision {
  id: string;
  timestamp: string;
  action:
    | 'start'
    | 'stop'
    | 'spawn'
    | 'complete'
    | 'fail'
    | 'approval_needed'
    | 'approved'
    | 'review_started'
    | 'goal_achieved';
  detail: string;
  ticketId?: string;
  agentId?: string;
}

/**
 * The outcome of the most recent conductor run · what the user reads first
 * when they come back to the app. Everything here is derived from actual run
 * state (tickets completed, attempts exhausted, satisfaction blockers), never
 * asserted decoratively.
 */
export interface ConductorRunSummary {
  outcome: 'goal_achieved' | 'goal_blocked' | 'finished' | 'user_stopped' | 'budget_reached';
  goalName: string | null;
  completed: number;
  failed: number;
  blockers: string[];
  startedAt: string;
  endedAt: string;
  /** The run's ticket budget, or null if it ran unlimited. */
  ticketBudget: number | null;
  /** Distinct tickets spawned this run — the numerator for "N of M started". */
  spawned: number;
}

/**
 * Mirrors the MCP `fetch_next_unblocked_task` semantics: a ticket is blocked
 * while any dependency target ticket is not done/archived. Sorted by priority
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
      return target !== undefined && target.status !== 'done' && target.status !== 'archived';
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
 * What a conductor run would find if it started right now. Every number comes
 * from the same predicates the tick itself uses, so the readout can never
 * promise work the loop would not actually pick up.
 */
export interface ConductorPreflight {
  /** All tickets in the selected scope, including completed work. */
  total: number;
  /** Scoped tickets already completed. */
  done: number;
  /** Unblocked open tickets the conductor may spawn for immediately. */
  ready: number;
  /** Open tickets waiting on an unfinished dependency. */
  blocked: number;
  /** Unblocked open tickets held back for human approval. */
  needsApproval: number;
  /** Tickets already being worked. */
  inProgress: number;
  /** Tickets finished by an implementer, awaiting the judge's verdict. */
  inReview: number;
  /** Open tickets that used up their attempts and will not be retried. */
  exhausted: number;
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
    exhausted: 0,
  };

  for (const ticket of scoped) {
    if (ticket.status === 'in_progress') {
      result.inProgress++;
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
  return goal ? `/goal\n\n${prompt}` : prompt;
}

interface CrossSlices {
  pmDraftTickets: PmTicket[];
  pmDraftDependencies: PmDependency[];
  pmDraftTestCases: PmTestCase[];
  updateTicket: (id: string, updates: Partial<PmTicket>) => void;
  savePmData: (projectPath: string) => Promise<void>;
  requirementsDraft: PmRequirement[];
  rootPath: string | null;
}

export interface ConductorSlice {
  conductorRunning: boolean;
  conductorGoalId: string | null;
  conductorMaxConcurrent: number;
  /** Provider (agent CLI) override for conductor-spawned agents; null = default. */
  conductorProviderId: string | null;
  /** Model override for conductor-spawned agents; null/'' = per-ticket capability. */
  conductorModel: string | null;
  /** ticketId -> agentId for tickets currently being worked by conductor agents. */
  conductorAssignments: Record<string, string>;
  /** Tickets requiring human approval before the conductor may spawn for them. */
  conductorPendingApprovals: string[];
  conductorApprovedTickets: string[];
  /** ticketId -> number of failed attempts. */
  conductorFailedTickets: Record<string, number>;
  /** Decision log, newest first, bounded. */
  conductorDecisions: ConductorDecision[];
  /** Outcome of the most recent run; null until a run has ended. */
  conductorLastRun: ConductorRunSummary | null;
  /** ISO start time of the current run; reset on start. */
  conductorRunStartedAt: string | null;
  /** Tickets marked done by the current run; reset on start. */
  conductorRunCompleted: number;
  /** When true, a finished implementer ticket goes to review before done. */
  conductorRequireReview: boolean;
  /** Which judge form review uses: an inline LLM call or a spawned reviewer. */
  conductorJudgeForm: 'llm' | 'agent';
  /** ticketId -> reviewAgentId, or PENDING_REVIEW while an inline judge runs. */
  conductorReviewAssignments: Record<string, string>;
  /** ticketId -> epoch ms the review started, for the watchdog timeout. */
  conductorReviewStartedAt: Record<string, number>;
  /** Cap on implementer launches this run; null = unlimited (today's behaviour). */
  conductorTicketBudget: number | null;
  /** Distinct tickets spawned this run. A retry of an already-spawned ticket
   *  does not add to this — see the budget gate in conductorTick. */
  conductorRunSpawned: number;
  startConductor: (
    goalId: string | null,
    options?: {
      /** Stop starting new tickets once this many have been spawned. */
      ticketBudget?: number;
      /** Overrides conductorMaxConcurrent for this run; restored on end. */
      maxConcurrent?: number;
      /** Overrides conductorRequireReview for this run; restored on end. */
      requireReview?: boolean;
      /** Who started this run (e.g. a schedule name), for the decision log. */
      origin?: string;
    }
  ) => void;
  stopConductor: (reason?: string) => void;
  setConductorMaxConcurrent: (n: number) => void;
  setConductorProviderId: (id: string | null) => void;
  setConductorModel: (model: string | null) => void;
  setConductorRequireReview: (v: boolean) => void;
  setConductorJudgeForm: (form: 'llm' | 'agent') => void;
  conductorTick: () => Promise<void>;
  approveConductorTicket: (ticketId: string) => Promise<void>;
  dismissConductorApproval: (ticketId: string) => void;
  conductorHandleAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  /** A human killed a conductor agent: reopen the ticket, exclude it from this run. */
  conductorHandleAgentKilled: (agentId: string) => void;
}

/** Watchdog interval: recovers the loop from silent stalls (ms). */
export const CONDUCTOR_HEARTBEAT_MS = 15_000;

/** A review with no verdict past this is timed out into a rejection (ms). */
export const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/** Placeholder assignment value while a spawn is in flight. */
const PENDING_SPAWN = '__pending__';
/** Marker for a ticket under inline (LLM) review · no spawned agent to track. */
const PENDING_REVIEW = '__pending_review__';

export const createConductorSlice: StateCreator<ConductorSlice> = (set, get) => {
  // Heartbeat lives in the creator closure · it is runtime state, not app state.
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  // A per-run maxConcurrent/requireReview override (e.g. from a schedule)
  // belongs to that run, not to the panel — null means "nothing to restore".
  // Captured by startConductor, consumed once by halt, the one choke point
  // every run-ending path (goal_achieved, goal_blocked, finished,
  // budget_reached, user_stopped) already passes through.
  let restoreMaxConcurrentTo: number | null = null;
  let restoreRequireReviewTo: boolean | null = null;

  const halt = (): void => {
    stopHeartbeat();
    set({ conductorRunning: false });
    if (restoreMaxConcurrentTo !== null) {
      set({ conductorMaxConcurrent: restoreMaxConcurrentTo });
      restoreMaxConcurrentTo = null;
    }
    if (restoreRequireReviewTo !== null) {
      set({ conductorRequireReview: restoreRequireReviewTo });
      restoreRequireReviewTo = null;
    }
  };

  const addDecision = (decision: Omit<ConductorDecision, 'id' | 'timestamp'>): void => {
    set((s: ConductorSlice) => ({
      conductorDecisions: [
        {
          ...decision,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        },
        ...s.conductorDecisions,
      ].slice(0, MAX_CONDUCTOR_DECISIONS),
    }));
  };

  const cross = (): Partial<CrossSlices> & Partial<AgentSlice> & Partial<GoalsSlice> =>
    get() as unknown as Partial<CrossSlices> & Partial<AgentSlice> & Partial<GoalsSlice>;

  /**
   * Mirrors a conductor milestone into the inbox.
   *
   * `notifyConductor` is the interruption — an OS banner, and only while the
   * window is unfocused. This is the record that is still there when you come
   * back, across every project. Neither replaces the decision log, which is
   * the run's own transcript and lives and dies with the run.
   *
   * Note what these entries deliberately are *not*: an approval gate here is
   * a pointer, not a second pair of Approve/Skip buttons. The queue in
   * `ConductorPanel` stays the one place that decision is made, so the two
   * surfaces cannot drift into disagreeing about what is still pending.
   */
  const notifyInbox = (input: Omit<NotificationInput, 'source'>): void => {
    const inbox = get() as ConductorSlice & {
      dispatchNotification?: (input: NotificationInput) => Promise<unknown>;
    };
    void inbox.dispatchNotification?.({ source: 'system', origin: 'Conductor', ...input });
  };

  // Seals the run's outcome into conductorLastRun. `failed` is derived from
  // the attempt ledger (tickets that exhausted MAX_TICKET_ATTEMPTS), not from
  // a separately maintained counter, so it can't drift from reality.
  const finishRun = (
    outcome: ConductorRunSummary['outcome'],
    goalName: string | null,
    blockers: string[]
  ): void => {
    const s = get();
    const failed = Object.values(s.conductorFailedTickets).filter(
      (n) => n >= MAX_TICKET_ATTEMPTS
    ).length;
    const now = new Date().toISOString();
    set({
      conductorLastRun: {
        outcome,
        goalName,
        completed: s.conductorRunCompleted,
        failed,
        blockers,
        startedAt: s.conductorRunStartedAt ?? now,
        endedAt: now,
        ticketBudget: s.conductorTicketBudget,
        spawned: s.conductorRunSpawned,
      },
    });
  };

  const persist = async (): Promise<void> => {
    const full = cross();
    const projectPath = full.rootPath;
    if (!projectPath) return;
    try {
      await full.savePmData?.(projectPath);
      await full.saveGoals?.(projectPath);
    } catch {
      // Browser mode / DB not initialized · drafts stay in memory
    }
  };

  /**
   * Store-side capabilities for the review-agent judge form, kept out of the
   * store-free judgeBackend module. Spawns a reviewer (Codex/Grok via the
   * conductor's provider) and reads the verdict it wrote after its start time.
   */
  const agentJudgeDeps = (): AgentJudgeDeps => {
    const full = cross();
    return {
      spawnReviewAgent: async (input) => {
        const agent = await full.spawnNewAgent?.({
          name: `review:${input.ticket.name.slice(0, 40)}`,
          model: get().conductorModel || modelForPower(undefined),
          provider: get().conductorProviderId ?? undefined,
          task: buildReviewAgentPrompt(input),
          cwd: full.rootPath ?? undefined,
          spawnedForReviewOfTicketId: input.ticket.id,
          runSource: 'conductor',
        });
        if (!agent) throw new Error('Failed to spawn review agent');
        return agent.id;
      },
      latestReview: async (ticketId) => {
        const startedMs = get().conductorReviewStartedAt[ticketId];
        const sinceIso = startedMs
          ? new Date(startedMs).toISOString().replace('T', ' ').slice(0, 19)
          : undefined;
        const review = await pmLatestTicketReview(cross().rootPath ?? '', ticketId, sinceIso);
        return review ? { pass: review.pass, reason: review.reason } : null;
      },
    };
  };

  const completeLinkedStation = (
    ticketId: string,
    evidenceKind: 'claim' | 'judged',
    note: string
  ): void => {
    const full = cross();
    const station = (full.goalStationsDraft ?? []).find((item) => item.ticketId === ticketId);
    if (!station || station.kind === 'human' || station.predicate.type === 'human') return;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    full.updateStation?.(station.id, {
      status: 'done',
      evidenceKind,
      evidenceNote: note,
      lastCheckedAt: evidenceKind === 'judged' ? timestamp : null,
      doneAt: timestamp,
      updatedAt: timestamp,
    });
  };

  /**
   * Applies a judge verdict to a ticket under review: pass → done, reject →
   * reopened as an attempt (the shared MAX_TICKET_ATTEMPTS ledger). Either way
   * the ticket leaves the review maps and the loop is re-driven. The reason is
   * recorded in the decision log so a rejection is never silent.
   */
  const applyVerdict = (ticketId: string, verdict: JudgeVerdict): void => {
    const state = get();
    const full = cross();
    const { [ticketId]: _rev, ...restReview } = state.conductorReviewAssignments;
    const { [ticketId]: _at, ...restStarted } = state.conductorReviewStartedAt;
    if (verdict.pass) {
      full.updateTicket?.(ticketId, { status: 'done' });
      completeLinkedStation(ticketId, 'judged', verdict.reason);
      set((s: ConductorSlice) => ({
        conductorReviewAssignments: restReview,
        conductorReviewStartedAt: restStarted,
        conductorRunCompleted: s.conductorRunCompleted + 1,
      }));
      addDecision({
        action: 'complete',
        detail: `Judge approved · ticket marked done`,
        ticketId,
      });
    } else {
      const fails = (state.conductorFailedTickets[ticketId] ?? 0) + 1;
      full.updateTicket?.(ticketId, { status: 'open' });
      set((s: ConductorSlice) => ({
        conductorReviewAssignments: restReview,
        conductorReviewStartedAt: restStarted,
        conductorFailedTickets: { ...s.conductorFailedTickets, [ticketId]: fails },
      }));
      addDecision({
        action: 'fail',
        detail:
          fails < MAX_TICKET_ATTEMPTS
            ? `Judge rejected · requeued (attempt ${fails}/${MAX_TICKET_ATTEMPTS}): ${verdict.reason}`
            : `Judge rejected · giving up after ${fails} attempts: ${verdict.reason}`,
        ticketId,
      });
    }
    void persist()
      .then(() => get().conductorTick())
      .catch(() => {});
  };

  /**
   * Sends a finished implementer ticket to the judge. Moves it out of the
   * assignments map into review (in_review), then starts the configured judge
   * form: the LLM form resolves a verdict inline; the review-agent form (stage
   * 5) delegates to a spawned reviewer. Any failure to even start the judge is
   * a rejection, never a silent pass.
   */
  const startReview = async (ticketId: string, implementerAgentId: string): Promise<void> => {
    const full = cross();
    set((s: ConductorSlice) => {
      const { [ticketId]: _gone, ...restAssign } = s.conductorAssignments;
      return {
        conductorAssignments: restAssign,
        conductorReviewAssignments: {
          ...s.conductorReviewAssignments,
          [ticketId]: PENDING_REVIEW,
        },
        conductorReviewStartedAt: {
          ...s.conductorReviewStartedAt,
          [ticketId]: Date.now(),
        },
      };
    });
    full.updateTicket?.(ticketId, { status: 'in_review' });
    addDecision({
      action: 'review_started',
      detail: 'Implementer finished · ticket sent to the judge',
      ticketId,
      agentId: implementerAgentId,
    });

    const ticket = (full.pmDraftTickets ?? []).find((t) => t.id === ticketId);
    if (!ticket) {
      applyVerdict(ticketId, { pass: false, reason: 'ticket vanished before review' });
      return;
    }
    const goal = (full.goalsDraft ?? []).find(
      (g) => g.id === (ticket.goalId ?? get().conductorGoalId ?? undefined)
    );
    const testCases = (full.pmDraftTestCases ?? []).filter((tc) => tc.ticketId === ticketId);

    try {
      const backend = createJudgeBackend(get().conductorJudgeForm, agentJudgeDeps());
      const startRes = await backend.start({
        ticket,
        goal,
        testCases,
        projectPath: full.rootPath ?? '',
      });
      if (startRes.kind === 'verdict') {
        applyVerdict(ticketId, startRes.verdict);
      } else {
        // Delegated to a spawned reviewer: record its real id. Persist so the
        // in_review ticket survives; the verdict arrives when the agent exits.
        set((s: ConductorSlice) => ({
          conductorReviewAssignments: {
            ...s.conductorReviewAssignments,
            [ticketId]: startRes.reviewAgentId,
          },
        }));
        void persist();
      }
    } catch (e) {
      applyVerdict(ticketId, {
        pass: false,
        reason: `Judge could not run: ${(e as Error).message}`,
      });
    }
  };

  /**
   * A spawned review agent (agent form) exited: collect the verdict it wrote,
   * or treat a crash / no-verdict exit as a rejection. Never an approval by
   * default · silence is not a pass.
   */
  const handleReviewAgentExit = async (
    ticketId: string,
    reviewAgentId: string,
    status: AgentInfo['status']
  ): Promise<void> => {
    let verdict: JudgeVerdict | null = null;
    try {
      const backend = createJudgeBackend(get().conductorJudgeForm, agentJudgeDeps());
      if (status === 'idle' && backend.collectVerdict) {
        verdict = await backend.collectVerdict(reviewAgentId, ticketId);
      }
    } catch {
      verdict = null;
    }
    applyVerdict(
      ticketId,
      verdict ?? {
        pass: false,
        reason:
          status === 'error'
            ? 'Review agent errored before submitting a verdict'
            : 'Review agent exited without a verdict',
      }
    );
  };

  return {
    conductorRunning: false,
    conductorGoalId: null,
    conductorMaxConcurrent: 2,
    conductorProviderId: null,
    conductorModel: null,
    conductorAssignments: {},
    conductorPendingApprovals: [],
    conductorApprovedTickets: [],
    conductorFailedTickets: {},
    conductorDecisions: [],
    conductorLastRun: null,
    conductorRunStartedAt: null,
    conductorRunCompleted: 0,
    conductorRequireReview: false,
    conductorJudgeForm: 'llm',
    conductorReviewAssignments: {},
    conductorReviewStartedAt: {},
    conductorTicketBudget: null,
    conductorRunSpawned: 0,

    startConductor: (goalId, options) => {
      // Capture the pre-run values BEFORE they're overwritten below, so halt()
      // can put them back exactly as this run found them.
      // `??` on purpose: if a run with overrides is still active and another
      // start arrives, the value worth handing back is still the one from
      // before the first override, not the override itself — and a start
      // without options leaves an earlier promise to restore untouched.
      if (options?.maxConcurrent !== undefined) {
        restoreMaxConcurrentTo = restoreMaxConcurrentTo ?? get().conductorMaxConcurrent;
      }
      if (options?.requireReview !== undefined) {
        restoreRequireReviewTo = restoreRequireReviewTo ?? get().conductorRequireReview;
      }

      set({
        conductorRunning: true,
        conductorGoalId: goalId,
        conductorFailedTickets: {},
        conductorPendingApprovals: [],
        conductorApprovedTickets: [],
        conductorRunStartedAt: new Date().toISOString(),
        conductorRunCompleted: 0,
        conductorReviewAssignments: {},
        conductorReviewStartedAt: {},
        conductorTicketBudget: options?.ticketBudget ?? null,
        conductorRunSpawned: 0,
        ...(options?.maxConcurrent !== undefined && {
          conductorMaxConcurrent: options.maxConcurrent,
        }),
        ...(options?.requireReview !== undefined && {
          conductorRequireReview: options.requireReview,
        }),
      });
      const startedBy = options?.origin
        ? `Conductor started by schedule "${options.origin}"`
        : 'Conductor started';
      addDecision({
        action: 'start',
        detail: goalId ? `${startedBy} for goal ${goalId}` : `${startedBy} (all tickets)`,
      });
      // Watchdog: the loop is event-driven, but a swallowed error or lost
      // event must not park it silently · the heartbeat re-drives the tick.
      stopHeartbeat();
      heartbeat = setInterval(() => {
        void get()
          .conductorTick()
          .catch(() => {});
      }, CONDUCTOR_HEARTBEAT_MS);
    },

    stopConductor: (reason) => {
      const wasRunning = get().conductorRunning;
      halt();
      // Stopping must actually stop: kill every agent this run launched,
      // otherwise the conductor "stops" but its agents keep running.
      const full = cross();
      if (wasRunning) {
        const goalId = get().conductorGoalId;
        const goalName = goalId
          ? ((full.goalsDraft ?? []).find((g) => g.id === goalId)?.name ?? null)
          : null;
        finishRun('user_stopped', goalName, []);
      }
      const runningAgentIds = Object.values(get().conductorAssignments).filter(
        (a) => a !== PENDING_SPAWN
      );
      // Review agents this run spawned must die too (the inline PENDING_REVIEW
      // marker has no process to kill).
      const runningReviewIds = Object.values(get().conductorReviewAssignments).filter(
        (a) => a !== PENDING_REVIEW
      );
      [...runningAgentIds, ...runningReviewIds].forEach(
        (agentId) => void full.killRunningAgent?.(agentId)
      );
      addDecision({
        action: 'stop',
        detail:
          reason ??
          (runningAgentIds.length > 0
            ? `Conductor stopped · killing ${runningAgentIds.length} running agent(s)`
            : 'Conductor stopped'),
      });
    },

    setConductorMaxConcurrent: (n) => set({ conductorMaxConcurrent: Math.max(1, n) }),

    setConductorProviderId: (id) => {
      set({ conductorProviderId: id || null });
      // Which provider runs a project's backlog is a property of the project,
      // not of the session that happened to pick it.
      const rootPath = (get() as { rootPath?: string | null }).rootPath;
      if (rootPath) {
        void setProjectConfigValue(rootPath, 'conductorProviderId', id || '').catch(() => {});
      }
    },

    setConductorModel: (model) => set({ conductorModel: model || null }),

    setConductorRequireReview: (v) => set({ conductorRequireReview: v }),

    setConductorJudgeForm: (form) => set({ conductorJudgeForm: form }),

    conductorTick: async () => {
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
          applyVerdict(reviewTicketId, { pass: false, reason: 'Review timed out' });
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
          (t.status === 'open' &&
            (get().conductorFailedTickets[t.id] ?? 0) < MAX_TICKET_ATTEMPTS) ||
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
            // A pointer, not a second set of Approve/Skip buttons — see
            // notifyInbox. The gate stays where the conductor draws it.
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

        // A ticket already spawned once this run (it has a failed attempt on
        // the shared ledger — the only way an already-spawned ticket becomes
        // open again) is a retry, not new work: "work five tickets" budgets
        // distinct tickets, and a retry is the same ticket. Only a genuinely
        // new ticket is gated once the budget is spent; a retry always gets
        // its relaunch.
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
        // A conductor-wide override wins; otherwise derive the model from the
        // ticket's declared capability need.
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
            // No permissionMode: the provider's configured defaultPermissionMode
            // (dynamic-providers/*.json) decides.
            spawnedByTicketId: ticket.id,
            spawnedByGoalId: effectiveGoalId,
            runSource: 'conductor',
          });
        } catch {
          agent = undefined;
        }

        if (!agent) {
          // Release the reservation; the ticket stays open and the failure
          // counts as an attempt so a broken spawn can't loop forever.
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

        // Only a successful spawn moves the ticket out of the queue
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
    },

    approveConductorTicket: async (ticketId) => {
      set((s: ConductorSlice) => ({
        conductorPendingApprovals: s.conductorPendingApprovals.filter((id) => id !== ticketId),
        conductorApprovedTickets: [...s.conductorApprovedTickets, ticketId],
      }));
      addDecision({ action: 'approved', detail: 'Human approved launch', ticketId });
      await get().conductorTick();
    },

    dismissConductorApproval: (ticketId) =>
      set((s: ConductorSlice) => ({
        conductorPendingApprovals: s.conductorPendingApprovals.filter((id) => id !== ticketId),
      })),

    conductorHandleAgentStatus: (agentId, status) => {
      if (status !== 'idle' && status !== 'error') return;
      const state = get();
      // A review agent finishing → collect its verdict (or a crash → reject).
      // Checked before implementer assignments so a reviewer is never mistaken
      // for an implementer completing its ticket.
      const reviewEntry = Object.entries(state.conductorReviewAssignments).find(
        ([, a]) => a === agentId
      );
      if (reviewEntry) {
        void handleReviewAgentExit(reviewEntry[0], agentId, status);
        return;
      }
      const entry = Object.entries(state.conductorAssignments).find(([, a]) => a === agentId);
      if (!entry) return;
      const [ticketId] = entry;
      const full = cross();
      const remaining = Object.fromEntries(
        Object.entries(state.conductorAssignments).filter(([t]) => t !== ticketId)
      );

      if (status === 'idle') {
        if (get().conductorRequireReview) {
          // Exit 0 is a CLAIM, not a completion: an independent judge signs it
          // off before the ticket is done. startReview owns persist + re-tick.
          void startReview(ticketId, agentId);
          return;
        }
        full.updateTicket?.(ticketId, { status: 'done' });
        completeLinkedStation(ticketId, 'claim', `Linked ticket ${ticketId} completed by agent.`);
        set((s: ConductorSlice) => ({
          conductorAssignments: remaining,
          conductorRunCompleted: s.conductorRunCompleted + 1,
        }));
        addDecision({
          action: 'complete',
          detail: 'Agent finished · ticket marked done',
          ticketId,
          agentId,
        });
      } else {
        const fails = (state.conductorFailedTickets[ticketId] ?? 0) + 1;
        full.updateTicket?.(ticketId, { status: 'open' });
        set({
          conductorAssignments: remaining,
          conductorFailedTickets: { ...state.conductorFailedTickets, [ticketId]: fails },
        });
        addDecision({
          action: 'fail',
          detail:
            fails < MAX_TICKET_ATTEMPTS
              ? `Agent errored · requeued (attempt ${fails}/${MAX_TICKET_ATTEMPTS})`
              : `Agent errored · giving up after ${fails} attempts`,
          ticketId,
          agentId,
        });
      }

      void persist()
        .then(() => get().conductorTick())
        .catch(() => {
          // Loop continuation must never surface as an unhandled rejection
        });
    },

    conductorHandleAgentKilled: (agentId) => {
      const state = get();
      const full = cross();

      // A killed REVIEW agent: the verdict was aborted. Reopen the ticket and
      // take it out of this run, exactly like a killed implementer · never let
      // it read as an approval.
      const reviewEntry = Object.entries(state.conductorReviewAssignments).find(
        ([, a]) => a === agentId
      );
      if (reviewEntry) {
        const [ticketId] = reviewEntry;
        const { [ticketId]: _rev, ...restReview } = state.conductorReviewAssignments;
        const { [ticketId]: _at, ...restStarted } = state.conductorReviewStartedAt;
        full.updateTicket?.(ticketId, { status: 'open' });
        set({
          conductorReviewAssignments: restReview,
          conductorReviewStartedAt: restStarted,
          conductorFailedTickets: {
            ...state.conductorFailedTickets,
            [ticketId]: MAX_TICKET_ATTEMPTS,
          },
        });
        addDecision({
          action: 'fail',
          detail: 'Review agent killed by user · ticket reopened and excluded from this run',
          ticketId,
          agentId,
        });
        void persist()
          .then(() => get().conductorTick())
          .catch(() => {});
        return;
      }

      const entry = Object.entries(state.conductorAssignments).find(([, a]) => a === agentId);
      if (!entry) return;
      const [ticketId] = entry;
      const remaining = Object.fromEntries(
        Object.entries(state.conductorAssignments).filter(([t]) => t !== ticketId)
      );

      // A human intervened: reopen the ticket (it was NOT completed) and
      // exclude it from this conductor run instead of instantly respawning.
      full.updateTicket?.(ticketId, { status: 'open' });
      set({
        conductorAssignments: remaining,
        conductorFailedTickets: {
          ...state.conductorFailedTickets,
          [ticketId]: MAX_TICKET_ATTEMPTS,
        },
      });
      addDecision({
        action: 'fail',
        detail: 'Agent killed by user · ticket reopened and excluded from this conductor run',
        ticketId,
        agentId,
      });

      void persist()
        .then(() => get().conductorTick())
        .catch(() => {
          // Loop continuation must never surface as an unhandled rejection
        });
    },
  };
};
