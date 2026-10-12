import {
  AGENT_WINDOW_COMMANDS,
  AGENT_WINDOW_RUST_EVENTS,
  AgentWindowContractError,
  parseWindowMessage,
  type AgentWindowMessageKind,
  type AgentWindowMessages,
} from '../agents/agentWindow.contract';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

/**
 * IPC for the detached agent window (`docs/design-agent-window.md`): the three
 * commands Rust offers, its open/closed broadcast, and the two primitives the
 * windows talk to each other with. Names come from the contract. Listening
 * hands payloads over as they came; whoever receives one puts it through
 * `acceptWindowMessage` before acting on it.
 */

/** Creates the agent window, or shows and focuses the one that exists. */
export async function openAgentWindow(): Promise<void> {
  await invoke(AGENT_WINDOW_COMMANDS.open);
}

export async function focusAgentWindow(): Promise<void> {
  await invoke(AGENT_WINDOW_COMMANDS.focus);
}

export async function focusMainWindow(): Promise<void> {
  await invoke(AGENT_WINDOW_COMMANDS.focusMain);
}

export function onAgentWindowState(
  callback: (state: AgentWindowMessages['windowState']) => void
): () => void {
  return subscribeToTauriEvent(
    AGENT_WINDOW_RUST_EVENTS.windowState,
    callback,
    '[Browser mode] Agent window state not available'
  );
}

/**
 * Send one message to one window. Addressed rather than broadcast: a snapshot
 * is a whole screen, and the window that sent it has no use for its echo.
 */
export async function sendToWindow(label: string, event: string, payload?: unknown): Promise<void> {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo(label, event, payload);
}

/**
 * Listen for a message another window sends here. `onListening` fires once
 * the listener is registered — a window announces itself only after that,
 * because a message emitted before anyone listens is lost.
 */
export function onWindowMessage(
  event: string,
  callback: (payload: unknown) => void,
  onListening?: () => void
): () => void {
  return subscribeToTauriEvent(
    event,
    callback,
    `[Browser mode] Window message ${event} not available`,
    onListening
  );
}

/**
 * Validate a payload from another window or from Rust and act on it — or, if
 * it breaks the contract, say which message and field did and act on nothing.
 * One place for that, so no receiver gets to be the lenient one.
 */
export function acceptWindowMessage<K extends AgentWindowMessageKind>(
  kind: K,
  raw: unknown,
  handle: (message: AgentWindowMessages[K]) => void
): void {
  let message: AgentWindowMessages[K];
  try {
    message = parseWindowMessage(kind, raw);
  } catch (error) {
    if (!(error instanceof AgentWindowContractError)) throw error;
    console.warn(`[agent-window] dropped a message: ${error.message}`);
    return;
  }
  handle(message);
}
