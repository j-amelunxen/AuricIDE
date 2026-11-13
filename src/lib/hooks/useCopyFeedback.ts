import { useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from '@/lib/tauri/clipboard';

/** How long a button says "Copied" after a successful copy. */
export const COPIED_FEEDBACK_MS = 2000;

/**
 * Copies text and reports it for a moment: `copied` is true for
 * COPIED_FEEDBACK_MS after a copy that landed, never after one that failed.
 */
export function useCopyFeedback() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    }
    return ok;
  }, []);

  return { copied, copy };
}
