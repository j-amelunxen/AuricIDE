import type { StateCreator } from 'zustand';
import { setProjectConfigValue } from '../config/projectConfig';
import type { NotificationInput } from '../tauri/notifications';
import type { AgentSlice } from './agentSlice';
import {
  completeLinkedStation,
  handleReviewAgentExit,
  startReview,
  type ConductorReviewContext,
} from './conductor/conductorReview';
import { executeConductorTick, type ConductorTickContext } from './conductor/conductorTick';
import {
  CONDUCTOR_HEARTBEAT_MS,
  MAX_CONDUCTOR_DECISIONS,
  MAX_TICKET_ATTEMPTS,
  PENDING_REVIEW,
  PENDING_SPAWN,
  type ConductorDecision,
  type ConductorRunSummary,
  type ConductorSlice,
  type CrossSlices,
  type FullConductorStore,
  type RunOverridable,
} from './conductor/conductorTypes';
import type { GoalsSlice } from './goalsSlice';

export {
  CONDUCTOR_HEARTBEAT_MS,
  MAX_CONDUCTOR_DECISIONS,
  MAX_TICKET_ATTEMPTS,
  REVIEW_TIMEOUT_MS,
  type ConductorDecision,
  type ConductorPreflight,
  type ConductorRunSummary,
  type ConductorSlice,
} from './conductor/conductorTypes';

export {
  buildConductorPrompt,
  filterTicketsForGoal,
  getConductorPreflight,
  getUnblockedOpenTickets,
  modelForPower,
} from './conductor/conductorHelpers';

export const createConductorSlice: StateCreator<ConductorSlice> = (set, get) => {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  let restoreAfterRun: Partial<RunOverridable> = {};

  const halt = (): void => {
    stopHeartbeat();
    set({ conductorRunning: false });
    if (Object.keys(restoreAfterRun).length > 0) {
      set(restoreAfterRun);
      restoreAfterRun = {};
    }
  };

  const persistProjectValue = (
    key:
      | 'conductorProviderId'
      | 'conductorJudgeForm'
      | 'conductorJudgeProviderId'
      | 'conductorJudgeModel',
    value: string
  ): void => {
    const rootPath = (get() as { rootPath?: string | null }).rootPath;
    if (!rootPath) return;
    void setProjectConfigValue(rootPath, key, value).catch(() => {});
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

  const cross = (): FullConductorStore =>
    get() as unknown as Partial<CrossSlices> &
      Partial<AgentSlice> &
      Partial<GoalsSlice> &
      ConductorSlice;

  const notifyInbox = (input: Omit<NotificationInput, 'source'>): void => {
    const inbox = get() as ConductorSlice & {
      dispatchNotification?: (input: NotificationInput) => Promise<unknown>;
    };
    void inbox.dispatchNotification?.({ source: 'system', origin: 'Conductor', ...input });
  };

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

  const reviewCtx: ConductorReviewContext = {
    get,
    set,
    cross,
    addDecision,
    persist,
  };

  const tickCtx: ConductorTickContext = {
    get,
    set,
    cross,
    addDecision,
    persist,
    halt,
    finishRun,
    notifyInbox,
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
    conductorJudgeProviderId: null,
    conductorJudgeModel: null,
    conductorReviewAssignments: {},
    conductorReviewStartedAt: {},
    conductorTicketBudget: null,
    conductorRunSpawned: 0,

    startConductor: (goalId, options) => {
      const rememberToRestore = <K extends keyof RunOverridable>(key: K): void => {
        if (key in restoreAfterRun) return;
        restoreAfterRun[key] = get()[key];
      };
      if (options?.maxConcurrent !== undefined) rememberToRestore('conductorMaxConcurrent');
      if (options?.requireReview !== undefined) rememberToRestore('conductorRequireReview');
      if (options?.judgeForm !== undefined) rememberToRestore('conductorJudgeForm');
      if (options?.judgeProviderId !== undefined) rememberToRestore('conductorJudgeProviderId');
      if (options?.judgeModel !== undefined) rememberToRestore('conductorJudgeModel');

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
        ...(options?.judgeForm !== undefined && { conductorJudgeForm: options.judgeForm }),
        ...(options?.judgeProviderId !== undefined && {
          conductorJudgeProviderId: options.judgeProviderId || null,
        }),
        ...(options?.judgeModel !== undefined && {
          conductorJudgeModel: options.judgeModel || null,
        }),
      });
      const startedBy = options?.origin
        ? `Conductor started by schedule "${options.origin}"`
        : 'Conductor started';
      addDecision({
        action: 'start',
        detail: goalId ? `${startedBy} for goal ${goalId}` : `${startedBy} (all tickets)`,
      });
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
      persistProjectValue('conductorProviderId', id || '');
    },

    setConductorModel: (model) => set({ conductorModel: model || null }),

    setConductorRequireReview: (v) => set({ conductorRequireReview: v }),

    setConductorJudgeForm: (form) => {
      set({ conductorJudgeForm: form });
      persistProjectValue('conductorJudgeForm', form);
    },

    setConductorJudgeProviderId: (id) => {
      set({ conductorJudgeProviderId: id || null });
      persistProjectValue('conductorJudgeProviderId', id || '');
    },

    setConductorJudgeModel: (model) => {
      set({ conductorJudgeModel: model || null });
      persistProjectValue('conductorJudgeModel', model || '');
    },

    conductorTick: () => executeConductorTick(tickCtx),

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
      const reviewEntry = Object.entries(state.conductorReviewAssignments).find(
        ([, a]) => a === agentId
      );
      if (reviewEntry) {
        void handleReviewAgentExit(reviewEntry[0], agentId, status, reviewCtx);
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
          void startReview(ticketId, agentId, reviewCtx);
          return;
        }
        full.updateTicket?.(ticketId, { status: 'done' });
        completeLinkedStation(
          ticketId,
          'claim',
          `Linked ticket ${ticketId} completed by agent.`,
          cross
        );
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
        .catch(() => {});
    },

    conductorHandleAgentKilled: (agentId) => {
      const state = get();
      const full = cross();

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
        .catch(() => {});
    },
  };
};
