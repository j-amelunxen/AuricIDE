import { Terminal } from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { useStore } from '../store';

/**
 * Per-agent headless mirror terminals.
 *
 * The store retains at most MAX_AGENT_LOG_BYTES of raw agent output, but a
 * TUI agent (Claude Code) paints static UI once and then diff-renders single
 * rows in place. Once trimming drops the chunks that painted the static
 * parts, replaying the retained tail produces a corrupted screen — cursor
 * movements land on rows that were never painted (merged words, duplicated
 * lines, stale fragments).
 *
 * A mirror terminal consumes EVERY chunk from the moment it is appended, so
 * its buffer is always the true current screen regardless of trimming. Late
 * attaches (opening the agent terminal modal) write a serialized snapshot of
 * the mirror instead of replaying raw history — the same reattach model tmux
 * and VS Code use.
 *
 * Feeding happens via a store subscription registered at module load, keyed
 * on the same per-agent seq counter the terminals use, so mirror state and
 * store state can never drift.
 */
interface AgentMirror {
  term: Terminal;
  serialize: SerializeAddon;
  /** Seq of the last chunk queued into the mirror. */
  seq: number;
  /**
   * True once the mirror was resized while it already held output. Raw
   * history then spans multiple geometries, so only a serialized snapshot
   * reproduces the current screen faithfully.
   */
  resized: boolean;
}

export interface AgentScreenSnapshot {
  /** Serialized screen content, writable into a fresh terminal. */
  data: string;
  /** Seq of the last chunk included in the snapshot. */
  seq: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

const mirrors = new Map<string, AgentMirror>();
/** PTY sizes reported before the first chunk arrived for an agent. */
const pendingSizes = new Map<string, { rows: number; cols: number }>();

type PtySizeListener = (size: { rows: number; cols: number }) => void;
/** Attached views listening for PTY geometry changes (tmux reattach model). */
const resizeListeners = new Map<string, Set<PtySizeListener>>();

function createMirror(agentId: string): AgentMirror {
  const size = pendingSizes.get(agentId);
  const term = new Terminal({
    cols: size?.cols ?? DEFAULT_COLS,
    rows: size?.rows ?? DEFAULT_ROWS,
    scrollback: 1000,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  const mirror: AgentMirror = { term, serialize, seq: 0, resized: false };
  mirrors.set(agentId, mirror);
  return mirror;
}

/** Feed mirrors from the store; dispose mirrors of removed agents. */
function onStoreChange(
  state: { agentLogs: Record<string, string[]>; agentLogMeta: Record<string, { seq: number }> },
  prev: { agentLogMeta: Record<string, { seq: number }> }
): void {
  if (state.agentLogMeta === prev.agentLogMeta) return;

  for (const [agentId, meta] of Object.entries(state.agentLogMeta)) {
    let mirror = mirrors.get(agentId);
    if (!mirror) {
      // First sighting: best effort — replay whatever history is retained.
      mirror = createMirror(agentId);
      const history = state.agentLogs[agentId] ?? [];
      if (history.length > 0) {
        mirror.term.write(history.join(''));
      }
      mirror.seq = meta.seq;
      continue;
    }
    if (meta.seq > mirror.seq) {
      const logs = state.agentLogs[agentId] ?? [];
      const start = Math.max(0, logs.length - (meta.seq - mirror.seq));
      mirror.term.write(logs.slice(start).join(''));
      mirror.seq = meta.seq;
    }
  }

  for (const agentId of Array.from(mirrors.keys())) {
    if (!(agentId in state.agentLogMeta)) {
      disposeAgentMirror(agentId);
    }
  }
}

useStore.subscribe(onStoreChange);

/**
 * Snapshot the agent's current screen. Resolves once all chunks queued so
 * far are parsed, so `seq` is exact: chunks with a higher seq are NOT part
 * of the snapshot and must be written by the caller. Returns null when no
 * mirror exists (agent never produced output).
 */
export function snapshotAgentScreen(agentId: string): Promise<AgentScreenSnapshot> | null {
  const mirror = mirrors.get(agentId);
  if (!mirror) return null;
  const seq = mirror.seq;
  return new Promise((resolve) => {
    // xterm parses queued writes in order and fires this callback before any
    // write queued after it is parsed — the serialized state matches `seq`.
    mirror.term.write('', () => {
      resolve({ data: mirror.serialize.serialize(), seq });
    });
  });
}

/** Keep the mirror's dimensions in lockstep with the agent PTY. */
export function resizeAgentMirror(agentId: string, rows: number, cols: number): void {
  const prev = pendingSizes.get(agentId);
  pendingSizes.set(agentId, { rows, cols });
  const mirror = mirrors.get(agentId);
  if (mirror && (mirror.term.rows !== rows || mirror.term.cols !== cols)) {
    mirror.term.resize(cols, rows);
    mirror.resized = true;
  }
  if (!prev || prev.rows !== rows || prev.cols !== cols) {
    for (const listener of Array.from(resizeListeners.get(agentId) ?? [])) {
      listener({ rows, cols });
    }
  }
}

/**
 * Subscribe to PTY geometry changes for an agent. Attached views use this to
 * adopt a size another view forced onto the PTY (tmux "last attach wins"):
 * resize to it and redraw from a fresh snapshot instead of keeping a screen
 * laid out for the old width.
 */
export function onAgentPtyResize(agentId: string, listener: PtySizeListener): () => void {
  let set = resizeListeners.get(agentId);
  if (!set) {
    set = new Set();
    resizeListeners.set(agentId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && resizeListeners.get(agentId) === set) {
      resizeListeners.delete(agentId);
    }
  };
}

/** True when the agent's raw log history spans more than one PTY geometry. */
export function agentMirrorResized(agentId: string): boolean {
  return mirrors.get(agentId)?.resized ?? false;
}

export function disposeAgentMirror(agentId: string): void {
  const mirror = mirrors.get(agentId);
  if (!mirror) return;
  mirror.term.dispose();
  mirrors.delete(agentId);
  pendingSizes.delete(agentId);
}

/** Test hook: drop all mirrors so each test starts from a clean slate. */
export function disposeAllAgentMirrors(): void {
  for (const agentId of Array.from(mirrors.keys())) {
    disposeAgentMirror(agentId);
  }
  pendingSizes.clear();
  resizeListeners.clear();
}
