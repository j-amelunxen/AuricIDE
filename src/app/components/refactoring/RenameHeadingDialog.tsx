'use client';

import { useState, useRef, useEffect } from 'react';

interface RenameHeadingDialogProps {
  oldTitle: string;
  referenceCount: number;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}

export function RenameHeadingDialog({
  oldTitle,
  referenceCount,
  onConfirm,
  onCancel,
}: RenameHeadingDialogProps) {
  const [newTitle, setNewTitle] = useState(oldTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const isValid = newTitle.trim().length > 0 && newTitle !== oldTitle;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) onConfirm(newTitle.trim());
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-96 rounded-xl border border-white/10 bg-panel-bg p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-foreground">Rename Heading</h3>

        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="mb-2 w-full rounded-lg border border-white/10 bg-editor-bg px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          autoFocus
        />

        {referenceCount > 0 && (
          <p className="mb-3 text-xs text-foreground-muted">
            {referenceCount} references will be updated across the workspace
          </p>
        )}
        {referenceCount === 0 && (
          <p className="mb-3 text-xs text-foreground-muted">0 references found</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-colors"
          >
            Rename
          </button>
        </div>
      </form>
    </div>
  );
}
