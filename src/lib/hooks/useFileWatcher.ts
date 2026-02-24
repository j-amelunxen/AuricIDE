import { useEffect } from 'react';
import { onFsChange, watchDirectory, unwatchDirectory, type FsChangeEvent } from '../tauri/watcher';

export function useFileWatcher(
  path: string | null,
  onChange: (event: FsChangeEvent) => void
): void {
  useEffect(() => {
    if (!path) return;

    watchDirectory(path);
    const unsubscribe = onFsChange(onChange);

    return () => {
      unsubscribe();
      unwatchDirectory(path);
    };
  }, [path, onChange]);
}
