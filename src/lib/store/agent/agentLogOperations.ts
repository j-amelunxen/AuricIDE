import { deriveAgentActivity } from '@/lib/agents/activity';
import { detectAwaitingInput } from '@/lib/agents/awaitingInput';
import { pushHeartbeat } from '@/lib/agents/events/heartbeat';
import {
  flushAgentLog,
  pruneAgentLogHistory,
  recordAgentLogEvents,
} from '@/lib/agents/events/persistence';
import {
  accumulateHeartbeatKinds,
  drainHeartbeatKinds,
  extractorForAgent,
  streamCaptureForAgent,
} from '@/lib/agents/events/registry';
import { appendStreamLines } from '@/lib/agents/events/streamCapture';
import { AGENT_ACTIVITY_BUMP_MS } from '@/lib/agents/liveness';
import { loadAppConfig } from '@/lib/config/appConfig';
import { agentLogLoad } from '@/lib/tauri/agentLog';
import {
  MAX_AGENT_EVENTS,
  MAX_AGENT_LOG_BYTES,
  MAX_AGENT_LOGS,
  MAX_LOADED_HISTORY,
  type AgentLogBatch,
  type AgentSlice,
} from './agentTypes';
import { wasAgentRemoved } from './removedAgents';

type AgentLogSet = (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void;

export function handleAppendAgentLog(
  agentId: string,
  log: string,
  get: () => AgentSlice,
  set: AgentLogSet
): void {
  handleAppendAgentLogBatch([[agentId, [log]]], get, set);
}

/**
 * Appends several agents' chunks with one store update.
 *
 * Agent output arrives many times a second per agent, and every `set` runs
 * every store listener. The output listener therefore collects chunks and
 * hands them over here once per frame (`outputBatcher.ts`). The result is
 * exactly what appending the chunks one by one would have produced — same
 * order, same trimming, `seq` advanced once per chunk, each chunk stamped
 * with the time it arrived.
 *
 * Chunks for an agent the user already removed are dropped (`removedAgents.ts`).
 */
export function handleAppendAgentLogBatch(
  batch: AgentLogBatch,
  get: () => AgentSlice,
  set: AgentLogSet
): void {
  const state = get();
  const now = Date.now();
  const agentLogs = { ...state.agentLogs };
  const agentLogMeta = { ...state.agentLogMeta };
  let agentEvents: AgentSlice['agentEvents'] | null = null;
  let agentStreamLines: AgentSlice['agentStreamLines'] | null = null;
  let agentHeartbeat: AgentSlice['agentHeartbeat'] | null = null;
  const bumped = new Map<string, string[]>();
  let bumpedAny = false;

  for (const [agentId, chunks, arrivedAt] of batch) {
    if (chunks.length === 0 || wasAgentRemoved(agentId)) continue;
    const meta = agentLogMeta[agentId] ?? { seq: 0, bytes: 0 };
    let updated = [...(agentLogs[agentId] ?? []), ...chunks];
    let bytes = meta.bytes;
    for (const chunk of chunks) bytes += chunk.length;

    // Trim oldest chunks past either cap, but always keep the newest chunk.
    let drop = 0;
    while (
      updated.length - drop > 1 &&
      (updated.length - drop > MAX_AGENT_LOGS || bytes > MAX_AGENT_LOG_BYTES)
    ) {
      bytes -= updated[drop].length;
      drop++;
    }
    if (drop > 0) {
      updated = updated.slice(drop);
    }
    agentLogs[agentId] = updated;
    agentLogMeta[agentId] = { seq: meta.seq + chunks.length, bytes };

    // Throttle lastActivityAt bumps: replacing the agents array on every
    // streamed chunk forces every agents-derived memo (orchestration graph,
    // fleet panel, goal badges) to recompute many times per second.
    const agent = state.agents.find((a) => a.id === agentId);
    const shouldBumpActivity =
      agent !== undefined && now - (agent.lastActivityAt ?? 0) > AGENT_ACTIVITY_BUMP_MS;

    const extractor = extractorForAgent(agentId, agent?.provider);
    const capture = streamCaptureForAgent(agentId);
    const newEvents: ReturnType<typeof extractor.push> = [];
    const newStreamLines: ReturnType<typeof capture.push> = [];
    chunks.forEach((chunk, i) => {
      const at = arrivedAt?.[i] ?? now;
      newEvents.push(...extractor.push(chunk, at));
      newStreamLines.push(...capture.push(chunk, at));
    });

    recordAgentLogEvents(
      { id: agentId, name: agent?.name ?? agentId, repoPath: agent?.repoPath },
      newEvents
    );

    accumulateHeartbeatKinds(
      agentId,
      newEvents.map((event) => event.kind)
    );

    if (newEvents.length > 0) {
      agentEvents ??= { ...state.agentEvents };
      agentEvents[agentId] = [...(agentEvents[agentId] ?? []), ...newEvents].slice(
        -MAX_AGENT_EVENTS
      );
    }
    if (newStreamLines.length > 0) {
      agentStreamLines ??= { ...state.agentStreamLines };
      agentStreamLines[agentId] = appendStreamLines(
        agentStreamLines[agentId] ?? [],
        newStreamLines
      );
    }
    if (shouldBumpActivity) {
      bumpedAny = true;
      bumped.set(agentId, updated);
      const flushedKinds = drainHeartbeatKinds(agentId);
      if (flushedKinds.length > 0) {
        agentHeartbeat ??= { ...state.agentHeartbeat };
        agentHeartbeat[agentId] = pushHeartbeat(agentHeartbeat[agentId] ?? [], flushedKinds, now);
      }
    }
  }

  set({
    agentLogs,
    agentLogMeta,
    ...(agentEvents ? { agentEvents } : {}),
    ...(agentStreamLines ? { agentStreamLines } : {}),
    ...(agentHeartbeat ? { agentHeartbeat } : {}),
    ...(bumpedAny
      ? {
          agents: state.agents.map((a) => {
            const logs = bumped.get(a.id);
            return logs
              ? {
                  ...a,
                  lastActivityAt: now,
                  currentActivity: deriveAgentActivity(logs) ?? a.currentActivity,
                  awaitingInput: detectAwaitingInput(logs),
                }
              : a;
          }),
        }
      : {}),
  });

  if (bumpedAny) void flushAgentLog();
}

export async function handleLoadAgentLogHistory(
  set: (update: Partial<AgentSlice>) => void
): Promise<void> {
  await pruneAgentLogHistory();

  const { agentLogPersist } = loadAppConfig();
  if (!agentLogPersist) {
    set({ agentLogHistory: [] });
    return;
  }

  try {
    set({ agentLogHistory: await agentLogLoad(MAX_LOADED_HISTORY) });
  } catch {
    set({ agentLogHistory: [] });
  }
}
