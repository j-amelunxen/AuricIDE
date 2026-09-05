import type { AgentColor } from '@/lib/agents/colors';
import { pruneAgentRuntime } from '@/lib/agents/events/registry';
import type { AgentInfo } from '@/lib/tauri/agents';
import { MAX_TICKET_ATTEMPTS } from '../conductor/conductorTypes';
import type { GoalsSlice } from '../goalsSlice';
import {
  UNGROUPED_REPO_KEY,
  type AgentRuntimeRecords,
  type AgentSlice,
  type LogRecords,
} from './agentTypes';

/** Close the still-running goal run of an agent, if any (cross-slice, optional). */
export function completeRunForAgent(
  state: AgentSlice,
  agentId: string,
  outcome: 'completed' | 'failed' | 'killed'
): void {
  const goalsSlice = state as AgentSlice & Partial<GoalsSlice>;
  if (!goalsSlice.completeGoalRun || !goalsSlice.goalRunsDraft) return;
  const run = goalsSlice.goalRunsDraft.find(
    (r) => r.agentId === agentId && r.outcome === 'running'
  );
  if (run) goalsSlice.completeGoalRun(run.id, outcome);
}

/** Drops the entries of a per-agent record for agents that no longer exist —
 * marker colours, event history, heartbeat buckets, all shaped the same way. */
export function withoutAgentIds<T>(
  record: Record<string, T>,
  gone: (agentId: string) => boolean
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !gone(id)));
}

/**
 * The log records with one agent's entry removed — the shared shape behind
 * killing and dismissing a single agent, which otherwise differ only in what
 * else they clean up around it.
 */
export function withoutAgentRecords(state: LogRecords, agentId: string): LogRecords {
  const { [agentId]: _logs, ...agentLogs } = state.agentLogs;
  const { [agentId]: _meta, ...agentLogMeta } = state.agentLogMeta;
  return { agentLogs, agentLogMeta };
}

/**
 * Drops event history, heartbeat buckets, the out-of-store extractor
 * registry, and the lane view state (mute, seen mark, sent messages) for any
 * id not present in `keepAgentIds`. Deliberately a sweep rather than a
 * single-id removal: an id can accumulate these records (`appendAgentLog`,
 * `sendAgentInput`, `toggleAgentMuted`, `markLaneSeen`) without ever landing
 * in `agents` at all — Tauri does not order PTY output against the spawn
 * result — so removing exactly the one agent a caller has in mind would miss
 * that orphan. Passing the post-removal `agents` id list here catches both in
 * one pass.
 */
export function reconcileAgentRuntimeState(
  state: AgentRuntimeRecords,
  keepAgentIds: Iterable<string>
): AgentRuntimeRecords {
  const keep = new Set(keepAgentIds);
  pruneAgentRuntime(keep);
  return {
    agentEvents: withoutAgentIds(state.agentEvents, (id) => !keep.has(id)),
    agentHeartbeat: withoutAgentIds(state.agentHeartbeat, (id) => !keep.has(id)),
    agentStreamLines: withoutAgentIds(state.agentStreamLines, (id) => !keep.has(id)),
    mutedAgentIds: state.mutedAgentIds.filter((id) => keep.has(id)),
    laneSeenAt: withoutAgentIds(state.laneSeenAt, (id) => !keep.has(id)),
    agentSentMessages: withoutAgentIds(state.agentSentMessages, (id) => !keep.has(id)),
  };
}

/** Drops marker colours for agents that no longer exist. */
export function withoutColors(
  colors: Record<string, AgentColor>,
  gone: (agentId: string) => boolean
): Record<string, AgentColor> {
  return withoutAgentIds(colors, gone);
}

export function groupAgentsByRepo(agents: AgentInfo[]): Record<string, AgentInfo[]> {
  const groups: Record<string, AgentInfo[]> = {};
  for (const agent of agents) {
    const key = agent.repoPath ?? UNGROUPED_REPO_KEY;
    if (!groups[key]) groups[key] = [];
    groups[key].push(agent);
  }
  return groups;
}

/**
 * True when the conductor manages this agent's ticket and still has attempts
 * left — it will requeue the work itself, so a failure toast would interrupt
 * the user for something the system is about to handle. Only the final,
 * given-up failure earns the interrupt.
 */
export function willConductorRetry(state: AgentSlice, agentId: string): boolean {
  const cross = state as AgentSlice &
    Partial<{
      conductorAssignments: Record<string, string>;
      conductorReviewAssignments: Record<string, string>;
      conductorFailedTickets: Record<string, number>;
    }>;
  const entry =
    Object.entries(cross.conductorAssignments ?? {}).find(([, a]) => a === agentId) ??
    Object.entries(cross.conductorReviewAssignments ?? {}).find(([, a]) => a === agentId);
  if (!entry) return false;
  return (cross.conductorFailedTickets?.[entry[0]] ?? 0) + 1 < MAX_TICKET_ATTEMPTS;
}
