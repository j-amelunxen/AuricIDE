'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { DESCRIPTION_MAX_CHARS, normalizeProjectDescription } from '@/lib/quickAccess/description';
import { useStore } from '@/lib/store';
import type { StarredProject } from '@/lib/tauri/starredProjects';

interface ProjectDescriptionDialogProps {
  project: StarredProject;
  onClose: () => void;
}

/**
 * Sets the sentence agents read when they pick a project to work in
 * (`list_projects`). It outranks anything derived from the README, so it is
 * the place to say what the folder is for and what to be careful with.
 */
export function ProjectDescriptionDialog({ project, onClose }: ProjectDescriptionDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const setStarredProjectDescription = useStore((s) => s.setStarredProjectDescription);
  const showToast = useStore((s) => s.showToast);
  // `null` until the user types: the record may arrive after the dialog opens
  // (the native list loads late), and an untouched field should show it.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? project.description ?? '';
  const length = Array.from(text).length;

  const save = () => {
    const next = normalizeProjectDescription(text);
    if (next === (project.description ?? null)) {
      onClose();
      return;
    }
    setStarredProjectDescription(project.path, next);
    showToast(
      next
        ? `Description saved for ${project.name}`
        : `Description cleared for ${project.name}, the README is used again`,
      'success'
    );
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-description-title"
        data-testid="project-description-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
        className="flex w-96 flex-col gap-3 rounded-lg border border-border-dark bg-background-secondary p-5 shadow-2xl"
      >
        <h2 id="project-description-title" className="text-sm font-semibold text-foreground">
          Describe {project.name}
        </h2>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <textarea
            aria-label="Project description"
            aria-describedby="project-description-hint"
            value={text}
            maxLength={DESCRIPTION_MAX_CHARS}
            rows={4}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save();
              }
            }}
            placeholder="What this project is for, and anything an agent should know first"
            className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] leading-5 text-foreground placeholder:text-foreground-muted/60"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p id="project-description-hint" className="text-[11px] text-foreground-muted">
              Agents read this when they choose where to work. Leave it empty to use the description
              derived from the README.
            </p>
            <span
              data-testid="project-description-count"
              className="text-[11px] tabular-nums text-foreground-muted"
            >
              {length}/{DESCRIPTION_MAX_CHARS}
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border-dark px-3 py-1.5 text-sm text-foreground-muted transition-colors hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-primary/90 px-3 py-1.5 text-sm text-white transition-colors hover:bg-primary"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
