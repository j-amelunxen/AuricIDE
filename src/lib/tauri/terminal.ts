import { invoke } from './invoke';

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
    unlisten();
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
    unlisten();
  };
}
