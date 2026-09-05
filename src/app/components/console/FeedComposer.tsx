'use client';

import { useId, useRef, useState } from 'react';
import type { Lane } from '@/lib/agents/lanes';

export interface FeedComposerProps {
  /** The lane the composer targets, or `null` when nothing is selected. */
  lane: Lane | null;
  /** Fires with the trimmed text — the caller appends `\n` and sends it. */
  onSend: (text: string) => void;
}

/** Why the composer can't send right now, or `null` when it can. */
function disabledReason(lane: Lane | null): string | null {
  if (lane === null) return 'Select a lane to message one agent';
  if (!lane.running) return `${lane.agentName} has stopped`;
  return null;
}

/** Matches the field's own `leading-5` and `py-1` — the two pieces
 * `scrollHeight` already bakes in, so this is only the row count's cap. */
const LINE_HEIGHT_PX = 20;
const VERTICAL_PADDING_PX = 8;
const MAX_ROWS = 5;
const MAX_HEIGHT_PX = LINE_HEIGHT_PX * MAX_ROWS + VERTICAL_PADDING_PX;

/** Grows the field to fit what's typed — Shift+Enter inserts real newlines,
 * so a fixed one-line box would hide everything past the first. Capped at
 * five rows: past that the field should scroll, not swallow the feed. */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

/**
 * The feed's wire to one agent's stdin. A lane has to be selected before this
 * can send anything — a composer with no addressee would otherwise have to
 * guess who "you" just typed to.
 */
export function FeedComposer({ lane, onSend }: FeedComposerProps) {
  const [text, setText] = useState('');
  const reason = disabledReason(lane);
  const disabled = reason !== null;
  const reasonId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    // The field earned its height from what was in it; nothing is now.
    if (textareaRef.current) textareaRef.current.style.height = '';
  };

  return (
    <div className="flex flex-shrink-0 items-end gap-2 border-t border-white/10 px-2 py-1">
      <textarea
        ref={textareaRef}
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          send();
        }}
        disabled={disabled}
        aria-label={lane ? `Message ${lane.agentName}` : 'Message an agent'}
        aria-describedby={reason ? reasonId : undefined}
        // The disabled reason lives here, not in a separate line above the
        // field — the composer is one compact row, and this is the one spot
        // a reader's eye is already on.
        placeholder={reason ?? (lane ? `Message ${lane.agentName}…` : 'Message an agent…')}
        className="h-7 min-w-0 flex-1 resize-none rounded border border-white/10 bg-black/40 px-2 py-1 text-[12px] leading-5 text-foreground placeholder:text-foreground-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
      />
      {reason && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
      <button
        type="button"
        onClick={send}
        disabled={disabled}
        className="h-7 flex-shrink-0 rounded border border-primary/40 bg-white/5 px-2.5 text-[11px] text-primary-light transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
