'use client';

import type { ForYouItem } from '@/lib/goals/forYou';

export interface ForYouQueueProps {
  items: ForYouItem[];
  runningCount: number;
  onItemClick: (item: ForYouItem) => void;
}

function itemTone(item: ForYouItem): string {
  if (item.kind === 'agent' && item.reason === 'error') {
    return 'bg-[#ff4a4a]/10 hover:bg-[#ff4a4a]/20';
  }
  return 'bg-[#ffce2e]/[0.07] hover:bg-[#ffce2e]/[0.14]';
}

function itemKey(item: ForYouItem): string {
  switch (item.kind) {
    case 'agent':
      return `agent-${item.agentId}`;
    case 'approval':
      return `approval-${item.ticketId}`;
    case 'unclaimed':
      return `unclaimed-${item.goalId}`;
  }
}

/** Ranked queue of board items that need a human. */
export function ForYouQueue({ items, runningCount, onItemClick }: ForYouQueueProps) {
  if (items.length === 0 && runningCount === 0) return null;

  return (
    <div data-testid="for-you-queue">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground-muted/60">
        For you
      </p>
      {items.length === 0 ? (
        <p data-testid="for-you-all-quiet" className="font-mono text-[11px] text-foreground-muted">
          <span className="text-[#2effa5]/70">All quiet</span> · {runningCount} running
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={itemKey(item)}
              data-testid={`for-you-row-${itemKey(item)}`}
              onClick={() => onItemClick(item)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-foreground transition-colors ${itemTone(item)}`}
            >
              {item.label}
              <span aria-hidden="true" className="text-foreground-muted/60">
                →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
