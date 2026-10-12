import { appendCapped, appendCappedLog } from '../../agents/appendCapped';
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
  type AgentRoster,
  type AgentSlice,
} from './agentTypes';
import { withoutAgentIds } from './agentStateHelpers';
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
    // Trim oldest chunks past either cap, but always keep the newest chunk.
    const { logs: updated, bytes } = appendCappedLog(
      agentLogs[agentId] ?? [],
      chunks,
      meta.bytes,
      MAX_AGENT_LOGS,
      MAX_AGENT_LOG_BYTES
    );
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
      agentEvents[agentId] = appendCapped(agentEvents[agentId] ?? [], newEvents, MAX_AGENT_EVENTS);
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

/**
 * Appends raw chunks for a terminal to draw, and derives nothing from them.
 *
 * This is how the detached agent window writes output
 * (`docs/design-agent-window.md`, rule 1). It holds only what an agent printed
 * since the window opened, so anything it worked out from that — activity,
 * awaiting input, events, the heartbeat — would disagree with the main
 * window, which has seen the whole run. Those fields arrive with the roster.
 * Same caps and the same `seq` counting as `handleAppendAgentLogBatch`, so
 * the terminals and their mirrors read this log exactly like the other.
 */
export function handleAppendAgentTerminalChunks(
  agentId: string,
  chunks: readonly string[],
  get: () => AgentSlice,
  set: AgentLogSet
): void {
  if (chunks.length === 0) return;
  const state = get();
  const meta = state.agentLogMeta[agentId] ?? { seq: 0, bytes: 0 };
  const { logs, bytes } = appendCappedLog(
    state.agentLogs[agentId] ?? [],
    chunks,
    meta.bytes,
    MAX_AGENT_LOGS,
    MAX_AGENT_LOG_BYTES
  );
  set({
    agentLogs: { ...state.agentLogs, [agentId]: logs },
    agentLogMeta: { ...state.agentLogMeta, [agentId]: { seq: meta.seq + chunks.length, bytes } },
  });
}

function sameDigests(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Takes the main window's roster as the agent window's truth about agents.
 *
 * The log records and the digests keep their reference when the roster changes
 * nothing about them: a roster arrives several times a second, and a new
 * object each time would re-run every subscriber for no change.
 */
export function handleApplyAgentRoster(
  roster: AgentRoster,
  get: () => AgentSlice,
  set: AgentLogSet
): void {
  const state = get();
  const onRoster = new Set(roster.agents.map((a) => a.id));
  // Left the roster, as opposed to not on it yet: a new agent's first output
  // can get here before the roster that introduces it, and its log must not
  // be swept away as a leftover.
  const left = new Set(state.agents.filter((a) => !onRoster.has(a.id)).map((a) => a.id));
  const gone = (agentId: string) => left.has(agentId);
  const logsOutlived = Object.keys(state.agentLogMeta).some(gone);
  const shown = state.agentWindowActiveAgentId;

  set({
    agents: roster.agents,
    ...(sameDigests(state.agentWindowErrorDigests, roster.errorDigests)
      ? {}
      : { agentWindowErrorDigests: roster.errorDigests }),
    ...(logsOutlived
      ? {
          agentLogs: withoutAgentIds(state.agentLogs, gone),
          agentLogMeta: withoutAgentIds(state.agentLogMeta, gone),
        }
      : {}),
    // The window always shows an agent while there is one: a terminal for an
    // agent that is gone would be an empty frame, and a window that opened on
    // an empty fleet has to pick up the first agent that appears.
    ...(shown === null || !onRoster.has(shown)
      ? { agentWindowActiveAgentId: roster.agents[0]?.id ?? null }
      : {}),
  });
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
