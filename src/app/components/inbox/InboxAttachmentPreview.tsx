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
  onRemove?: () => void;
}

export function InboxAttachmentPreview({
  fileName,
  kind,
  storedPath,
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

  return (
    <div className="group relative flex items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-1.5 py-1">
      {kind === 'image' && src !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <AuricIcon name={KIND_ICON[kind]} className="text-[14px] text-foreground-muted" />
      )}
      <span className="max-w-[8rem] truncate text-[10px] text-foreground">{fileName}</span>
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
