'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ModalShell } from '@/app/components/ui/ModalShell';

interface AskManagerSheetProps {
  name: string;
  /** A running manager gets the text as a message; a stopped one starts with it. Read live by the caller. */
  running: boolean;
  /** Where focus goes on close, for a sheet opened from a menu that is gone by then. */
  returnFocusTo?: () => HTMLElement | null;
  onSend: (task: string) => void;
  onClose: () => void;
}

const HINT_ID = 'ask-manager-hint';
const REASON_ID = 'ask-manager-reason';

/**
 * One field to hand a Project Manager work. Enter writes a new line, because a
 * task is prose; Cmd+Enter sends. The line under the field says which of the
 * two things will happen, and the button is named for it ("Send" or "Start").
 * A click outside never closes the sheet: it holds text that is not saved anywhere.
 */
export function AskManagerSheet({
  name,
  running,
  returnFocusTo,
  onSend,
  onClose,
}: AskManagerSheetProps) {
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const task = text.trim();
  const blocked = task === '';
  const reason = `Write what ${name} should do.`;
  // The reason appears once there is something to correct, not on a fresh sheet.
  const showReason = blocked && (tried || text !== '');
  const verb = running ? 'Send' : 'Start';

  const send = () => {
    if (blocked) {
      setTried(true);
      field.current?.focus();
      return;
    }
    onSend(task);
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const sendOnModifiedEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

  return (
    <ModalShell
      id="ask-manager-sheet"
      title={`Ask ${name}`}
      onClose={onClose}
      closeOnBackdropClick={false}
      returnFocusTo={returnFocusTo}
      className="w-[28rem] max-w-[calc(100vw-2rem)]"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ask-manager-task" className="text-xs font-medium text-foreground-muted">
            Task
          </label>
          <textarea
            id="ask-manager-task"
            ref={field}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={sendOnModifiedEnter}
            aria-describedby={showReason ? `${HINT_ID} ${REASON_ID}` : HINT_ID}
            rows={5}
            autoFocus
            spellCheck
            className="resize-y rounded-md border border-border-dark bg-black/20 px-2.5 py-1.5 text-sm text-foreground placeholder:text-foreground-muted/50 focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          />
          <p id={HINT_ID} aria-live="polite" className="text-[11px] text-foreground-muted">
            {running
              ? `${name} is running; this goes in as a message.`
              : `${name} starts and works on this first.`}
          </p>
          {showReason && (
            <p id={REASON_ID} className="text-[11px] text-foreground-muted">
              {reason}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            aria-disabled={blocked || undefined}
            aria-describedby={showReason ? REASON_ID : undefined}
            title={blocked ? reason : `${verb} (⌘↵)`}
            className={`rounded bg-primary px-3 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-110 ${
              blocked ? 'cursor-not-allowed opacity-40' : ''
            }`}
          >
            {verb}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
