import { useStore } from '@/lib/store';
import { MAX_AGENT_LOG_BYTES } from '@/lib/store/agent/agentTypes';
import { onAgentOutput } from '@/lib/tauri/agentEvents';
import { acceptWindowMessage, onWindowMessage, sendToWindow } from '@/lib/tauri/agentWindow';
import { installPtyResizeSync } from '@/lib/tauri/terminal';
import { disposeAgentMirror, seedAgentMirror } from '@/lib/terminal/agentMirror';
import {
  AGENT_WINDOW_CLIENT_EVENTS,
  AGENT_WINDOW_HOST_EVENTS,
  AGENT_WINDOW_LABELS,
  SNAPSHOT_TIMEOUT_MS,
  type AgentWindowAction,
  type AgentWindowMessages,
} from './agentWindow.contract';
import { createAgentWindowGate } from './agentWindowGate';
import { createOutputBatcher } from './outputBatcher';

/**
 * The agent window's side of the detached agent window
 * (`docs/design-agent-window.md`).
 *
 * This window has a store and mirrors of its own, and they start empty. What
 * fills them, and from where:
 *
 * - **Who the agents are** comes from the main window's roster, and from
 *   nowhere else. Nothing here derives a status, an activity line or an
 *   awaiting-input flag from output — this window missed everything an agent
 *   printed before it opened and would come to different conclusions.
 * - **The screen so far** comes from the main window, one snapshot per agent.
 * - **Live output** comes straight from Rust, and is held back per agent
 *   until that agent's snapshot is in (`agentWindowGate.ts`).
 *
 * Typing and resizing go straight to Rust from the views. Everything with
 * consequences goes back to the main window as an action.
 */

function sendToHost(event: string, payload?: unknown): Promise<void> {
  return sendToWindow(AGENT_WINDOW_LABELS.main, event, payload).catch((error: unknown) => {
    console.warn(`[agent-window] could not send ${event}: ${String(error)}`);
  });
}

/** Ask the main window to do something that is its to do: stop, clear, save, dock. */
export function sendAgentWindowAction(action: AgentWindowAction): Promise<void> {
  return sendToHost(AGENT_WINDOW_CLIENT_EVENTS.action, action);
}

/** How many listeners must be in place before `hello` may go out. */
const LISTENERS_BEFORE_HELLO = 6;

/**
 * Runs the agent window's half for as long as its page is mounted. Agent
 * window only.
 */
export function installAgentWindowClient(): () => void {
  const store = () => useStore.getState();
  const gate = createAgentWindowGate({
    // An agent can print for as long as its snapshot takes. Past what the log
    // itself would keep, the wait starts over with a newer picture.
    maxBufferedBytes: MAX_AGENT_LOG_BYTES,
    onOverflow: (agentId) => {
      // A snapshot on its way was taken before the dropped batches; the gate
      // will refuse it. Ask again rather than wait for it.
      if (awaitingSnapshot === agentId) stopAwaiting();
      requestNextSnapshot();
    },
  });
  // A batcher of its own, for the same reason the main window has one: a
  // store update per chunk is thirty a second per agent.
  const batcher = createOutputBatcher((batch) => {
    for (const [agentId, chunks] of batch) store().appendAgentTerminalChunks(agentId, chunks);
  });
  /** The agent whose snapshot is on its way; a snapshot is a whole screen, so one at a time. */
  let awaitingSnapshot: string | null = null;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  /** Agents whose request went unanswered, oldest first; asked again after everyone else. */
  const unanswered = new Set<string>();
  let welcomed = false;

  const stopAwaiting = (): void => {
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    snapshotTimer = null;
    awaitingSnapshot = null;
  };

  /**
   * The agent on show first, then the rest of the grid, then everyone else —
   * and behind all of them the agents that were asked for and never came.
   * One request that gets no answer must not be the end of every other
   * agent's screen, so each has `SNAPSHOT_TIMEOUT_MS` and then the next goes.
   */
  function requestNextSnapshot(): void {
    if (awaitingSnapshot !== null) return;
    const { agents, agentWindowActiveAgentId, terminalGridCells } = store();
    const onRoster = new Set(agents.map((a) => a.id));
    const wanted = (id: string) => onRoster.has(id) && !gate.isSynced(id);
    const inOrderOfNeed = [
      ...(agentWindowActiveAgentId ? [agentWindowActiveAgentId] : []),
      ...(terminalGridCells ?? []),
      ...agents.map((a) => a.id),
    ];
    const next =
      inOrderOfNeed.find((id) => wanted(id) && !unanswered.has(id)) ??
      Array.from(unanswered).find(wanted);
    if (next === undefined) return;
    awaitingSnapshot = next;
    snapshotTimer = setTimeout(() => {
      // To the back of the line, also when it had been there before.
      unanswered.delete(next);
      unanswered.add(next);
      stopAwaiting();
      requestNextSnapshot();
    }, SNAPSHOT_TIMEOUT_MS);
    void sendToHost(AGENT_WINDOW_CLIENT_EVENTS.snapshotRequest, { agentId: next });
  }

  const takeRoster = (roster: AgentWindowMessages['roster']): void => {
    const before = store().agents;
    store().applyAgentRoster(roster);
    const onRoster = new Set(roster.agents.map((a) => a.id));
    // The roster is what tells the gate whose batches are worth keeping.
    for (const id of onRoster) gate.expect(id);
    for (const { id } of before) {
      if (onRoster.has(id)) continue;
      gate.forget(id);
      unanswered.delete(id);
      // A seeded mirror may have no log entry to be swept with.
      disposeAgentMirror(id);
      if (awaitingSnapshot === id) stopAwaiting();
    }
  };

  const onWelcome = (welcome: AgentWindowMessages['welcome']): void => {
    takeRoster({ agents: welcome.agents, errorDigests: welcome.errorDigests });
    // The first welcome sets the layout. A later one comes from a main window
    // that restarted and has nothing to hand over; this window's layout is
    // then the only one there is, and stays — unless that welcome names one.
    const handsOver = welcome.activeAgentId !== null || welcome.gridCells !== null;
    if (!welcomed || handsOver) {
      const named = welcome.activeAgentId;
      const present = named !== null && welcome.agents.some((a) => a.id === named);
      store().setTerminalGridCells(welcome.gridCells);
      store().setAgentWindowActiveAgentId(present ? named : (welcome.agents[0]?.id ?? null));
    }
    welcomed = true;
    // A request the previous main window never answered is not coming back.
    stopAwaiting();
    requestNextSnapshot();
  };

  const onSnapshot = (snapshot: AgentWindowMessages['snapshot']): void => {
    const { agentId } = snapshot;
    if (awaitingSnapshot === agentId) stopAwaiting();
    unanswered.delete(agentId);
    const known = store().agents.some((a) => a.id === agentId);
    // Already synced: seeded before, or its run started while this window
    // was open. Its screen is complete; a second picture would wipe it.
    if (known && !gate.isSynced(agentId)) {
      // Null: the picture is older than batches the gate had to drop, and
      // the agent stays in line for a newer one.
      const news = gate.seed(agentId, snapshot.endOffset);
      if (news !== null) {
        // The picture first, then what came after it — in that order, so the
        // mirror counts none of those lines as part of the picture.
        seedAgentMirror(agentId, snapshot);
        store().appendAgentTerminalChunks(agentId, news);
      }
    }
    requestNextSnapshot();
  };

  let listening = 0;
  const sayHello = () => void sendToHost(AGENT_WINDOW_CLIENT_EVENTS.hello);
  const reportListening = () => {
    listening += 1;
    if (listening === LISTENERS_BEFORE_HELLO) sayHello();
  };

  const stops = [
    // Listening before hello, like the rest: a batch emitted between a
    // snapshot's offset and the moment this listener exists would be lost.
    onAgentOutput(
      (raw) =>
        acceptWindowMessage('agentOutput', raw, ({ agentId, line, endOffset }) => {
          for (const ready of gate.push(agentId, line, endOffset)) batcher.push(agentId, ready);
        }),
      reportListening
    ),
    onWindowMessage(
      AGENT_WINDOW_HOST_EVENTS.welcome,
      (raw) => acceptWindowMessage('welcome', raw, onWelcome),
      reportListening
    ),
    onWindowMessage(
      AGENT_WINDOW_HOST_EVENTS.roster,
      (raw) =>
        acceptWindowMessage('roster', raw, (roster) => {
          takeRoster(roster);
          requestNextSnapshot();
        }),
      reportListening
    ),
    onWindowMessage(
      AGENT_WINDOW_HOST_EVENTS.snapshot,
      (raw) => acceptWindowMessage('snapshot', raw, onSnapshot),
      reportListening
    ),
    onWindowMessage(
      AGENT_WINDOW_HOST_EVENTS.show,
      (raw) =>
        acceptWindowMessage('show', raw, ({ agentId }) =>
          store().setAgentWindowActiveAgentId(agentId)
        ),
      reportListening
    ),
    // The main window (re)started: it knows nothing of this window yet.
    onWindowMessage(AGENT_WINDOW_HOST_EVENTS.hostReady, sayHello, reportListening),
    installPtyResizeSync(),
  ];

  return () => {
    for (const stop of stops) stop();
    stopAwaiting();
    batcher.flush();
  };
}
