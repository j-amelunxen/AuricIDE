import { useStore } from '../store';
import { agentMirrorResized, snapshotAgentScreen } from './agentMirror';

export interface TerminalLike {
  write: (data: string) => void;
}

export interface AgentStreamHandle {
  /** Stop following the agent's output. */
  detach: () => void;
  /**
   * Resolves once the initial screen is on the terminal. Restoring from a
   * mirror snapshot is asynchronous (the mirror must finish parsing its
   * queue), so without this signal a caller cannot tell an empty terminal
   * from one that has not been painted yet. Never rejects.
   */
  restored: Promise<void>;
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
 * Raw replay is only faithful while every retained chunk was produced at
 * one PTY geometry AND nothing was trimmed. When trimming has dropped
 * chunks, replay starts mid-frame and corrupts the screen (TUI redraws
 * assume rows the tail never painted); when the PTY was resized mid-run,
 * early frames were laid out for a width that no longer exists. In either
 * case the retained history is NOT replayed; instead a serialized screen
 * snapshot from the agent's mirror terminal is written, and live chunks
 * that arrive while the snapshot settles are buffered and deduped against
 * the snapshot's seq.
 *
 * Returns a handle with a detach function and a `restored` promise that
 * resolves once the initial screen has been written.
 */
export function attachAgentStream(term: TerminalLike, agentId: string): AgentStreamHandle {
  const initial = useStore.getState();
  const meta = initial.agentLogMeta[agentId];
  let cursor = meta?.seq ?? 0;
  const history = initial.agentLogs[agentId] ?? [];
  const trimmed = meta !== undefined && meta.seq > history.length;

  let detached = false;
  // While a snapshot is settling, live chunks are buffered with their seq so
  // they can be replayed after it — minus those the snapshot already covers.
  let buffered: { seq: number; data: string }[] | null = null;

  const snapshot = trimmed || agentMirrorResized(agentId) ? snapshotAgentScreen(agentId) : null;
  let restored: Promise<void>;
  if (snapshot) {
    buffered = [];
    restored = snapshot.then(({ data, seq }) => {
      if (detached) return;
      term.write(data);
      for (const chunk of buffered ?? []) {
        if (chunk.seq > seq) term.write(chunk.data);
      }
      buffered = null;
    });
  } else {
    if (history.length > 0) term.write(history.join(''));
    restored = Promise.resolve();
  }

  const unsubscribe = useStore.subscribe((state) => {
    const seq = state.agentLogMeta[agentId]?.seq ?? 0;
    if (seq <= cursor) return;
    const logs = state.agentLogs[agentId] ?? [];
    // New chunks sit at the tail; if trimming outpaced the cursor, take
    // what is still retained.
    const start = Math.max(0, logs.length - (seq - cursor));
    if (buffered) {
      // Chunk at index i (i >= start) has seq: seq - (logs.length - i) + 1
      for (let i = start; i < logs.length; i++) {
        buffered.push({ seq: seq - (logs.length - i) + 1, data: logs[i] });
      }
    } else {
      term.write(logs.slice(start).join(''));
    }
    cursor = seq;
  });

  return {
    detach: () => {
      detached = true;
      unsubscribe();
    },
    restored,
  };
}
