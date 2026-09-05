import type { AgentInfo } from '@/lib/tauri/agents';
import type { PmDependency, PmTestCase, PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import type { AgentSlice } from '../agent/agentTypes';
import type { GoalsSlice } from '../goalsSlice';

export const MAX_TICKET_ATTEMPTS = 2;
export const MAX_CONDUCTOR_DECISIONS = 200;

export const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Watchdog interval: recovers the loop from silent stalls (ms). */
export const CONDUCTOR_HEARTBEAT_MS = 15_000;

/** A review with no verdict past this is timed out into a rejection (ms). */
export const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/** Placeholder assignment value while a spawn is in flight. */
export const PENDING_SPAWN = '__pending__';

/** Marker for a ticket under inline (LLM) review · no spawned agent to track. */
export const PENDING_REVIEW = '__pending_review__';

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
  /** Tickets waiting for human QA. */
  toTest: number;
  /** Open tickets that used up their attempts and will not be retried. */
  exhausted: number;
}

export interface CrossSlices {
  pmDraftTickets: PmTicket[];
  pmDraftDependencies: PmDependency[];
  pmDraftTestCases: PmTestCase[];
  updateTicket: (id: string, updates: Partial<PmTicket>) => void;
  savePmData: (projectPath: string) => Promise<void>;
  requirementsDraft: PmRequirement[];
  rootPath: string | null;
}

export type FullConductorStore = ConductorSlice &
  Partial<CrossSlices> &
  Partial<AgentSlice> &
  Partial<GoalsSlice> & {
    dispatchNotification?: (
      input: import('@/lib/tauri/notifications').NotificationInput
    ) => Promise<unknown>;
    rootPath?: string | null;
  };

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
  /**
   * Provider (agent CLI) for a spawned reviewer; null = the conductor's own.
   *
   * Its own setting because a judge sharing the implementer's harness and model
   * is not the independent second opinion review is there to be. The fallback
   * is the conductor's rather than something else, so a run nobody configured
   * behaves as it always did instead of on a harness nobody picked.
   */
  conductorJudgeProviderId: string | null;
  /** Model for a spawned reviewer; null = the conductor's own. */
  conductorJudgeModel: string | null;
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
      /** Overrides conductorJudgeForm for this run; restored on end. */
      judgeForm?: 'llm' | 'agent';
      /** Overrides conductorJudgeProviderId for this run; restored on end. */
      judgeProviderId?: string | null;
      /** Overrides conductorJudgeModel for this run; restored on end. */
      judgeModel?: string | null;
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
  setConductorJudgeProviderId: (id: string | null) => void;
  setConductorJudgeModel: (model: string | null) => void;
  conductorTick: () => Promise<void>;
  approveConductorTicket: (ticketId: string) => Promise<void>;
  dismissConductorApproval: (ticketId: string) => void;
  conductorHandleAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  /** A human killed a conductor agent: reopen the ticket, exclude it from this run. */
  conductorHandleAgentKilled: (agentId: string) => void;
}

export type RunOverridable = Pick<
  ConductorSlice,
  | 'conductorMaxConcurrent'
  | 'conductorRequireReview'
  | 'conductorJudgeForm'
  | 'conductorJudgeProviderId'
  | 'conductorJudgeModel'
>;
