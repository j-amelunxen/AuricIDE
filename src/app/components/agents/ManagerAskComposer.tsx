'use client';

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface ManagerAskComposerProps {
  name: string;
  /** A running manager gets the text as a message; a stopped one starts with it. */
  running: boolean;
  /** Why nothing can be sent right now; the field turns off and says so. */
  blockedReason?: string;
  /** Resolves true once the task went in; false keeps the text for another try. */
  onSend: (task: string) => Promise<boolean>;
}

/** Tall enough for a short paragraph; longer text scrolls inside the field. */
const MAX_HEIGHT_PX = 128;

/**
 * "Ask <name>…" at the foot of an unfolded manager: the less hidden door to
 * the same Ask the sheet offers. It grows with the text from one line. Enter
 * writes a new line and Cmd+Enter sends, as in the sheet, because a task is
 * prose. The field empties only once the task went in; a refused or failed
 * start (which says why in a toast) leaves the text for another try.
 */
export function ManagerAskComposer({
  name,
  running,
  blockedReason,
  onSend,
}: ManagerAskComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // State lands after a render; two presses in one tick would both pass it.
  const inFlight = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const hintId = `${id}-hint`;
  const task = text.trim();
  const blocked = blockedReason !== undefined;

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const send = async () => {
    if (blocked || inFlight.current || task === '') return;
    inFlight.current = true;
    setSending(true);
    try {
      // Text typed while the start ran is the human's next task, not this one.
      if (await onSend(task)) setText((current) => (current.trim() === task ? '' : current));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const sendOnModifiedEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  const hint =
    blockedReason ??
    (running
      ? 'Goes to the running session as a message. ⌘↵ sends.'
      : `Starts ${name} with this as its first task. ⌘↵ sends.`);

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 pt-2">
      <label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/70"
      >
        Ask {name}…
      </label>
      <div
        className={`flex items-end gap-1.5 rounded-lg border border-white/10 bg-black/30 py-1 pl-2 pr-1 transition-colors focus-within:border-primary/60 ${
          blocked ? 'opacity-60' : ''
        }`}
      >
        <textarea
          id={id}
          ref={field}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={sendOnModifiedEnter}
          aria-describedby={hintId}
          disabled={blocked}
          rows={1}
          spellCheck
          placeholder="Hand it a task"
          className="min-w-0 flex-1 resize-none bg-transparent py-0.5 text-xs leading-snug text-foreground outline-none placeholder:text-foreground-muted/50 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-disabled={blocked || sending || task === '' || undefined}
          title={
            blocked
              ? blockedReason
              : sending
                ? 'Sending…'
                : task === ''
                  ? `Write what ${name} should do.`
                  : 'Send (⌘↵)'
          }
          className={`flex shrink-0 items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white transition-[filter,opacity] hover:brightness-110 ${
            blocked || sending || task === '' ? 'cursor-not-allowed opacity-40' : ''
          }`}
        >
          <AuricIcon name="send" aria-hidden="true" className="text-[12px]" />
          Send
        </button>
      </div>
      <p id={hintId} className="text-[10px] leading-snug text-foreground-muted">
        {hint}
      </p>
    </form>
  );
}
