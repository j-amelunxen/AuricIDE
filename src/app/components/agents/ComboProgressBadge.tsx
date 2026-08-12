'use client';

import { useStore } from '@/lib/store';
import { formatComboProgress } from '@/lib/quickAccess/combo';

interface ComboProgressBadgeProps {
  agentId: string;
  className?: string;
}

/** "1 / 3" on the window that currently carries a skill combo step. */
export function ComboProgressBadge({ agentId, className = '' }: ComboProgressBadgeProps) {
  // Select primitives only — a fresh object from comboStepForAgent would
  // retrigger the store subscription every render.
  const run = useStore((s) =>
    s.comboRuns.find((candidate) => candidate.currentAgentId === agentId)
  );
  if (!run) return null;
  const step = run.steps[run.currentIndex];
  return (
    <span
      data-testid="combo-progress"
      title={`${run.label} · ${step?.label ?? ''}`}
      className={`flex-shrink-0 whitespace-nowrap rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums tracking-wide text-primary-light ${className}`}
    >
      {formatComboProgress(run.currentIndex, run.steps.length)}
    </span>
  );
}
