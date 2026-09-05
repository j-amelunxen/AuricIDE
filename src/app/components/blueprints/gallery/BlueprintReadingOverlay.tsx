'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { Blueprint } from '@/lib/tauri/blueprints';
import { COMPLEXITY_MAP, CATEGORY_LABELS } from '@/lib/blueprints/constants';
import { READING_MARKDOWN_CLASSES } from './blueprintMarkdownStyles';

export interface BlueprintReadingOverlayProps {
  blueprint: Blueprint;
  onBack: () => void;
  onEdit: () => void;
}

export function BlueprintReadingOverlay({
  blueprint,
  onBack,
  onEdit,
}: BlueprintReadingOverlayProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="blueprint-reading-title"
      className="fixed inset-0 z-[var(--z-tool-nested)] bg-[#07070f]/95 backdrop-blur-sm overflow-y-auto custom-scrollbar"
    >
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Reading header */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
          >
            <AuricIcon name="arrow_back" className="text-[16px]" />
            Back to gallery
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <AuricIcon name="edit" className="text-[14px]" />
            Edit
          </button>
        </div>

        {/* Title */}
        <h1
          id="blueprint-reading-title"
          className="text-3xl font-bold text-foreground mb-4 leading-tight"
        >
          {blueprint.name}
        </h1>

        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-6">
          {COMPLEXITY_MAP[blueprint.complexity] && (
            <span
              className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${COMPLEXITY_MAP[blueprint.complexity].className}`}
            >
              {COMPLEXITY_MAP[blueprint.complexity].label}
            </span>
          )}
          <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-foreground-muted">
            {CATEGORY_LABELS[blueprint.category] ?? blueprint.category}
          </span>
        </div>

        {/* Tech stack */}
        {blueprint.techStack && (
          <div className="mb-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2">
              Tech Stack
            </p>
            <div className="flex flex-wrap gap-1.5">
              {blueprint.techStack.split(',').map((t) => (
                <span
                  key={t}
                  className="rounded border border-primary/15 bg-primary/5 px-2 py-0.5 text-[11px] font-mono text-primary-light"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Goal */}
        {blueprint.goal && (
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2">
              Goal
            </p>
            <p className="text-base text-foreground/80 leading-relaxed">{blueprint.goal}</p>
          </div>
        )}

        <div className="border-t border-white/10 mb-8" />

        {/* Full description */}
        {blueprint.description ? (
          <div className={READING_MARKDOWN_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{blueprint.description}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-base text-foreground-muted/50 italic">No description.</p>
        )}

        {blueprint.spec && (
          <>
            <div className="border-t border-white/10 my-8" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-6">
              Full Spec
            </p>
            <div className={READING_MARKDOWN_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{blueprint.spec}</ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
