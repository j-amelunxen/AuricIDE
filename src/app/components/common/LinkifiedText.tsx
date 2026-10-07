'use client';

import { useStore } from '@/lib/store';
import { openExternalUrl } from '@/lib/tauri/opener';
import { splitLinks } from '@/lib/text/linkify';

/** Text with http(s) links that open in the system browser. Everything else stays text. */
export function LinkifiedText({ text }: { text: string }) {
  const showToast = useStore((s) => s.showToast);

  const open = (url: string) => {
    openExternalUrl(url).catch((err: unknown) =>
      showToast(err instanceof Error ? err.message : 'Could not open the link.', 'error')
    );
  };

  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.type === 'link' ? (
          <a
            key={i}
            href={part.value}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              open(part.value);
            }}
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </>
  );
}
