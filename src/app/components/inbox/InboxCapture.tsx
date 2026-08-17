'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { KbdHint } from './KbdHint';
import { trimmedCaptureTitle } from '@/lib/inbox/captureInput';
import type { InboxItem } from '@/lib/tauri/inbox';

export interface InboxCaptureProps {
  /** Focuses the field the moment it mounts — the start screen wants this. */
  autoFocus?: boolean;
  /** Runs after a successful capture, with the item the backend created. */
  onCaptured?: (item: InboxItem) => void;
  className?: string;
}

/**
 * The one-line capture bar: dropping a task in here has to be as effortless
 * as dropping an event into a calendar. It never asks which project — that
 * decision waits for Assign — so the only thing this component owns is the
 * text and the moment it becomes an item.
 */
export function InboxCapture({ autoFocus, onCaptured, className = '' }: InboxCaptureProps) {
  const addInboxItem = useStore((s) => s.addInboxItem);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = trimmedCaptureTitle(title);
    if (trimmed === null) return;
    const item = await addInboxItem(trimmed);
    if (item === null) {
      // Keep what was typed — losing it on a failure is worse than the
      // failure itself — and say why, right where the attempt was made.
      setError(useStore.getState().inboxError);
      return;
    }
    setError(null);
    setTitle('');
    inputRef.current?.focus();
    onCaptured?.(item);
  };

  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
        <AuricIcon name="inbox" className="text-[16px] text-foreground-muted" />
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              inputRef.current?.blur();
            }
          }}
          placeholder="Capture a task… ⏎"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted"
        />
        <span className="shrink-0 text-[9px] text-foreground-muted/60">
          <KbdHint keys="⏎" label="Add" />
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 px-1 text-[10px] text-[#ff4a4a]/80">
          {error}
        </p>
      )}
    </div>
  );
}
