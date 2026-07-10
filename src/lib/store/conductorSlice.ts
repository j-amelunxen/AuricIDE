import type { StateCreator } from 'zustand';
import type { AgentInfo } from '../tauri/agents';
import type { PmDependency, PmTestCase, PmTicket } from '../tauri/pm';
import type { PmGoal } from '../tauri/goals';
import type { AgentSlice } from './agentSlice';
import type { GoalsSlice } from './goalsSlice';
import { getGoalDescendants, getGoalSatisfaction } from './goalsSlice';
import type { PmRequirement } from '../tauri/requirements';

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
    | 'goal_achieved';
  detail: string;
  ticketId?: string;
  agentId?: string;
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

/** Maps a ticket's declared capability need to a concrete model. */
export function modelForPower(power: 'low' | 'medium' | 'high' | undefined): string {
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
    sections.push(`## Goal context\nThis task serves the goal "${goal.name}".`);
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
      'but do NOT change ticket statuses and do NOT call record_goal_run — the conductor ' +
      'already tracks this run and its completion. ' +
      'Exit with a non-zero code if you could not complete the task.'
  );

  return sections.join('\n\n');
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
  startConductor: (goalId: string | null) => void;
  stopConductor: (reason?: string) => void;
  setConductorMaxConcurrent: (n: number) => void;
  setConductorProviderId: (id: string | null) => void;
  setConductorModel: (model: string | null) => void;
  conductorTick: () => Promise<void>;
  approveConductorTicket: (ticketId: string) => Promise<void>;
  dismissConductorApproval: (ticketId: string) => void;
  conductorHandleAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  /** A human killed a conductor agent: reopen the ticket, exclude it from this run. */
  conductorHandleAgentKilled: (agentId: string) => void;
}

/** Watchdog interval: recovers the loop from silent stalls (ms). */
export const CONDUCTOR_HEARTBEAT_MS = 15_000;

/** Placeholder assignment value while a spawn is in flight. */
const PENDING_SPAWN = '__pending__';

export const createConductorSlice: StateCreator<ConductorSlice> = (set, get) => {
  // Heartbeat lives in the creator closure — it is runtime state, not app state.
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const halt = (): void => {
    stopHeartbeat();
    set({ conductorRunning: false });
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

  const persist = async (): Promise<void> => {
    const full = cross();
    const projectPath = full.rootPath;
    if (!projectPath) return;
    try {
      await full.savePmData?.(projectPath);
      await full.saveGoals?.(projectPath);
    } catch {
      // Browser mode / DB not initialized — drafts stay in memory
    }
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

    startConductor: (goalId) => {
      set({
        conductorRunning: true,
        conductorGoalId: goalId,
        conductorFailedTickets: {},
        conductorPendingApprovals: [],
        conductorApprovedTickets: [],
      });
      addDecision({
        action: 'start',
        detail: goalId ? `Conductor started for goal ${goalId}` : 'Conductor started (all tickets)',
      });
      // Watchdog: the loop is event-driven, but a swallowed error or lost
      // event must not park it silently — the heartbeat re-drives the tick.
      stopHeartbeat();
      heartbeat = setInterval(() => {
        void get()
          .conductorTick()
          .catch(() => {});
      }, CONDUCTOR_HEARTBEAT_MS);
    },

    stopConductor: (reason) => {
      halt();
      // Stopping must actually stop: kill every agent this run launched,
      // otherwise the conductor "stops" but its agents keep running.
      const full = cross();
      const runningAgentIds = Object.values(get().conductorAssignments).filter(
        (a) => a !== PENDING_SPAWN
      );
      runningAgentIds.forEach((agentId) => void full.killRunningAgent?.(agentId));
      addDecision({
        action: 'stop',
        detail:
          reason ??
          (runningAgentIds.length > 0
            ? `Conductor stopped — killing ${runningAgentIds.length} running agent(s)`
            : 'Conductor stopped'),
      });
    },

    setConductorMaxConcurrent: (n) => set({ conductorMaxConcurrent: Math.max(1, n) }),

    setConductorProviderId: (id) => set({ conductorProviderId: id || null }),

    setConductorModel: (model) => set({ conductorModel: model || null }),

    conductorTick: async () => {
      if (!get().conductorRunning) return;
      const full = cross();
      const allTickets = full.pmDraftTickets ?? [];
      const goals = full.goalsDraft ?? [];
      const goalId = get().conductorGoalId;

      const scoped = goalId ? filterTicketsForGoal(allTickets, goals, goalId) : allTickets;
      const assignments = get().conductorAssignments;
      const hasActiveAgents = Object.keys(assignments).length > 0;

      // Scope exhausted: no open/in-progress work left and no agents running →
      // machine-check the goal and close the loop.
      const workLeft = scoped.some(
        (t) =>
          (t.status === 'open' &&
            (get().conductorFailedTickets[t.id] ?? 0) < MAX_TICKET_ATTEMPTS) ||
          t.status === 'in_progress'
      );
      if (!workLeft && !hasActiveAgents) {
        if (goalId) {
          const satisfaction = getGoalSatisfaction(
            goals,
            allTickets,
            full.requirementsDraft ?? [],
            full.goalRequirementLinksDraft ?? [],
            goalId
          );
          if (satisfaction.satisfied) {
            full.achieveGoal?.(goalId);
            addDecision({
              action: 'goal_achieved',
              detail: `Goal ${goalId} achieved — all checks green`,
            });
            halt();
          } else {
            halt();
            addDecision({
              action: 'stop',
              detail: `No work left but goal not satisfied: ${satisfaction.blockers.join('; ')}`,
            });
          }
        } else {
          halt();
          addDecision({ action: 'stop', detail: 'All unblocked tickets processed' });
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
          state.conductorMaxConcurrent - Object.keys(state.conductorAssignments).length;
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
          }
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
            // Real autonomous mode: runs without routine prompts but a
            // classifier vets each action. acceptEdits would still prompt on
            // Bash and hang the unattended PTY; bypass has no guardrails.
            permissionMode: 'auto',
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
      const entry = Object.entries(state.conductorAssignments).find(([, a]) => a === agentId);
      if (!entry) return;
      const [ticketId] = entry;
      const full = cross();
      const remaining = Object.fromEntries(
        Object.entries(state.conductorAssignments).filter(([t]) => t !== ticketId)
      );

      if (status === 'idle') {
        full.updateTicket?.(ticketId, { status: 'done' });
        set({ conductorAssignments: remaining });
        addDecision({
          action: 'complete',
          detail: 'Agent finished — ticket marked done',
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
              ? `Agent errored — requeued (attempt ${fails}/${MAX_TICKET_ATTEMPTS})`
              : `Agent errored — giving up after ${fails} attempts`,
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
      const entry = Object.entries(state.conductorAssignments).find(([, a]) => a === agentId);
      if (!entry) return;
      const [ticketId] = entry;
      const full = cross();
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
        detail: 'Agent killed by user — ticket reopened and excluded from this conductor run',
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
