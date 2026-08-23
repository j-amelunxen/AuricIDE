'use client';

import { useRef, useState } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { fileNameForPastedText } from '@/lib/inbox/inboxText';

export interface InboxTextSheetProps {
  /** Text the capture bar already caught from a paste. */
  initialBody?: string;
  /** Called with the file name and the verbatim text. */
  onAttach: (fileName: string, body: string) => void;
  onClose: () => void;
}

/**
 * Where a whole email — or a spec, or a chat thread — is pasted so it can hang
 * off an inbox item as context.
 *
 * The capture bar stays one line: a document does not belong in a field you
 * cannot scroll. The name is derived from the text (a mail's `Subject:`, else
 * its first line) and stops following it the moment the user types their own,
 * because a name someone chose must not be overwritten by the next paste.
 */
export function InboxTextSheet({ initialBody = '', onAttach, onClose }: InboxTextSheetProps) {
  const [body, setBody] = useState(initialBody);
  const [name, setName] = useState(() =>
    initialBody.trim() === '' ? '' : fileNameForPastedText(initialBody)
  );
  const nameIsOwn = useRef(false);
  const dialogRef = useDialogA11y<HTMLFormElement>();

  useOverlayLayer({ id: 'inbox-text', kind: 'tool', active: true, onEscape: onClose });

  const submit = () => {
    if (body.trim() === '') return;
    onAttach(name.trim() === '' ? fileNameForPastedText(body) : name.trim(), body);
  };

  return (
    <div className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-text-title"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-[560px] max-w-[92vw] rounded-xl border border-border-dark bg-background-secondary p-6 shadow-2xl"
      >
        <h3 id="inbox-text-title" className="mb-1 text-sm font-semibold text-foreground">
          Attach text
        </h3>
        <p className="mb-4 text-[11px] text-foreground-muted">
          Paste a whole email or note. It is stored as a file and travels into the project with the
          item, so an agent reads it as context.
        </p>

        <label
          htmlFor="inbox-text-body"
          className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-foreground-muted"
        >
          Text
        </label>
        <textarea
          id="inbox-text-body"
          value={body}
          autoFocus
          onChange={(e) => {
            setBody(e.target.value);
            if (!nameIsOwn.current) {
              setName(e.target.value.trim() === '' ? '' : fileNameForPastedText(e.target.value));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Paste the mail here…"
          rows={12}
          className="mb-4 w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground transition-colors focus:border-primary/50 focus:outline-none"
        />

        <label
          htmlFor="inbox-text-name"
          className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-foreground-muted"
        >
          File name
        </label>
        <input
          id="inbox-text-name"
          type="text"
          value={name}
          onChange={(e) => {
            nameIsOwn.current = true;
            setName(e.target.value);
          }}
          placeholder="note.md"
          className="mb-6 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary/50 focus:outline-none"
        />

        <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted transition-colors hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={body.trim() === ''}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-background transition-opacity disabled:opacity-40"
          >
            Attach
          </button>
        </div>
      </form>
    </div>
  );
}
