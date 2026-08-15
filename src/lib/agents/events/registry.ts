import { createEventExtractor, type EventExtractor } from './extract';

interface AgentRuntime {
  extractor: EventExtractor;
  /**
   * The provider id the extractor was actually built with, or `undefined`
   * when it was built as a best-effort fallback before the agent's real
   * provider was known. `extractorForAgent` rebuilds — once — the first time
   * a real provider id shows up for this agent.
   */
  providerId: string | undefined;
  /** Output bytes seen since the last store flush — see `accumulateHeartbeatBytes`. */
  pendingHeartbeatBytes: number;
}

/**
 * One runtime record per agent, kept outside the Zustand store: the event
 * extractor (partial-line buffer, redraw-dedupe memory) and the heartbeat
 * byte accumulator both need to survive across PTY chunks without forcing a
 * `set()` on every one of them.
 */
const runtimeByAgent = new Map<string, AgentRuntime>();

function runtimeFor(agentId: string, providerId: string | undefined): AgentRuntime {
  const existing = runtimeByAgent.get(agentId);
  if (!existing) {
    const created: AgentRuntime = {
      extractor: createEventExtractor(providerId ?? 'generic'),
      providerId,
      pendingHeartbeatBytes: 0,
    };
    runtimeByAgent.set(agentId, created);
    return created;
  }

  // Tauri delivers PTY output and the spawn result out of order, so the
  // first chunk or two can arrive before the agent has a known provider.
  // The moment a real one shows up, rebuild with it — once. A provider never
  // changes after that, so a later call can't rebuild it out from under an
  // extractor whose buffer already reflects real output.
  if (existing.providerId === undefined && providerId !== undefined) {
    const rebuilt: AgentRuntime = {
      extractor: createEventExtractor(providerId),
      providerId,
      pendingHeartbeatBytes: existing.pendingHeartbeatBytes,
    };
    runtimeByAgent.set(agentId, rebuilt);
    return rebuilt;
  }

  return existing;
}

/**
 * The extractor for one agent, created on first use. Pass the agent's own
 * `provider` field, or `undefined` when the agent hasn't landed in `agents`
 * yet — see `runtimeFor` for what happens once a real one shows up.
 */
export function extractorForAgent(agentId: string, providerId: string | undefined): EventExtractor {
  return runtimeFor(agentId, providerId).extractor;
}

/**
 * Adds to an agent's pending heartbeat byte count without touching the
 * store — the store write rides a coarser throttle (see `agentSlice`'s
 * `appendAgentLog`), but every chunk's bytes still have to count somewhere
 * or they'd be lost between flushes.
 */
export function accumulateHeartbeatBytes(agentId: string, bytes: number): void {
  runtimeFor(agentId, undefined).pendingHeartbeatBytes += bytes;
}

/** Reads and zeroes an agent's pending heartbeat bytes — call this exactly once per flush. */
export function drainHeartbeatBytes(agentId: string): number {
  const runtime = runtimeByAgent.get(agentId);
  if (!runtime) return 0;
  const bytes = runtime.pendingHeartbeatBytes;
  runtime.pendingHeartbeatBytes = 0;
  return bytes;
}

/**
 * Drops an agent's whole runtime record — extractor and pending heartbeat
 * bytes alike. Call this everywhere an agent itself is removed (dismissed,
 * killed, evicted); otherwise this map grows for the app's whole lifetime.
 */
export function dropAgentExtractor(agentId: string): void {
  runtimeByAgent.delete(agentId);
}

/**
 * Drops every tracked runtime record whose id is not in `keepAgentIds` —
 * the sweep for an id that only ever showed up in `appendAgentLog` and never
 * landed in `agents` at all, which no single-id removal would otherwise
 * catch (Tauri does not order PTY output against the spawn result).
 */
export function pruneAgentRuntime(keepAgentIds: Iterable<string>): void {
  const keep = new Set(keepAgentIds);
  for (const id of runtimeByAgent.keys()) {
    if (!keep.has(id)) runtimeByAgent.delete(id);
  }
}

/** Test-only: clears every tracked runtime record so tests don't leak state into each other. */
export function resetAgentExtractors(): void {
  runtimeByAgent.clear();
}
