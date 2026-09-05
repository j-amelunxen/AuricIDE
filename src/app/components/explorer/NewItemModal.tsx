'use client';

import { useEffect, useRef, useState } from 'react';
import { ModalShell } from '@/app/components/ui/ModalShell';

interface NewItemModalProps {
  type: 'file' | 'folder';
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewItemModal({ type, onConfirm, onCancel }: NewItemModalProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const title = type === 'folder' ? 'New Folder' : 'New File';
  const placeholder = type === 'folder' ? 'folder-name' : 'filename.ts';

  const handleSubmit = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <ModalShell
      id="new-item"
      title={title}
      titleId="new-item-modal-title"
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
    </ModalShell>
  );
}
