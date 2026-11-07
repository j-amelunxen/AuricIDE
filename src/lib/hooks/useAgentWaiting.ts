import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { agentWaitingList, onAgentWaitingChanged } from '@/lib/tauri/agentWaiting';

/**
 * Keeps the agents' "waiting on purpose" marks in step with Rust, the only
 * source (`agent-waiting.json`). Reads once when listening starts, then again
 * on every change event; browser mode and an unreadable file mean no marks.
 */
export function useAgentWaiting(): void {
  useEffect(() => {
    let latest = 0;
    const reload = async () => {
      latest += 1;
      const read = latest;
      let marks: Awaited<ReturnType<typeof agentWaitingList>> = [];
      try {
        const listed = await agentWaitingList();
        if (Array.isArray(listed)) marks = listed;
      } catch {
        // No marks is the answer here; the next change event reads again.
      }
      // Two reads can cross; an older answer must not replace a newer one.
      if (read === latest) useStore.getState().applyAgentWaiting(marks);
    };
    void reload();
    const unsubscribe = onAgentWaitingChanged(
      () => void reload(),
      () => void reload()
    );
    return () => {
      latest += 1;
      unsubscribe();
    };
  }, []);
}
