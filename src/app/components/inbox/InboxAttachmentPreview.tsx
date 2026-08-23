'use client';

import { useEffect, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { localFileSrc } from '@/lib/media/preview';
import type { InboxAttachmentKind } from '@/lib/tauri/inbox';

const KIND_ICON: Record<InboxAttachmentKind, string> = {
  image: 'image',
  video: 'movie',
  text: 'description',
};

export interface InboxAttachmentPreviewProps {
  fileName: string;
  kind: InboxAttachmentKind;
  storedPath: string;
  /** Opens the attachment's content. Absent while the item is still a draft. */
  onOpen?: () => void;
  onRemove?: () => void;
}

/**
 * The chip an attachment sits on: a thumbnail and a name, and — wherever the
 * item is already stored — a way into what is actually in the file.
 *
 * Opening and removing are two buttons side by side rather than one button
 * with another inside it: nesting them is invalid markup, and it would make
 * the remove target ambiguous for anything driving the chip by keyboard.
 */
export function InboxAttachmentPreview({
  fileName,
  kind,
  storedPath,
  onOpen,
  onRemove,
}: InboxAttachmentPreviewProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    // Only images are painted from the file. Resolving a src for a video or
    // a text document would be a webview URL nothing ever reads. The render
    // below gates on `kind` too, so a src left over from a previous kind
    // could not be painted anyway.
    if (kind !== 'image') return;
    let cancelled = false;
    void localFileSrc(storedPath).then((next) => {
      if (!cancelled) setSrc(next);
    });
    return () => {
      cancelled = true;
    };
  }, [storedPath, kind]);

  const face = (
    <>
      {kind === 'image' && src !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <AuricIcon name={KIND_ICON[kind]} className="text-[14px] text-foreground-muted" />
      )}
      <span className="max-w-[8rem] truncate text-[10px] text-foreground">{fileName}</span>
    </>
  );

  return (
    <div className="group relative flex items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-1.5 py-1">
      {onOpen === undefined ? (
        <span className="flex items-center gap-1.5">{face}</span>
      ) : (
        <button
          type="button"
          aria-label={`Open ${fileName}`}
          title={`Open ${fileName}`}
          onClick={onOpen}
          className="flex items-center gap-1.5 rounded transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {face}
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${fileName}`}
          onClick={onRemove}
          className="rounded p-0.5 text-foreground-muted hover:bg-red-500/10 hover:text-red-400"
        >
          <AuricIcon name="close" className="text-[12px]" />
        </button>
      )}
    </div>
  );
}
