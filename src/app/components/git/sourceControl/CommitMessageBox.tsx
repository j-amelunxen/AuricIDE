import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';

/**
 * The commit message field of one repo. It takes focus when a review approves
 * this repo (`requestCommitFocus`); a request made before it mounted is picked
 * up on mount, then cleared so the next visit to the panel does not steal focus.
 */
export function CommitMessageBox({
  repoPath,
  value,
  onChange,
}: {
  repoPath: string;
  value: string;
  onChange: (msg: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const focusRequest = useStore((s) => s.commitFocusRequest);

  useEffect(() => {
    if (!focusRequest || focusRequest.repoPath !== repoPath || !ref.current) return;
    ref.current.focus();
    useStore.getState().clearCommitFocusRequest(focusRequest.nonce);
  }, [focusRequest, repoPath]);

  return (
    <textarea
      ref={ref}
      aria-label="Commit message"
      placeholder="Commit message"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded border border-border-dark bg-editor-bg px-3 py-2 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
      rows={3}
    />
  );
}
