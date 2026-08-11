'use client';

import { useMemo, useState } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { openFolderDialog } from '@/lib/tauri/fs';
import {
  joinProjectPath,
  sanitizeProjectName,
  type NewProjectOptions,
  type NewProjectTemplate,
} from '@/lib/project/newProject';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export type { NewProjectOptions, NewProjectTemplate };

export interface NewProjectModalProps {
  isOpen: boolean;
  onCreate: (options: NewProjectOptions) => void | Promise<void>;
  onClose: () => void;
}

const TEMPLATES: { value: NewProjectTemplate; label: string; icon: string; hint: string }[] = [
  { value: 'empty', label: 'Empty', icon: 'draft', hint: 'Just a README to get started.' },
  { value: 'notes', label: 'Notes', icon: 'menu_book', hint: 'A notes/ folder for markdown.' },
  { value: 'spec', label: 'Spec-Driven', icon: 'architecture', hint: 'README + spec.md scaffold.' },
];

function NewProjectForm({ onCreate, onClose }: Omit<NewProjectModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [template, setTemplate] = useState<NewProjectTemplate>('empty');
  const [busy, setBusy] = useState(false);
  const dialogRef = useDialogA11y<HTMLFormElement>();

  const cleanName = sanitizeProjectName(name);
  const canCreate = cleanName.length > 0 && parentDir.length > 0 && !busy;
  const previewPath = useMemo(
    () => (parentDir && cleanName ? joinProjectPath(parentDir, cleanName) : ''),
    [parentDir, cleanName]
  );

  const handleBrowse = async () => {
    const selected = await openFolderDialog();
    if (selected) setParentDir(selected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    try {
      await onCreate({ name: cleanName, parentDir, template });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        data-testid="new-project-modal"
        onSubmit={handleSubmit}
        className="glass-card relative w-[480px] max-w-[95vw] overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a10] shadow-2xl animate-in fade-in zoom-in duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <AuricIcon name="create_new_folder" className="text-primary-light text-[18px]" />
            <h3 id="new-project-title" className="text-sm font-semibold text-foreground">
              New Project
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <AuricIcon name="close" className="text-[18px]" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label
              htmlFor="new-project-name"
              className="mb-1.5 block text-xs font-medium text-foreground-muted"
            >
              Project name <span className="text-red-400/70">*</span>
            </label>
            <input
              id="new-project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-project"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Location */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Location <span className="text-red-400/70">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={parentDir}
                readOnly
                placeholder="Choose a parent folder…"
                data-testid="new-project-location"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:outline-none truncate"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 transition-colors"
              >
                <AuricIcon name="folder_open" className="text-[16px]" />
                Browse
              </button>
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Template
            </label>
            <div className="grid grid-cols-3 gap-2" data-testid="template-selector">
              {TEMPLATES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTemplate(opt.value)}
                  aria-pressed={template === opt.value}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-colors ${
                    template === opt.value
                      ? 'border-primary/50 bg-primary/10 text-primary-light'
                      : 'border-white/10 text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <AuricIcon name={opt.icon} className="text-[20px]" />
                  <span className="text-[11px] font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-foreground-muted leading-relaxed">
              {TEMPLATES.find((t) => t.value === template)?.hint}
            </p>
          </div>

          {/* Path preview */}
          {previewPath && (
            <div
              data-testid="new-project-preview"
              className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 text-[11px] text-foreground-muted"
            >
              Creates <span className="text-primary-light font-mono break-all">{previewPath}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canCreate}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
          >
            {busy ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function NewProjectModal({ isOpen, ...props }: NewProjectModalProps) {
  if (!isOpen) return null;
  return <NewProjectForm {...props} />;
}
