'use client';

import { useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { KbdHint } from './KbdHint';
import { InboxTextSheet } from './InboxTextSheet';
import { trimmedCaptureTitle } from '@/lib/inbox/captureInput';
import {
  fileNameForPastedText,
  looksLikePastedDocument,
  titleForPastedText,
} from '@/lib/inbox/inboxText';
import {
  attachmentFileName,
  inboxMediaPathsFromFileList,
  pickInboxMediaFiles,
} from '@/lib/inbox/inboxMedia';
import type { InboxItem } from '@/lib/tauri/inbox';

export interface InboxCaptureProps {
  /** Focuses the field the moment it mounts — the start screen wants this. */
  autoFocus?: boolean;
  /** Runs after a successful capture, with the item the backend created. */
  onCaptured?: (item: InboxItem) => void;
  className?: string;
}

interface StagedText {
  fileName: string;
  body: string;
}

/**
 * The one-line capture bar: dropping a task in here has to be as effortless
 * as dropping an event into a calendar. It never asks which project — that
 * decision waits for Assign — so the only thing this component owns is the
 * text and the moment it becomes an item.
 *
 * A pasted document — most often a whole email — never enters the field.
 * The field is one line and cannot be scrolled or reviewed, so a mail typed
 * into it would be a title nobody can read and a body nobody can recover.
 * It is staged as an attachment instead, and the title is seeded from the
 * mail's subject unless the user has already written one of their own.
 */
export function InboxCapture({ autoFocus, onCaptured, className = '' }: InboxCaptureProps) {
  const addInboxItem = useStore((s) => s.addInboxItem);
  const attachInboxFile = useStore((s) => s.attachInboxFile);
  const attachInboxText = useStore((s) => s.attachInboxText);
  const [title, setTitle] = useState('');
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [pendingTexts, setPendingTexts] = useState<StagedText[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stagePaths = (paths: string[]) => {
    if (paths.length === 0) return;
    setPendingPaths((current) => [...current, ...paths.filter((path) => !current.includes(path))]);
  };

  const stageText = (fileName: string, body: string) => {
    setPendingTexts((current) => [...current, { fileName, body }]);
  };

  const pickFiles = async () => {
    stagePaths(await pickInboxMediaFiles());
  };

  const reset = (item: InboxItem) => {
    setTitle('');
    setPendingPaths([]);
    setPendingTexts([]);
    inputRef.current?.focus();
    onCaptured?.(item);
  };

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
    for (const path of pendingPaths) {
      const attached = await attachInboxFile(item.id, path);
      if (attached === null) {
        setError(useStore.getState().inboxError);
        reset(item);
        return;
      }
    }
    for (const text of pendingTexts) {
      const attached = await attachInboxText(item.id, text.fileName, text.body);
      if (attached === null) {
        setError(useStore.getState().inboxError);
        reset(item);
        return;
      }
    }
    setError(null);
    reset(item);
  };

  return (
    <div className={className}>
      <div
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          stagePaths(
            inboxMediaPathsFromFileList(
              Array.from(e.dataTransfer.files).map((file) => ({
                name: file.name,
                path: (file as File & { path?: string }).path,
              }))
            )
          );
        }}
      >
        <div className="flex items-center gap-2">
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
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (!looksLikePastedDocument(pasted)) return;
              e.preventDefault();
              stageText(fileNameForPastedText(pasted), pasted);
              setError(null);
              // A title the user has already started is theirs; a mail's
              // subject only fills a field that is still empty.
              setTitle((current) => (current.trim() === '' ? titleForPastedText(pasted) : current));
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
          <button
            type="button"
            title="Attach text"
            aria-label="Attach text"
            onClick={() => setSheetOpen(true)}
            className="shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="note_add" className="text-[16px]" />
          </button>
          <button
            type="button"
            title="Attach image or video"
            aria-label="Attach image or video"
            onClick={() => void pickFiles()}
            className="shrink-0 rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="image" className="text-[16px]" />
          </button>
          <span className="shrink-0 text-[9px] text-foreground-muted/60">
            <KbdHint keys="⏎" label="Add" />
          </span>
        </div>
        {(pendingPaths.length > 0 || pendingTexts.length > 0) && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pendingPaths.map((path) => (
              <li
                key={path}
                className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <span className="max-w-[10rem] truncate">{attachmentFileName(path)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachmentFileName(path)}`}
                  onClick={() =>
                    setPendingPaths((current) => current.filter((candidate) => candidate !== path))
                  }
                  className="text-foreground-muted hover:text-foreground"
                >
                  <AuricIcon name="close" className="text-[12px]" />
                </button>
              </li>
            ))}
            {pendingTexts.map((text, index) => (
              <li
                key={`${text.fileName}-${index}`}
                className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <AuricIcon name="description" className="text-[12px] text-foreground-muted" />
                <span className="max-w-[10rem] truncate">{text.fileName}</span>
                <span className="text-foreground-muted/60">{text.body.length} chars</span>
                <button
                  type="button"
                  aria-label={`Remove ${text.fileName}`}
                  onClick={() =>
                    setPendingTexts((current) =>
                      current.filter((_, candidate) => candidate !== index)
                    )
                  }
                  className="text-foreground-muted hover:text-foreground"
                >
                  <AuricIcon name="close" className="text-[12px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="mt-1 px-1 text-[10px] text-[#ff4a4a]/80">
          {error}
        </p>
      )}
      {sheetOpen && (
        <InboxTextSheet
          onAttach={(fileName, body) => {
            stageText(fileName, body);
            setTitle((current) => (current.trim() === '' ? titleForPastedText(body) : current));
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
