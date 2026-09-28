/**
 * Ids of agents the user removed — killed, dismissed, evicted — this session.
 *
 * Output reaches the store up to a frame (hidden window: 100 ms) after it
 * arrived (`outputBatcher.ts`), so a batch can land after its agent was
 * removed. Appending it would bring back the log, its metadata and with them
 * a mirror terminal and extractor state that nothing ever clears again. A
 * removed id is therefore refused for good.
 *
 * Only removals count. Output for an id the store has not seen yet is normal
 * — Tauri does not order PTY output against the spawn result — and must be
 * kept. The backend numbers agents from a per-process counter, so a removed
 * id is never handed out again while this module lives.
 */
const MAX_REMEMBERED = 1_000;

const removed = new Set<string>();

export function markAgentsRemoved(agentIds: Iterable<string>): void {
  for (const id of agentIds) {
    removed.delete(id);
    removed.add(id);
  }
  // A Set iterates in insertion order: the first entries are the oldest.
  for (const id of removed) {
    if (removed.size <= MAX_REMEMBERED) break;
    removed.delete(id);
  }
}

export function wasAgentRemoved(agentId: string): boolean {
  return removed.has(agentId);
}

/** Test hook. */
export function resetRemovedAgents(): void {
  removed.clear();
}
