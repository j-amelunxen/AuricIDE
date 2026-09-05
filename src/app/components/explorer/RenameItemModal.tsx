'use client';

import { useEffect, useRef, useState } from 'react';
import { ModalShell } from '@/app/components/ui/ModalShell';

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
    <ModalShell
      id="rename-item"
      title={title}
      titleId="rename-item-modal-title"
      className="w-80"
      onClose={onCancel}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
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
    </ModalShell>
  );
}
