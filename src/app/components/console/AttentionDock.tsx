'use client';

import type { AttentionPop } from '@/lib/agents/attentionDock';
import type { AttentionReason } from '@/lib/agents/attention';
import { projectLabel } from '@/lib/agents/lanes';
import { consoleAttentionBadge } from '@/lib/agents/consoleSummary';

const REASON_FACE: Record<AttentionReason, { label: string; className: string }> = {
  error: {
    label: 'Failed',
    className: 'border-red-400/40 bg-red-500/10 text-red-300',
  },
  'needs-input': {
    label: 'Waiting on you',
    className: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  },
  stalled: {
    label: 'Possibly stalled',
    className: 'border-orange-400/40 bg-orange-500/10 text-orange-200',
  },
};

export interface AttentionDockProps {
  pops: AttentionPop[];
  onFocus?: (agentId: string) => void;
}

/**
 * The column that spends the empty measure to the right of the activity feed.
 * Only agents that already need a human appear here — they pop in as they
 * start waiting, fail, or stall. A clean finish stays in the feed.
 */
export function AttentionDock({ pops, onFocus }: AttentionDockProps) {
  return (
    <aside
      data-testid="attention-dock"
      aria-label="Needs you"
      className="flex h-full min-h-0 flex-col border-l border-white/5 bg-black/20"
    >
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-foreground-muted">
          Needs you
        </h2>
        <span
          data-testid="attention-dock-count"
          className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-semibold ${
            pops.length > 0
              ? 'bg-amber-500/15 text-amber-400'
              : 'bg-emerald-500/15 text-emerald-400'
          }`}
        >
          {consoleAttentionBadge(pops.length)}
        </span>
      </div>

      {pops.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-sm font-semibold text-emerald-400/90">All clear</p>
          <p className="text-[11px] text-foreground-muted">Nothing needs you right now.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {pops.map((pop) => {
            const face = REASON_FACE[pop.reason];
            return (
              <li key={pop.agentId}>
                <button
                  type="button"
                  data-testid="attention-pop"
                  data-reason={pop.reason}
                  onClick={() => onFocus?.(pop.agentId)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left opacity-100 transition-[opacity,transform] duration-200 ease-out starting:opacity-0 starting:scale-95 hover:brightness-110 active:scale-[0.97] motion-reduce:transition-none motion-reduce:starting:scale-100 ${face.className}`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {pop.agentName}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                      {face.label}
                    </span>
                  </span>
                  {pop.repoPath && (
                    <span className="mt-0.5 block truncate text-[10px] text-foreground-muted">
                      {projectLabel(pop.repoPath)}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] leading-snug text-foreground/90">
                    {pop.headline}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
