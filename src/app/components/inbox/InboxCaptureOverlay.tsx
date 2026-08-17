'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { KbdHint } from './KbdHint';
import { trimmedCaptureTitle } from '@/lib/inbox/captureInput';
import type { InboxItem } from '@/lib/tauri/inbox';

/**
 * The Spotlight-style quick-capture: reachable from anywhere (⌘⇧I), so it has
 * to answer to "I just thought of something" without asking which project —
 * that decision is Assign's job, later, on the inbox panel. Plain Enter closes
 * once the task is down; Shift+Enter is for capturing several in a row.
 */
export function InboxCaptureOverlay() {
  const isOpen = useStore((s) => s.inboxCaptureOpen);
  const setInboxCaptureOpen = useStore((s) => s.setInboxCaptureOpen);
  const addInboxItem = useStore((s) => s.addInboxItem);

  if (!isOpen) return null;
  return (
    <InboxCaptureOverlayDialog
      onClose={() => setInboxCaptureOpen(false)}
      addInboxItem={addInboxItem}
    />
  );
}

function InboxCaptureOverlayDialog({
  onClose,
  addInboxItem,
}: {
  onClose: () => void;
  addInboxItem: (title: string, notes?: string) => Promise<InboxItem | null>;
}) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'inbox-capture-overlay', kind: 'tool', active: true, onEscape: onClose });

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  const submit = async (keepOpen: boolean) => {
    const trimmed = trimmedCaptureTitle(title);
    if (trimmed === null) return;
    const item = await addInboxItem(trimmed);
    if (item === null) {
      // Keep what was typed and say why — closing (or clearing, on the
      // keep-open path) would lose the one thing the user came here to keep.
      setError(useStore.getState().inboxError);
      return;
    }
    setError(null);
    setTitle('');
    if (keepOpen) {
      inputRef.current?.focus();
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-start justify-center pt-[18vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Capture to Inbox"
        className="glass-card w-full max-w-lg overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4">
          <AuricIcon name="inbox" className="text-foreground-muted" />
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit(e.shiftKey);
              }
            }}
            placeholder="Capture a task… ⏎"
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-foreground-muted"
          />
        </div>
        {error !== null && (
          <p role="alert" className="px-4 pb-2 text-[10px] text-[#ff4a4a]/80">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between px-4 py-2 bg-black/20 border-t border-white/5 text-[9px] text-foreground-muted uppercase tracking-tighter">
          <KbdHint keys="⏎" label="Add and close" />
          <KbdHint keys="⇧⏎" label="Add and keep capturing" />
        </div>
      </div>
    </div>
  );
}
