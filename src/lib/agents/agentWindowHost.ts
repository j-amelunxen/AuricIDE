import { agentOutputOffset, flushAgentOutput } from '@/lib/hooks/useAgentEvents';
import { useStore } from '@/lib/store';
import {
  acceptWindowMessage,
  focusAgentWindow,
  onAgentWindowState,
  onWindowMessage,
  sendToWindow,
} from '@/lib/tauri/agentWindow';
import { installPtyResizeSync } from '@/lib/tauri/terminal';
import { agentMirrorSize, snapshotAgentScreen } from '@/lib/terminal/agentMirror';
import {
  AGENT_WINDOW_CLIENT_EVENTS,
  AGENT_WINDOW_HOST_EVENTS,
  AGENT_WINDOW_LABELS,
  ROSTER_THROTTLE_MS,
  type AgentWindowAction,
  type AgentWindowMessages,
} from './agentWindow.contract';
import { deriveErrorDigest } from './errorDigest';
import type { GridCells } from './terminalGrid';

/**
 * The main window's side of the detached agent window
 * (`docs/design-agent-window.md`).
 *
 * The main window stays the one place that knows the fleet: every agent's
 * status and attention state, and the only copy of the raw output a screen
 * can be rebuilt from. The agent window is a view of that. This module is
 * what it asks: the roster of agents, one agent's screen so far, and — for
 * everything that touches tickets, goals, worktrees or the project folder —
 * to please do it here.
 */

/**
 * What the agent window may ask the main window to do. Supplied by the UI;
 * the host only routes. Each is the same store action or dialog the main
 * window's own buttons lead to.
 */
export interface AgentWindowHostHandlers {
  onKill: (agentId: string) => void | Promise<void>;
  onDismiss: (agentId: string) => void | Promise<void>;
  onSaveScratch: (agentName: string, screen: string) => void | Promise<void>;
  /** The window docks back; this is the layout it had. */
  onDock: (activeAgentId: string | null, gridCells: GridCells | null) => void | Promise<void>;
}

/** The layout the terminal modal had when it was popped out. */
export interface AgentWindowHandover {
  activeAgentId: string | null;
  gridCells: GridCells | null;
}

const NOTHING_TO_HAND_OVER: AgentWindowHandover = { activeAgentId: null, gridCells: null };

let handover = NOTHING_TO_HAND_OVER;

/**
 * Leave the layout for the agent window to pick up. Called by the pop-out
 * button just before the window opens; the next `welcome` carries it and
 * uses it up, so a window that says hello again later is not thrown back to
 * a layout from before.
 */
export function setAgentWindowHandover(next: AgentWindowHandover): void {
  handover = next;
}

function send(event: string, payload?: unknown): Promise<void> {
  return sendToWindow(AGENT_WINDOW_LABELS.agents, event, payload).catch((error: unknown) => {
    console.warn(`[agent-window] could not send ${event}: ${String(error)}`);
  });
}

/**
 * The agents as the main window has them, plus why each failed one died. The
 * digest is derived here because it is read off the log's tail, and the agent
 * window's log starts when that window opened.
 */
function currentRoster(): AgentWindowMessages['roster'] {
  const { agents, agentLogs } = useStore.getState();
  const errorDigests: Record<string, string> = {};
  for (const agent of agents) {
    if (agent.status !== 'error') continue;
    const digest = deriveErrorDigest(agentLogs[agent.id] ?? []);
    if (digest) errorDigests[agent.id] = digest;
  }
  return { agents, errorDigests };
}

/**
 * One agent's screen, with the offset it reaches.
 *
 * The flush comes first: output the batcher still holds for the next frame is
 * already counted in the offset but not yet in the mirror, and a snapshot
 * taken across that gap would name an offset its screen does not reach — the
 * agent window would then drop the missing batch as "already in the picture".
 * Offset and screen are both taken in this tick, before anything else can
 * arrive; only the serialized text is waited for.
 */
async function answerSnapshotRequest(agentId: string): Promise<void> {
  const failed = (step: string) => (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-window] snapshot of ${agentId}: ${step} failed: ${reason}`);
  };
  try {
    flushAgentOutput();
  } catch (error) {
    failed('flushing output')(error);
  }
  const endOffset = agentOutputOffset(agentId);
  // A request is always answered. The agent window asks for one screen at a
  // time, and a blank screen with a live stream on top beats a window that
  // waits for a picture that is not coming.
  let data = '';
  try {
    // Null for an agent that never printed: an empty screen is its true one.
    data = (await snapshotAgentScreen(agentId))?.data ?? '';
  } catch (error) {
    failed('serializing the screen')(error);
  }
  const { rows, cols } = agentMirrorSize(agentId);
  const snapshot: AgentWindowMessages['snapshot'] = {
    agentId,
    data,
    rows,
    cols,
    endOffset,
  };
  await send(AGENT_WINDOW_HOST_EVENTS.snapshot, snapshot);
}

function carryOut(action: AgentWindowAction, handlers: AgentWindowHostHandlers): void {
  const failed = (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-window] ${action.kind} failed: ${reason}`);
  };
  const run = (): void | Promise<void> => {
    switch (action.kind) {
      case 'kill':
        return handlers.onKill(action.agentId);
      case 'dismiss':
        return handlers.onDismiss(action.agentId);
      case 'save-scratch':
        return handlers.onSaveScratch(action.agentName, action.screen);
      case 'dock':
        return handlers.onDock(action.activeAgentId, action.gridCells);
    }
  };
  try {
    void Promise.resolve(run()).catch(failed);
  } catch (error) {
    failed(error);
  }
}

/**
 * Publishes the roster when the agents change, at most once per
 * `ROSTER_THROTTLE_MS` and always the latest: `agents` is replaced on every
 * activity bump of every agent, and each roster is the whole list.
 */
function publishRoster(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.agents === prev.agents || timer !== null || !state.agentWindowOpen) return;
    timer = setTimeout(() => {
      timer = null;
      if (useStore.getState().agentWindowOpen) {
        void send(AGENT_WINDOW_HOST_EVENTS.roster, currentRoster());
      }
    }, ROSTER_THROTTLE_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
  };
}

/**
 * Follows PTY geometry across windows for exactly as long as there is a
 * second one. Someone who never detaches the terminals runs the resize path
 * they always ran, with nothing listening and nothing held back.
 */
function syncPtyGeometryWhileOpen(): () => void {
  let uninstall: (() => void) | null = null;
  const follow = (open: boolean) => {
    if (open && !uninstall) {
      uninstall = installPtyResizeSync();
    } else if (!open && uninstall) {
      uninstall();
      uninstall = null;
    }
  };
  follow(useStore.getState().agentWindowOpen);
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.agentWindowOpen !== prev.agentWindowOpen) follow(state.agentWindowOpen);
  });
  return () => {
    unsubscribe();
    follow(false);
  };
}

/**
 * Serves the agent window for as long as the IDE is mounted. Main window
 * only.
 *
 * `host-ready` goes out once the three listeners that answer the agent window
 * are in place — a `hello` emitted before anyone listens is lost, so a window
 * that was already open (the main window reloaded) is told when to try again.
 */
export function installAgentWindowHost(handlers: AgentWindowHostHandlers): () => void {
  let listening = 0;
  const reportReady = () => {
    listening += 1;
    if (listening === 3) void send(AGENT_WINDOW_HOST_EVENTS.hostReady);
  };

  const stops = [
    onAgentWindowState((raw) =>
      acceptWindowMessage('windowState', raw, ({ open }) =>
        useStore.getState().setAgentWindowOpen(open)
      )
    ),
    onWindowMessage(
      AGENT_WINDOW_CLIENT_EVENTS.hello,
      () => {
        // Whoever says hello is there, whatever was last heard from Rust.
        useStore.getState().setAgentWindowOpen(true);
        const welcome: AgentWindowMessages['welcome'] = { ...currentRoster(), ...handover };
        handover = NOTHING_TO_HAND_OVER;
        void send(AGENT_WINDOW_HOST_EVENTS.welcome, welcome);
      },
      reportReady
    ),
    onWindowMessage(
      AGENT_WINDOW_CLIENT_EVENTS.snapshotRequest,
      (raw) =>
        acceptWindowMessage('snapshotRequest', raw, ({ agentId }) => {
          void answerSnapshotRequest(agentId);
        }),
      reportReady
    ),
    onWindowMessage(
      AGENT_WINDOW_CLIENT_EVENTS.action,
      (raw) => acceptWindowMessage('action', raw, (action) => carryOut(action, handlers)),
      reportReady
    ),
    publishRoster(),
    syncPtyGeometryWhileOpen(),
  ];

  return () => {
    for (const stop of stops) stop();
  };
}

/**
 * Bring an agent up in the agent window and the window to the front — what
 * selecting an agent in the main window means while the terminals are
 * detached. The roster goes first: an agent started a moment ago may not have
 * been published yet, and the window cannot show one it has not heard of.
 *
 * Resolves `false` when there is no window to bring forward — it went away
 * without this side hearing of it. `agentWindowOpen` is corrected on the
 * spot, so the caller can fall back to the terminal modal, which stays shut
 * for as long as that flag is set.
 */
export async function showAgentInWindow(agentId: string): Promise<boolean> {
  await send(AGENT_WINDOW_HOST_EVENTS.roster, currentRoster());
  await send(AGENT_WINDOW_HOST_EVENTS.show, { agentId });
  try {
    await focusAgentWindow();
    return true;
  } catch {
    useStore.getState().setAgentWindowOpen(false);
    return false;
  }
}
