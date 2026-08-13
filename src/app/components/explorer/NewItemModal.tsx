'use client';

import { useEffect, useRef, useState } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';

interface NewItemModalProps {
  type: 'file' | 'folder';
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewItemModal({ type, onConfirm, onCancel }: NewItemModalProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'new-item', kind: 'tool', active: true, onEscape: onCancel });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const title = type === 'folder' ? 'New Folder' : 'New File';
  const placeholder = type === 'folder' ? 'folder-name' : 'filename.ts';

  const handleSubmit = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-item-modal-title"
        className="bg-background-secondary border border-border-dark rounded-lg shadow-2xl w-80 p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-item-modal-title" className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          placeholder={placeholder}
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
            disabled={!name.trim()}
            className="px-3 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
