'use client';

import { useState } from 'react';
import type { PmEpic } from '@/lib/tauri/pm';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';

interface EpicEditDialogProps {
  isOpen: boolean;
  epic: PmEpic | null;
  onSave: (name: string, description: string) => void;
  onSaveAndClose: (name: string, description: string) => void;
  onClose: () => void;
}

function EpicEditForm({
  epic,
  onSave,
  onSaveAndClose,
  onClose,
}: Omit<EpicEditDialogProps, 'isOpen'>) {
  const [name, setName] = useState(epic?.name ?? '');
  const [description, setDescription] = useState(epic?.description ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSaveAndClose(name, description);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-[440px] bg-background-secondary border border-border-dark rounded-xl p-6 shadow-2xl"
      >
        <h3 className="mb-4 text-sm font-semibold text-foreground">
          {epic ? 'Edit Epic' : 'New Epic'}
        </h3>

        <div className="mb-4">
          <label className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
            Name
            <InfoTooltip description={GUIDANCE.pm.epicName} label="i" />
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Epic name"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none transition-colors"
            autoFocus
          />
        </div>

        <div className="mb-6">
          <label className="mb-1.5 flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider">
            Description
            <InfoTooltip description={GUIDANCE.pm.epicDescription} label="i" />
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this epic about?"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none resize-none transition-colors"
            rows={4}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-white/5 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => onSave(name, description)}
            className="rounded-lg bg-white/5 border border-white/10 px-4 py-2 text-xs font-medium text-foreground hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            Save
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-all shadow-lg shadow-primary/20"
          >
            Save and Close
          </button>
        </div>
      </form>
    </div>
  );
}

export function EpicEditDialog({
  isOpen,
  epic,
  onSave,
  onSaveAndClose,
  onClose,
}: EpicEditDialogProps) {
  if (!isOpen) return null;

  // Key forces remount when epic changes, resetting form state
  return (
    <EpicEditForm
      key={epic?.id ?? 'new'}
      epic={epic}
      onSave={onSave}
      onSaveAndClose={onSaveAndClose}
      onClose={onClose}
    />
  );
}
