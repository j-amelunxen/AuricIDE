'use client';

import type { ConsoleAgentState } from '@/lib/agents/consoleState';

const PHASE_CHIP: Record<ConsoleAgentState, string> = {
  yours: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  error: 'border-red-400/30 bg-red-400/10 text-red-400',
  stalled: 'border-orange-400/25 bg-orange-400/10 text-orange-300',
  working: 'border-primary/30 bg-primary/10 text-primary-light',
  done: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400/90',
};

export interface PhaseChipProps {
  state: ConsoleAgentState;
  label: string;
  className?: string;
}

/**
 * The console's phase pill — one class map, shared by the fleet card and the
 * focus view's stage head, so the two can never disagree about what "yours"
 * or "stalled" looks like.
 */
export function PhaseChip({ state, label, className = '' }: PhaseChipProps) {
  return (
    <span
      data-testid="phase-chip"
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-semibold ${PHASE_CHIP[state]} ${className}`}
    >
      {label}
    </span>
  );
}
