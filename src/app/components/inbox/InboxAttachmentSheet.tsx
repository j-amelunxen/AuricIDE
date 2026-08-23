'use client';

import { useEffect, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { localFileSrc } from '@/lib/media/preview';
import { readFile } from '@/lib/tauri/fs';
import type { InboxAttachment } from '@/lib/tauri/inbox';

export interface InboxAttachmentSheetProps {
  attachment: InboxAttachment;
  onClose: () => void;
}

/**
 * One attachment per mounted sheet — the caller keys it by attachment id, so
 * the read below runs on mount and never has to reset itself mid-life.
 */
type TextState = { stage: 'loading' } | { stage: 'ready'; body: string } | { stage: 'failed' };

/**
 * What is actually in an attachment.
 *
 * An inbox item's context is only context if it can be read without leaving
 * the inbox — a mail hanging off a captured task is worth nothing while its
 * name is all you get. So the chip opens right here rather than in an editor
 * tab: the inbox also lives on the start screen, where there is no project to
 * open a tab in, and one behaviour in both places is the point.
 *
 * A text is read verbatim into a `<pre>` rather than rendered as Markdown —
 * this is a stored mail or spec, and how it was pasted is part of what it
 * says. A read that fails says one sentence; the path and the underlying
 * error stay out of it.
 */
export function InboxAttachmentSheet({ attachment, onClose }: InboxAttachmentSheetProps) {
  const { kind, fileName, storedPath } = attachment;
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const [text, setText] = useState<TextState>({ stage: 'loading' });
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);

  useOverlayLayer({
    id: `inbox-attachment-${attachment.id}`,
    kind: 'tool',
    active: true,
    onEscape: onClose,
  });

  useEffect(() => {
    if (kind !== 'text') return;
    let cancelled = false;
    readFile(storedPath)
      .then((body) => {
        if (!cancelled) setText({ stage: 'ready', body });
      })
      .catch(() => {
        if (!cancelled) setText({ stage: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, storedPath]);

  useEffect(() => {
    if (kind === 'text') return;
    let cancelled = false;
    void localFileSrc(storedPath).then((src) => {
      if (!cancelled) setMediaSrc(src);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, storedPath]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-attachment-title"
        onClick={(e) => e.stopPropagation()}
        // `text-left` is not decoration: on the start screen this sheet is
        // mounted inside the centred splash column and would inherit its
        // alignment, so the same dialog would read differently in the two
        // places the inbox lives.
        className="flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border-dark bg-background-secondary text-left shadow-2xl"
      >
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
          <h3
            id="inbox-attachment-title"
            className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
          >
            {fileName}
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="close" className="text-[15px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {kind === 'text' && text.stage === 'loading' && (
            <p className="text-[11px] text-foreground-muted">Reading…</p>
          )}
          {kind === 'text' && text.stage === 'failed' && (
            <p role="alert" className="text-[11px] text-[#ff4a4a]/80">
              This attachment couldn&apos;t be read. The stored file may have been moved or removed.
            </p>
          )}
          {kind === 'text' && text.stage === 'ready' && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground">
              {text.body}
            </pre>
          )}

          {kind === 'image' && mediaSrc !== null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaSrc} alt={fileName} className="mx-auto max-h-[70vh] object-contain" />
          )}

          {kind === 'video' && mediaSrc !== null && (
            <video src={mediaSrc} controls className="mx-auto max-h-[70vh] w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
