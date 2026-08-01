'use client';

import { useEffect, useRef, useState } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';

interface RenameItemModalProps {
  oldName: string;
  isDirectory: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameItemModal({
  oldName,
  isDirectory,
  onConfirm,
  onCancel,
}: RenameItemModalProps) {
  const [name, setName] = useState(oldName);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Match Finder/VS Code: select the base name only, leaving the
    // extension untouched so a quick rename doesn't clobber the file type.
    const dotIndex = oldName.lastIndexOf('.');
    const selectionEnd = !isDirectory && dotIndex > 0 ? dotIndex : oldName.length;
    input.setSelectionRange(0, selectionEnd);
  }, [oldName, isDirectory]);

  const title = isDirectory ? 'Rename Folder' : 'Rename File';
  const isValid = name.trim().length > 0 && name.trim() !== oldName;

  const handleSubmit = () => {
    if (isValid) onConfirm(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-item-modal-title"
        className="bg-background-secondary border border-border-dark rounded-lg shadow-2xl w-80 p-5 flex flex-col gap-4"
      >
        <h2 id="rename-item-modal-title" className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full bg-background border border-border-dark rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded border border-border-dark text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid}
            className="px-3 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
