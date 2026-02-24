'use client';

import { useState, useRef, useEffect } from 'react';

interface ExtractSectionDialogProps {
  headingTitle: string;
  suggestedFileName: string;
  contentPreview: string;
  onConfirm: (fileName: string) => void;
  onCancel: () => void;
}

export function ExtractSectionDialog({
  headingTitle,
  suggestedFileName,
  contentPreview,
  onConfirm,
  onCancel,
}: ExtractSectionDialogProps) {
  const [fileName, setFileName] = useState(suggestedFileName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const isValid = fileName.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid) onConfirm(fileName);
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-96 rounded-xl border border-white/10 bg-panel-bg p-5 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-semibold text-foreground">Extract Section</h3>

        <p className="mb-2 text-xs text-foreground-muted">
          Extracting: <span className="font-medium text-foreground">{headingTitle}</span>
        </p>

        <label className="mb-1 block text-xs text-foreground-muted">New file name</label>
        <input
          ref={inputRef}
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          className="mb-3 w-full rounded-lg border border-white/10 bg-editor-bg px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          autoFocus
        />

        <label className="mb-1 block text-xs text-foreground-muted">Content preview</label>
        <div className="mb-4 max-h-32 overflow-auto rounded-lg border border-white/10 bg-editor-bg p-2 text-xs text-foreground-muted">
          {contentPreview}
        </div>

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
            Extract
          </button>
        </div>
      </form>
    </div>
  );
}
