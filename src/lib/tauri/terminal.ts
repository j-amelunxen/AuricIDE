import { invoke } from './invoke';
import { resizeAgentMirror } from '../terminal/agentMirror';

const AGENT_SESSION_PREFIX = 'agent-';

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
    resizeAgentMirror(id.slice(AGENT_SESSION_PREFIX.length), rows, cols);
  }
  await invoke('shell_resize', { id, rows, cols });
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
