'use client';

import type { ConsoleAgentState } from '@/lib/agents/consoleState';
import { STATE_CHIP } from '../agents/card/cardConstants';

/** The card's state colours, per console bucket: a phase looks like the card state it summarises. */
const PHASE_CHIP: Record<ConsoleAgentState, string> = {
  yours: STATE_CHIP['needs-input'],
  error: STATE_CHIP.error,
  stalled: STATE_CHIP.stalled,
  working: STATE_CHIP.working,
  queued: STATE_CHIP.queued,
  done: STATE_CHIP.done,
};

export interface PhaseChipProps {
  state: ConsoleAgentState;
  label: string;
  /** `compact` shrinks the text for tight spots like the lane rail, where
   * the chip sits inline next to a project label rather than on its own. */
  size?: 'default' | 'compact';
  className?: string;
}

const SIZE_TEXT: Record<'default' | 'compact', string> = {
  default: 'text-[10px]',
  compact: 'text-[9px]',
};

/**
 * The console's phase pill — one class map, shared by the fleet card and the
 * focus view's stage head, so the two can never disagree about what "yours"
 * or "stalled" looks like.
 */
export function PhaseChip({ state, label, size = 'default', className = '' }: PhaseChipProps) {
  return (
    <span
      data-testid="phase-chip"
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px font-semibold ${SIZE_TEXT[size]} ${PHASE_CHIP[state]} ${className}`}
    >
      {label}
    </span>
  );
}
