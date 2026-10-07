import type { AgentInfo } from '@/lib/tauri/agents';
import type { PmDependency, PmEpic, PmTestCase, PmTicket } from '@/lib/tauri/pm';
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

/**
 * A goal or planning agent the conductor started is ended past this (ms). It
 * works a whole line, so the limit is wide; it is the net for an agent that
 * never exits, which would otherwise hold its slot and the run forever.
 */
export const GOAL_AGENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

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
  /** Set when the run was scoped to one epic instead of a goal. */
  epicName?: string | null;
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
  /** Open stations-mode goals in scope; a run works or at least checks them. */
  stationGoals: number;
  /** Of those, the ones a run would ask a goal agent for right away. */
  stationGoalsReady: number;
  /** Of those, the ones held by a dependency edge — not their turn yet. */
  stationGoalsBlocked: number;
}

export interface CrossSlices {
  pmDraftEpics: PmEpic[];
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
    /** The inbox, read for launch requests already open on a goal. */
    notifications?: import('@/lib/notifications/types').Notification[];
    /** A judge is configured, so a fresh station claim still gets its verdict. */
    judgeLlmConfigured?: boolean;
    /** Providers the open project permits, default first (`uiSlice`). */
    providers?: import('@/lib/tauri/providers').ProviderInfo[];
  };

export interface ConductorSlice {
  conductorRunning: boolean;
  conductorGoalId: string | null;
  /** The epic the current (or last) run is scoped to; never set together with a goal. */
  conductorEpicId: string | null;
  /**
   * The epic the conductor panel is preloaded with ("run conductor on this
   * epic"). View state: it decides what the next Start covers, not what runs.
   */
  conductorScopeEpicId: string | null;
  setConductorScopeEpicId: (epicId: string | null) => void;
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
  /**
   * How many tickets or goals the next manual run may start. Null means no
   * limit. Remembered per project. A scheduled run has its own budget and
   * does not change this. Each ticket, stations goal, and planning goal
   * counts once; a retry does not.
   */
  conductorWorkCap: number | null;
  /** Cap on implementer launches this run; null = unlimited (today's behaviour). */
  conductorTicketBudget: number | null;
  /** Distinct tickets spawned this run. A retry of an already-spawned ticket
   *  does not add to this — see the budget gate in conductorTick. A stations
   *  goal the run spawned a goal agent for counts here once, like a ticket,
   *  and so does a goal it spawned a planning agent for. */
  conductorRunSpawned: number;
  /** goalId -> goal agents this run spawned for a stations goal; reset on start. */
  conductorGoalAttempts: Record<string, number>;
  /** goalId -> planning agents this run spawned for a goal with no work yet; reset on start. */
  conductorPlanAttempts: Record<string, number>;
  /** Whether this run already raised its one inbox entry for a refused spawn. */
  conductorSpawnFailureNotified: boolean;
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
      /**
       * Work only this epic's tickets. Takes the place of the goal: an epic
       * run is a run without a goal over a narrower ticket set.
       */
      epicId?: string | null;
    }
  ) => void;
  stopConductor: (reason?: string) => void;
  setConductorMaxConcurrent: (n: number) => void;
  /** Null clears the cap (the run does not stop after a count). */
  setConductorWorkCap: (n: number | null) => void;
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
