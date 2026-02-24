async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export interface FsChangeEvent {
  path: string;
  kind: string;
}

export async function watchDirectory(path: string): Promise<void> {
  await invoke('watch_directory', { path });
}

export async function unwatchDirectory(path: string): Promise<void> {
  await invoke('unwatch_directory', { path });
}

export function onFsChange(callback: (event: FsChangeEvent) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  const setup = async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      if (disposed) return;

      const unsub = await listen<FsChangeEvent>('file-event', (event) => {
        callback(event.payload);
      });

      if (disposed) {
        unsub();
      } else {
        unlisten = unsub;
      }
    } catch (err) {
      console.error('Failed to setup FS change listener:', err);
    }
  };

  setup();

  return () => {
    disposed = true;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  };
}
