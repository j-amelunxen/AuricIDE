import { invoke } from './invoke';
import { onAgentPtyResized } from './agentEvents';
import { acceptWindowMessage } from './agentWindow';
import { resizeAgentMirror } from '../terminal/agentMirror';

const AGENT_SESSION_PREFIX = 'agent-';

interface PtySize {
  rows: number;
  cols: number;
}

/**
 * The newest size known for each agent PTY: whichever came last, the one Rust
 * reported (`agent-pty-resized`) or the one this window sent. Only kept while
 * `installPtyResizeSync` is installed.
 */
const knownPtySizes = new Map<string, PtySize>();
let ptyResizeSyncInstalled = false;

export async function spawnShell(
  id: string,
  command: string,
  args: string[] = [],
  cwd?: string,
  rows?: number,
  cols?: number
): Promise<void> {
  await invoke('shell_spawn', { id, command, args, cwd, rows, cols });
}

export async function resizeShell(id: string, rows: number, cols: number): Promise<void> {
  // Agent PTYs have a headless mirror that must stay in lockstep with the
  // PTY size, or its screen snapshot would be laid out for the wrong width.
  if (id.startsWith(AGENT_SESSION_PREFIX)) {
    const agentId = id.slice(AGENT_SESSION_PREFIX.length);
    resizeAgentMirror(agentId, rows, cols);
    if (ptyResizeSyncInstalled) {
      await resizeSharedAgentPty(id, agentId, { rows, cols });
      return;
    }
  }
  await invoke('shell_resize', { id, rows, cols });
}

/**
 * An agent PTY that a second window may be fitting too.
 *
 * A view that adopts a size the other window fitted resizes its terminal, and
 * the terminal's resize event lands here. The PTY already has that size, and
 * sending it back would have two windows answering each other — so a size
 * equal to the newest one known is not sent. "Newest known" has to include
 * what this window sent itself: after a report of 30×100 and a send of 40×120
 * still on its way, a fit back to 30×100 is a real change, and judging it by
 * the report alone would leave the PTY at 40×120.
 */
async function resizeSharedAgentPty(id: string, agentId: string, size: PtySize): Promise<void> {
  const known = knownPtySizes.get(agentId);
  if (known && known.rows === size.rows && known.cols === size.cols) return;
  knownPtySizes.set(agentId, size);
  try {
    await invoke('shell_resize', { id, ...size });
  } catch (error) {
    // Never arrived, so it is not a size the PTY has; the next fit tries again.
    if (knownPtySizes.get(agentId) === size) knownPtySizes.delete(agentId);
    throw error;
  }
}

/**
 * Follow PTY geometry across windows (`docs/design-agent-window.md`, rule 7).
 *
 * Until there was a second window, a view that fitted a PTY told the other
 * views through the mirror's in-process listeners. A view in another window
 * shares no process, so Rust reports every real size change to all windows
 * and each feeds it into `resizeAgentMirror` — which is also what tells the
 * views there to adopt it. Nothing on this path calls `shell_resize`.
 *
 * Installed once per window and only while there are two: by the agent
 * window's client, and by its host for as long as that window is open. With
 * one window `resizeShell` sends every fit, as it always did.
 */
export function installPtyResizeSync(): () => void {
  const stop = onAgentPtyResized((raw) =>
    acceptWindowMessage('ptyResized', raw, ({ agentId, rows, cols }) => {
      knownPtySizes.set(agentId, { rows, cols });
      resizeAgentMirror(agentId, rows, cols);
    })
  );
  ptyResizeSyncInstalled = true;
  return () => {
    stop();
    ptyResizeSyncInstalled = false;
    knownPtySizes.clear();
  };
}

export async function writeToShell(id: string, data: string): Promise<void> {
  await invoke('shell_write', { id, data });
}

export async function onTerminalOut(
  id: string,
  callback: (line: string) => void
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>(`terminal-out-${id}`, (event) => {
    callback(event.payload);
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      unlisten();
    } catch {
      // Listener may already have been unregistered by Tauri
    }
  };
}

export async function onTerminalErr(
  id: string,
  callback: (line: string) => void
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>(`terminal-err-${id}`, (event) => {
    callback(event.payload);
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      unlisten();
    } catch {
      // Listener may already have been unregistered by Tauri
    }
  };
}
