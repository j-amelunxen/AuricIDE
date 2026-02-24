'use client';

import type { Blueprint } from '@/lib/tauri/blueprints';
import { COMPLEXITY_MAP } from '@/lib/blueprints/constants';

interface BlueprintCardProps {
  blueprint: Blueprint;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function BlueprintCard({ blueprint, selected, onSelect }: BlueprintCardProps) {
  const complexity = COMPLEXITY_MAP[blueprint.complexity] ?? COMPLEXITY_MAP.MEDIUM;
  const tags = blueprint.techStack
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <button
      onClick={() => onSelect(blueprint.id)}
      className={`w-full text-left rounded-lg border p-3 transition-all ${
        selected
          ? 'border-primary/40 bg-primary/10'
          : 'border-white/5 bg-white/2 hover:border-white/10 hover:bg-white/5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground truncate">{blueprint.name}</h4>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${complexity.className}`}
        >
          {complexity.label}
        </span>
      </div>

      {blueprint.goal && (
        <p className="mt-1 text-[11px] text-foreground-muted line-clamp-2">{blueprint.goal}</p>
      )}

      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag, i) => (
            <span
              key={`${i}-${tag}`}
              className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] text-foreground-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
