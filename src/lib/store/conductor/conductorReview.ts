import {
  buildReviewAgentPrompt,
  createJudgeBackend,
  type AgentJudgeDeps,
  type JudgeVerdict,
} from '@/lib/conductor/judgeBackend';
import type { AgentInfo } from '@/lib/tauri/agents';
import { pmLatestTicketReview } from '@/lib/tauri/reviews';
import { modelForPower } from './conductorHelpers';
import {
  MAX_TICKET_ATTEMPTS,
  PENDING_REVIEW,
  type ConductorDecision,
  type ConductorSlice,
  type FullConductorStore,
} from './conductorTypes';

export interface ConductorReviewContext {
  get: () => ConductorSlice;
  set: (fn: ((s: ConductorSlice) => Partial<ConductorSlice>) | Partial<ConductorSlice>) => void;
  cross: () => FullConductorStore;
  addDecision: (decision: Omit<ConductorDecision, 'id' | 'timestamp'>) => void;
  persist: () => Promise<void>;
}

export function completeLinkedStation(
  ticketId: string,
  evidenceKind: 'claim' | 'judged',
  note: string,
  cross: () => FullConductorStore
): void {
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
}

export function createAgentJudgeDeps(ctx: ConductorReviewContext): AgentJudgeDeps {
  const { get, cross } = ctx;
  const full = cross();
  return {
    spawnReviewAgent: async (input) => {
      // Each half falls back on its own: a judge given a provider but no
      // model must not silently lose the conductor's model as well.
      const state = get();
      const agent = await full.spawnNewAgent?.({
        name: `review:${input.ticket.name.slice(0, 40)}`,
        model: state.conductorJudgeModel || state.conductorModel || modelForPower(undefined),
        provider: state.conductorJudgeProviderId ?? state.conductorProviderId ?? undefined,
        task: buildReviewAgentPrompt(input),
        cwd: full.rootPath ?? undefined,
        // Same reason as the implementer: the verdict is collected when this
        // process exits. Left interactive it would sit at its prompt with the
        // verdict unwritten until REVIEW_TIMEOUT_MS rejected the ticket — a
        // rejection earned by the reviewer, not by the work.
        headless: true,
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
}

/**
 * Applies a judge verdict to a ticket under review: pass → done, reject →
 * reopened as an attempt (the shared MAX_TICKET_ATTEMPTS ledger). Either way
 * the ticket leaves the review maps and the loop is re-driven. The reason is
 * recorded in the decision log so a rejection is never silent.
 */
export function applyVerdict(
  ticketId: string,
  verdict: JudgeVerdict,
  ctx: ConductorReviewContext
): void {
  const { get, set, cross, addDecision, persist } = ctx;
  const state = get();
  const full = cross();
  const { [ticketId]: _rev, ...restReview } = state.conductorReviewAssignments;
  const { [ticketId]: _at, ...restStarted } = state.conductorReviewStartedAt;
  if (verdict.pass) {
    full.updateTicket?.(ticketId, { status: 'done' });
    completeLinkedStation(ticketId, 'judged', verdict.reason, cross);
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
}

/**
 * Sends a finished implementer ticket to the judge. Moves it out of the
 * assignments map into review (in_review), then starts the configured judge
 * form: the LLM form resolves a verdict inline; the review-agent form (stage
 * 5) delegates to a spawned reviewer. Any failure to even start the judge is
 * a rejection, never a silent pass.
 */
export async function startReview(
  ticketId: string,
  implementerAgentId: string,
  ctx: ConductorReviewContext
): Promise<void> {
  const { get, set, cross, addDecision, persist } = ctx;
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
    applyVerdict(ticketId, { pass: false, reason: 'ticket vanished before review' }, ctx);
    return;
  }
  const goal = (full.goalsDraft ?? []).find(
    (g) => g.id === (ticket.goalId ?? get().conductorGoalId ?? undefined)
  );
  const testCases = (full.pmDraftTestCases ?? []).filter((tc) => tc.ticketId === ticketId);

  try {
    const backend = createJudgeBackend(get().conductorJudgeForm, createAgentJudgeDeps(ctx));
    const startRes = await backend.start({
      ticket,
      goal,
      testCases,
      projectPath: full.rootPath ?? '',
    });
    if (startRes.kind === 'verdict') {
      applyVerdict(ticketId, startRes.verdict, ctx);
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
    applyVerdict(
      ticketId,
      {
        pass: false,
        reason: `Judge could not run: ${(e as Error).message}`,
      },
      ctx
    );
  }
}

/**
 * A spawned review agent (agent form) exited: collect the verdict it wrote,
 * or treat a crash / no-verdict exit as a rejection. Never an approval by
 * default · silence is not a pass.
 */
export async function handleReviewAgentExit(
  ticketId: string,
  reviewAgentId: string,
  status: AgentInfo['status'],
  ctx: ConductorReviewContext
): Promise<void> {
  const { get } = ctx;
  let verdict: JudgeVerdict | null = null;
  try {
    const backend = createJudgeBackend(get().conductorJudgeForm, createAgentJudgeDeps(ctx));
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
    },
    ctx
  );
}
