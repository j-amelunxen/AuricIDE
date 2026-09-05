'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { Blueprint } from '@/lib/tauri/blueprints';
import { COMPLEXITY_MAP, CATEGORY_LABELS } from '@/lib/blueprints/constants';
import { DETAIL_MARKDOWN_CLASSES } from './blueprintMarkdownStyles';

export interface BlueprintDetailPaneProps {
  blueprint: Blueprint | null;
  onRead: () => void;
  onEdit: (blueprint: Blueprint) => void;
  onDelete: (id: string) => void;
}

export function BlueprintDetailPane({
  blueprint,
  onRead,
  onEdit,
  onDelete,
}: BlueprintDetailPaneProps) {
  if (!blueprint) {
    return (
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
          <AuricIcon name="auto_stories" className="text-5xl text-foreground-muted mb-3" />
          <p className="text-sm text-foreground-muted">Select a blueprint to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
      <div>
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="text-lg font-bold text-foreground leading-snug">{blueprint.name}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onRead}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
              title="Open full reading view"
            >
              <AuricIcon name="open_in_full" className="text-[14px]" />
              Read
            </button>
            <button
              onClick={() => onEdit(blueprint)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
            >
              <AuricIcon name="edit" className="text-[14px]" />
              Edit
            </button>
            <button
              onClick={() => onDelete(blueprint.id)}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors"
            >
              <AuricIcon name="delete" className="text-[14px]" />
              Delete
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
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

        {blueprint.techStack && (
          <div className="mb-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1.5">
              Tech Stack
            </p>
            <div className="flex flex-wrap gap-1.5">
              {blueprint.techStack.split(',').map((t) => (
                <span
                  key={t}
                  className="rounded border border-primary/15 bg-primary/5 px-2 py-0.5 text-[10px] font-mono text-primary-light"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {blueprint.goal && (
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1.5">
              Goal
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed">{blueprint.goal}</p>
          </div>
        )}

        <div className="border-t border-white/10 my-4" />

        {blueprint.description ? (
          <div className={DETAIL_MARKDOWN_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{blueprint.description}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-foreground-muted/50 italic">No description.</p>
        )}

        {blueprint.spec && (
          <>
            <div className="border-t border-white/10 my-4" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-3">
              Full Spec
            </p>
            <div className={DETAIL_MARKDOWN_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{blueprint.spec}</ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
