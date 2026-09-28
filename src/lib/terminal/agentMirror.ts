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
 *
 * Parsing is deferred. The subscription only queues references to new chunks;
 * they reach the VT parser in one write once `MIRROR_PARSE_BYTES` have piled
 * up, or the moment someone needs the screen (snapshot, resize). Most mirrors
 * are never read, and a TUI agent streams a redraw every few frames — parsing
 * each chunk as it arrived kept a parser busy per agent for nothing. The
 * queue is the mirror's own, so store trimming cannot take chunks from it.
 *
 * A finished agent's mirror is frozen: its screen is serialized once and the
 * terminal disposed. A headless terminal keeps a typed-array row for every
 * scrollback line — about 12 bytes a cell, 1–2 MB for a full buffer — and the
 * store keeps up to `MAX_FINISHED_AGENTS` finished runs around for review.
 * The serialized string is what a snapshot would have returned anyway, so a
 * frozen mirror answers snapshots with it unchanged; should the agent print
 * or be resized again, the mirror thaws by writing it into a new terminal.
 */
interface AgentMirror {
  /** Null while frozen. */
  term: Terminal | null;
  serialize: SerializeAddon | null;
  /** The serialized screen of a frozen mirror; null while live. */
  frozen: string | null;
  /** Geometry to thaw into — the terminal's own while it exists. */
  cols: number;
  rows: number;
  /** Seq of the last chunk queued into the mirror. */
  seq: number;
  /** Chunks queued but not yet written to the parser, oldest first. */
  pending: string[];
  pendingBytes: number;
  /**
   * True once the mirror was resized while it already held output. Raw
   * history then spans multiple geometries, so only a serialized snapshot
   * reproduces the current screen faithfully.
   */
  resized: boolean;
}

interface LiveMirror extends AgentMirror {
  term: Terminal;
  serialize: SerializeAddon;
}

export interface AgentScreenSnapshot {
  /** Serialized screen content, writable into a fresh terminal. */
  data: string;
  /** Seq of the last chunk included in the snapshot. */
  seq: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SCROLLBACK = 1000;

/**
 * Queued output that forces a parse even though nobody asked for the screen.
 * Bounds the queue's memory per agent while still turning thirty small
 * writes a second into one every several seconds.
 */
export const MIRROR_PARSE_BYTES = 64 * 1024;

type MirrorStoreState = {
  agentLogs: Record<string, string[]>;
  agentLogMeta: Record<string, { seq: number }>;
  agents?: { id: string; status: string }[];
};

const mirrors = new Map<string, AgentMirror>();
/** PTY sizes reported before the first chunk arrived for an agent. */
const pendingSizes = new Map<string, { rows: number; cols: number }>();

type PtySizeListener = (size: { rows: number; cols: number }) => void;
/** Attached views listening for PTY geometry changes (tmux reattach model). */
const resizeListeners = new Map<string, Set<PtySizeListener>>();

function openTerminal(mirror: AgentMirror): LiveMirror {
  const term = new Terminal({
    cols: mirror.cols,
    rows: mirror.rows,
    scrollback: SCROLLBACK,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  mirror.term = term;
  mirror.serialize = serialize;
  return mirror as LiveMirror;
}

function createMirror(agentId: string): LiveMirror {
  const size = pendingSizes.get(agentId);
  const mirror: AgentMirror = {
    term: null,
    serialize: null,
    frozen: null,
    cols: size?.cols ?? DEFAULT_COLS,
    rows: size?.rows ?? DEFAULT_ROWS,
    seq: 0,
    pending: [],
    pendingBytes: 0,
    resized: false,
  };
  mirrors.set(agentId, mirror);
  return openTerminal(mirror);
}

/** A frozen mirror gets its terminal back, holding the screen it froze with. */
function thaw(mirror: AgentMirror): LiveMirror {
  if (mirror.term) return mirror as LiveMirror;
  const live = openTerminal(mirror);
  if (mirror.frozen) live.term.write(mirror.frozen);
  mirror.frozen = null;
  return live;
}

function enqueue(mirror: AgentMirror, logs: readonly string[], start: number): void {
  if (start >= logs.length) return;
  const live = thaw(mirror);
  for (let i = start; i < logs.length; i++) {
    live.pending.push(logs[i]);
    live.pendingBytes += logs[i].length;
  }
  if (live.pendingBytes >= MIRROR_PARSE_BYTES) drain(live);
}

/** Hand every queued chunk to the parser, in order, as one write. */
function drain(mirror: LiveMirror): void {
  if (mirror.pending.length === 0) return;
  mirror.term.write(mirror.pending.join(''));
  mirror.pending = [];
  mirror.pendingBytes = 0;
}

function isFinished(status: string | undefined): boolean {
  return status === 'idle' || status === 'error';
}

/**
 * Serialize a finished agent's screen and release its terminal. Asynchronous
 * because the parser must finish its queue first; abandoned if output arrived
 * or the agent came back to life in the meantime.
 */
function freeze(agentId: string, mirror: AgentMirror): void {
  if (!mirror.term) return;
  const live = mirror as LiveMirror;
  drain(live);
  const seq = live.seq;
  const term = live.term;
  term.write('', () => {
    if (mirrors.get(agentId) !== mirror || mirror.term !== term || mirror.seq !== seq) return;
    const status = useStore.getState().agents.find((a) => a.id === agentId)?.status;
    if (!isFinished(status) || mirror.pending.length > 0) return;
    mirror.frozen = flatten(live.serialize.serialize());
    term.dispose();
    mirror.term = null;
    mirror.serialize = null;
  });
}

/**
 * A copy of `text` stored as one contiguous string.
 *
 * The serializer builds its result by concatenation, which engines keep as a
 * tree of the pieces: measured on a full 1,000-line buffer, the string held
 * 1.8 MB for 66 k characters — as much as the terminal it was meant to
 * replace. A JSON round-trip yields a new, flat string (~130 kB there).
 */
function flatten(text: string): string {
  return JSON.parse(JSON.stringify(text)) as string;
}

/** Feed mirrors from the store; freeze finished ones; dispose removed ones. */
function onStoreChange(state: MirrorStoreState, prev: MirrorStoreState): void {
  const logsChanged = state.agentLogMeta !== prev.agentLogMeta;
  if (!logsChanged && state.agents === prev.agents) return;

  if (logsChanged) {
    for (const [agentId, meta] of Object.entries(state.agentLogMeta)) {
      let mirror = mirrors.get(agentId);
      if (!mirror) {
        // First sighting: best effort — replay whatever history is retained.
        mirror = createMirror(agentId);
        enqueue(mirror, state.agentLogs[agentId] ?? [], 0);
        mirror.seq = meta.seq;
        continue;
      }
      if (meta.seq > mirror.seq) {
        const logs = state.agentLogs[agentId] ?? [];
        enqueue(mirror, logs, Math.max(0, logs.length - (meta.seq - mirror.seq)));
        mirror.seq = meta.seq;
      }
    }

    for (const agentId of Array.from(mirrors.keys())) {
      if (!(agentId in state.agentLogMeta)) {
        disposeAgentMirror(agentId);
      }
    }
  }

  for (const agent of state.agents ?? []) {
    const mirror = mirrors.get(agent.id);
    if (mirror?.term && isFinished(agent.status)) freeze(agent.id, mirror);
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
  if (!mirror.term) return Promise.resolve({ data: mirror.frozen ?? '', seq });
  const live = mirror as LiveMirror;
  drain(live);
  const { term, serialize } = live;
  return new Promise((resolve) => {
    // xterm parses queued writes in order and fires this callback before any
    // write queued after it is parsed — the serialized state matches `seq`.
    term.write('', () => {
      // A freeze that landed first serialized this same state and released
      // the terminal; its string is the answer.
      resolve({ data: mirror.term === term ? serialize.serialize() : (mirror.frozen ?? ''), seq });
    });
  });
}

/** Keep the mirror's dimensions in lockstep with the agent PTY. */
export function resizeAgentMirror(agentId: string, rows: number, cols: number): void {
  const prev = pendingSizes.get(agentId);
  pendingSizes.set(agentId, { rows, cols });
  const mirror = mirrors.get(agentId);
  if (mirror && (mirror.rows !== rows || mirror.cols !== cols)) {
    const live = thaw(mirror);
    // Output produced at the old geometry goes in ahead of the resize, the
    // order it would have had if it had been written as it arrived.
    drain(live);
    live.term.resize(cols, rows);
    live.cols = cols;
    live.rows = rows;
    live.resized = true;
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

/** True while the agent's mirror holds a live terminal rather than a frozen screen. */
export function agentMirrorIsLive(agentId: string): boolean {
  return (mirrors.get(agentId)?.term ?? null) !== null;
}

export function disposeAgentMirror(agentId: string): void {
  const mirror = mirrors.get(agentId);
  if (!mirror) return;
  mirror.term?.dispose();
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
