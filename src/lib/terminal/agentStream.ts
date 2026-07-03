import { useStore } from '../store';

export interface TerminalLike {
  write: (data: string) => void;
}

/**
 * Feed a terminal from the store's agent log buffer: replay the retained
 * history, then follow new appends via a synchronous store subscription
 * keyed on the per-agent seq counter.
 *
 * The store is the single source of truth for agent output — attaching a
 * second event channel (terminal-out) alongside a history backfill leaves
 * an await gap in which chunks are lost or written twice.
 *
 * Returns a detach function.
 */
export function attachAgentStream(term: TerminalLike, agentId: string): () => void {
  const initial = useStore.getState();
  let cursor = initial.agentLogMeta[agentId]?.seq ?? 0;
  const history = initial.agentLogs[agentId] ?? [];
  if (history.length > 0) {
    term.write(history.join(''));
  }

  return useStore.subscribe((state) => {
    const seq = state.agentLogMeta[agentId]?.seq ?? 0;
    if (seq <= cursor) return;
    const logs = state.agentLogs[agentId] ?? [];
    // New chunks sit at the tail; if trimming outpaced the cursor, write
    // what is still retained.
    const start = Math.max(0, logs.length - (seq - cursor));
    cursor = seq;
    term.write(logs.slice(start).join(''));
  });
}
