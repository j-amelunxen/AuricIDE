'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { Blueprint } from '@/lib/tauri/blueprints';
import {
  COMPLEXITY_OPTIONS,
  COMPLEXITY_MAP,
  CATEGORY_OPTIONS,
  CATEGORY_LABELS,
} from '@/lib/blueprints/constants';

export interface BlueprintListColumnProps {
  search: string;
  onSearchChange: (search: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (cat: string) => void;
  complexityFilter: string;
  onComplexityFilterChange: (comp: string) => void;
  filtered: Blueprint[];
  totalDraftCount: number;
  selectedBlueprintId: string | null;
  onSelectBlueprint: (id: string | null) => void;
  onCreateNew: () => void;
  isDirty: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

export function BlueprintListColumn({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  complexityFilter,
  onComplexityFilterChange,
  filtered,
  totalDraftCount,
  selectedBlueprintId,
  onSelectBlueprint,
  onCreateNew,
  isDirty,
  onDiscard,
  onSave,
}: BlueprintListColumnProps) {
  return (
    <div className="w-[340px] flex-shrink-0 flex flex-col border-r border-white/10">
      {/* Filters */}
      <div className="p-3 border-b border-white/5 flex flex-col gap-2.5 flex-shrink-0">
        <div className="relative">
          <AuricIcon
            name="search"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-muted pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search blueprints…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => onCategoryFilterChange('all')}
            className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-primary/15 border-primary/30 text-primary-light'
                : 'border-white/10 text-foreground-muted hover:bg-white/5'
            }`}
          >
            All
          </button>
          {CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onCategoryFilterChange(opt.value)}
              className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                categoryFilter === opt.value
                  ? 'bg-primary/15 border-primary/30 text-primary-light'
                  : 'border-white/10 text-foreground-muted hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => onComplexityFilterChange('all')}
            className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
              complexityFilter === 'all'
                ? 'bg-white/10 border-white/20 text-foreground'
                : 'border-white/10 text-foreground-muted hover:bg-white/5'
            }`}
          >
            All
          </button>
          {COMPLEXITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onComplexityFilterChange(opt.value)}
              className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                complexityFilter === opt.value
                  ? opt.className
                  : 'border-white/10 text-foreground-muted hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AuricIcon
              name="library_books"
              className="mb-3 text-3xl text-foreground-muted opacity-40"
            />
            <p className="text-xs text-foreground-muted">
              {totalDraftCount === 0 ? 'No blueprints yet' : 'No results'}
            </p>
            {totalDraftCount === 0 && (
              <button
                onClick={onCreateNew}
                className="mt-3 rounded-lg bg-primary/15 px-4 py-2 text-xs font-bold text-primary-light transition-all hover:bg-primary/25"
              >
                Create Blueprint
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((bp) => {
              const complexity = COMPLEXITY_MAP[bp.complexity];
              const isSelected = bp.id === selectedBlueprintId;
              return (
                <button
                  key={bp.id}
                  onClick={() => onSelectBlueprint(isSelected ? null : bp.id)}
                  className={`text-left rounded-xl border p-3 transition-all ${
                    isSelected
                      ? 'bg-primary/10 border-primary/30 shadow-[0_0_12px_rgba(var(--primary-rgb),0.1)]'
                      : 'bg-white/2 border-white/8 hover:bg-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <span className="text-xs font-semibold text-foreground leading-snug line-clamp-1">
                      {bp.name}
                    </span>
                    {complexity && (
                      <span
                        className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${complexity.className}`}
                      >
                        {complexity.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-foreground-muted mb-1.5">
                    {CATEGORY_LABELS[bp.category] ?? bp.category}
                  </p>
                  {bp.techStack && (
                    <p className="text-[9px] text-primary-light/60 font-mono mb-1.5 line-clamp-1">
                      {bp.techStack}
                    </p>
                  )}
                  {bp.goal && (
                    <p className="text-[10px] text-foreground-muted/70 leading-snug line-clamp-2">
                      {bp.goal}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Save/Discard bar */}
      {isDirty && (
        <div className="flex gap-2 p-3 border-t border-white/5 flex-shrink-0">
          <button
            onClick={onDiscard}
            className="flex-1 rounded-lg px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
