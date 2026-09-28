import { invoke } from './invoke';

export interface FsChangeEvent {
  path: string;
  kind: string;
  /**
   * Whether the path existed when the watcher sent its batch. Absent means
   * unknown, and callers must then assume the worst.
   */
  exists?: boolean;
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

      // Rust collects a burst of changes into one batch rather than one IPC
      // message per path; the callback still sees them one at a time.
      const unsub = await listen<FsChangeEvent[]>('file-events', (event) => {
        for (const change of event.payload) callback(change);
      });

      if (disposed) {
        try {
          unsub();
        } catch {
          // Listener may already have been unregistered by Tauri
        }
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
      try {
        unlisten();
      } catch {
        // Listener may already have been unregistered by Tauri
      }
      unlisten = null;
    }
  };
}
