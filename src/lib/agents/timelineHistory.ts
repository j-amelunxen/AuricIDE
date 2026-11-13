import type { AgentInfo } from './types';
import { TIMELINE_RANGES } from './supervisorTimeline';

/**
 * Slim copies of agents the live list has already dropped (dismiss, kill,
 * finished-agent cap). The Agents timeline reads this plus the live fleet, so
 * a finished bar stays visible for the largest timed window (Last 24h).
 *
 * Only the fields the chart draws: id, name, model, times, parent, tone.
 * Logs, events and spawn configs stay off this list.
 */

const DAY_RANGE = TIMELINE_RANGES.find((item) => item.id === '24h');
/** Largest timed range in `TIMELINE_RANGES` (`24h`). */
export const TIMELINE_HISTORY_MS: number =
  DAY_RANGE && DAY_RANGE.ms !== null ? DAY_RANGE.ms : 24 * 60 * 60_000;

export function snapshotTimelineAgent(agent: AgentInfo): AgentInfo {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    model: agent.model,
    provider: agent.provider,
    startedAt: agent.startedAt,
    ...(agent.finishedAt !== undefined ? { finishedAt: agent.finishedAt } : {}),
    ...(agent.lastActivityAt !== undefined ? { lastActivityAt: agent.lastActivityAt } : {}),
    ...(agent.currentTask !== undefined ? { currentTask: agent.currentTask } : {}),
    ...(agent.role !== undefined ? { role: agent.role } : {}),
    ...(agent.spawnedByAgentId !== undefined ? { spawnedByAgentId: agent.spawnedByAgentId } : {}),
    ...(agent.headless !== undefined ? { headless: agent.headless } : {}),
    ...(agent.repoPath !== undefined ? { repoPath: agent.repoPath } : {}),
    ...(agent.supervisorKey !== undefined ? { supervisorKey: agent.supervisorKey } : {}),
  };
}

export function stampTimelineEnded(agent: AgentInfo, now: number): AgentInfo {
  if (agent.status === 'running' || agent.status === 'queued') {
    return { ...agent, status: 'idle', finishedAt: agent.finishedAt ?? now };
  }
  return { ...agent, finishedAt: agent.finishedAt ?? now };
}

function runEnd(agent: AgentInfo, now: number): number {
  if (agent.status === 'running' || agent.status === 'queued') {
    return Math.max(now, agent.startedAt);
  }
  const ended = agent.finishedAt ?? agent.lastActivityAt ?? agent.startedAt;
  return Math.max(ended, agent.startedAt);
}

export function pruneTimelineHistory(
  history: readonly AgentInfo[],
  now: number,
  retainMs: number = TIMELINE_HISTORY_MS
): AgentInfo[] {
  const cutoff = now - retainMs;
  return history.filter((agent) => {
    if (agent.status === 'running' || agent.status === 'queued') return true;
    return runEnd(agent, now) > cutoff;
  });
}

export function upsertTimelineHistory(
  history: readonly AgentInfo[],
  agents: readonly AgentInfo[],
  now: number
): AgentInfo[] {
  const byId = new Map(history.map((agent) => [agent.id, agent]));
  for (const agent of agents) {
    byId.set(agent.id, snapshotTimelineAgent(agent));
  }
  return pruneTimelineHistory([...byId.values()], now);
}

/** Live records win on id so a running bar never freezes on a stale snapshot. */
export function mergeTimelineFleet(
  live: readonly AgentInfo[],
  history: readonly AgentInfo[]
): AgentInfo[] {
  const byId = new Map(history.map((agent) => [agent.id, agent]));
  for (const agent of live) {
    byId.set(agent.id, agent);
  }
  return [...byId.values()];
}
