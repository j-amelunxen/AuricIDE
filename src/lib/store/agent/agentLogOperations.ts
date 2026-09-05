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
  type AgentSlice,
} from './agentTypes';

export function handleAppendAgentLog(
  agentId: string,
  log: string,
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): void {
  const state = get();
  const existing = state.agentLogs[agentId] ?? [];
  const meta = state.agentLogMeta[agentId] ?? { seq: 0, bytes: 0 };
  let updated = [...existing, log];
  let bytes = meta.bytes + log.length;

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

  // Throttle lastActivityAt bumps: replacing the agents array on every
  // streamed chunk forces every agents-derived memo (orchestration graph,
  // fleet panel, goal badges) to recompute many times per second.
  const agent = state.agents.find((a) => a.id === agentId);
  const now = Date.now();
  const shouldBumpActivity =
    agent !== undefined && now - (agent.lastActivityAt ?? 0) > AGENT_ACTIVITY_BUMP_MS;

  const newEvents = extractorForAgent(agentId, agent?.provider).push(log, now);

  recordAgentLogEvents(
    { id: agentId, name: agent?.name ?? agentId, repoPath: agent?.repoPath },
    newEvents
  );

  const newStreamLines = streamCaptureForAgent(agentId).push(log, now);

  accumulateHeartbeatKinds(
    agentId,
    newEvents.map((event) => event.kind)
  );

  const flushedKinds = shouldBumpActivity ? drainHeartbeatKinds(agentId) : [];

  set({
    agentLogs: {
      ...state.agentLogs,
      [agentId]: updated,
    },
    agentLogMeta: {
      ...state.agentLogMeta,
      [agentId]: { seq: meta.seq + 1, bytes },
    },
    ...(newEvents.length > 0
      ? {
          agentEvents: {
            ...state.agentEvents,
            [agentId]: [...(state.agentEvents[agentId] ?? []), ...newEvents].slice(
              -MAX_AGENT_EVENTS
            ),
          },
        }
      : {}),
    ...(newStreamLines.length > 0
      ? {
          agentStreamLines: {
            ...state.agentStreamLines,
            [agentId]: appendStreamLines(state.agentStreamLines[agentId] ?? [], newStreamLines),
          },
        }
      : {}),
    ...(shouldBumpActivity
      ? {
          ...(flushedKinds.length > 0
            ? {
                agentHeartbeat: {
                  ...state.agentHeartbeat,
                  [agentId]: pushHeartbeat(state.agentHeartbeat[agentId] ?? [], flushedKinds, now),
                },
              }
            : {}),
          agents: state.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  lastActivityAt: now,
                  currentActivity: deriveAgentActivity(updated) ?? a.currentActivity,
                  awaitingInput: detectAwaitingInput(updated),
                }
              : a
          ),
        }
      : {}),
  });

  if (shouldBumpActivity) void flushAgentLog();
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
