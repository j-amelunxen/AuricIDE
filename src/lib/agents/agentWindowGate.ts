/**
 * The seam between a snapshot and the live stream, for the detached agent
 * window (`docs/design-agent-window.md`, rule 3).
 *
 * The agent window gets an agent's screen so far from the main window and its
 * live output from Rust, over two channels that are not ordered against each
 * other. A batch that arrives before the snapshot may or may not be part of
 * it. Offsets settle that: Rust stamps every batch with the bytes the agent
 * has emitted including that batch, and a snapshot names the offset its screen
 * reaches. Until an agent has a screen its batches wait here; the snapshot
 * then decides which of them are news.
 *
 * Waiting is bounded twice over. Batches are kept only for agents the gate was
 * told to expect — the ones on the roster, whose snapshot will be asked for.
 * Output of any other agent has no snapshot coming that could release it, and
 * needs none kept: when a roster does name the agent, the snapshot taken then
 * covers everything that went by. And one agent's wait holds at most
 * `maxBufferedBytes`; past that the buffer is dropped and a newer snapshot
 * asked for, which by construction covers what was dropped.
 *
 * Pure bookkeeping — no Tauri, no store — so the edges can be tested as data.
 */
export interface AgentWindowGate {
  /** A roster names this agent: its snapshot will be asked for, so its batches are kept. */
  expect: (agentId: string) => void;
  /**
   * A live batch. Returns the lines to write now: the line itself once the
   * agent is synced, nothing while it is still waiting for its snapshot.
   */
  push: (agentId: string, line: string, endOffset: number) => string[];
  /**
   * The agent's snapshot arrived, reaching `snapshotEndOffset`. Returns the
   * buffered lines the snapshot does not hold, in order. A snapshot for an
   * agent that is already synced changes nothing and returns nothing. Null
   * means the snapshot was refused and the agent is still not synced: it is
   * older than batches that were dropped for space, and would leave a hole.
   */
  seed: (agentId: string, snapshotEndOffset: number) => string[] | null;
  isSynced: (agentId: string) => boolean;
  /** The agent is gone; a later one with the same id starts from scratch. */
  forget: (agentId: string) => void;
}

export interface AgentWindowGateOptions {
  /** Most that is held for one agent, in the log's own measure (string length). */
  maxBufferedBytes?: number;
  /** An agent's buffer was dropped; it needs a snapshot newer than the one asked for. */
  onOverflow?: (agentId: string) => void;
}

interface Waiting {
  batches: { line: string; endOffset: number }[];
  bytes: number;
}

const encoder = new TextEncoder();

/** Offsets count raw UTF-8 bytes, so a batch's start has to be measured in them. */
export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

export function createAgentWindowGate(options: AgentWindowGateOptions = {}): AgentWindowGate {
  const maxBufferedBytes = options.maxBufferedBytes ?? Number.POSITIVE_INFINITY;
  const synced = new Set<string>();
  const expected = new Set<string>();
  const waiting = new Map<string, Waiting>();
  /** Per agent, the offset its dropped batches reached: no older snapshot will do. */
  const droppedThrough = new Map<string, number>();

  return {
    expect: (agentId) => {
      expected.add(agentId);
    },

    push: (agentId, line, endOffset) => {
      if (synced.has(agentId)) return [line];
      const held = waiting.get(agentId);
      // The first batch of a run needs no snapshot: nothing came before it,
      // so an empty screen plus this batch is the whole truth. This holds for
      // an agent no roster has named yet, too — a new agent can print before
      // the throttled roster introduces it.
      if (!held && !droppedThrough.has(agentId) && endOffset - utf8ByteLength(line) === 0) {
        synced.add(agentId);
        return [line];
      }
      if (!expected.has(agentId)) return [];

      const lane = held ?? { batches: [], bytes: 0 };
      lane.batches.push({ line, endOffset });
      lane.bytes += line.length;
      if (lane.bytes > maxBufferedBytes) {
        waiting.delete(agentId);
        droppedThrough.set(agentId, endOffset);
        options.onOverflow?.(agentId);
      } else if (!held) {
        waiting.set(agentId, lane);
      }
      return [];
    },

    seed: (agentId, snapshotEndOffset) => {
      if (synced.has(agentId)) return [];
      if (snapshotEndOffset < (droppedThrough.get(agentId) ?? 0)) return null;
      const batches = waiting.get(agentId)?.batches ?? [];
      waiting.delete(agentId);
      droppedThrough.delete(agentId);
      synced.add(agentId);
      return batches
        .filter((batch) => batch.endOffset > snapshotEndOffset)
        .map((batch) => batch.line);
    },

    isSynced: (agentId) => synced.has(agentId),

    forget: (agentId) => {
      synced.delete(agentId);
      expected.delete(agentId);
      waiting.delete(agentId);
      droppedThrough.delete(agentId);
    },
  };
}
