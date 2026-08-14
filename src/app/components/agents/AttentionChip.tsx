'use client';

import { useStore } from '@/lib/store';
import { useAttentionCount } from '@/lib/hooks/useAttentionCount';

export interface AttentionChipProps {
  /** Reveals the fleet, so the number is one click away from its detail. */
  onShowAgents?: () => void;
}

/**
 * The fleet's attention count, in the title bar.
 *
 * The window title carries this number too, but macOS hides the title text
 * under the overlay title bar this app uses — so without a chip here the count
 * would only survive in the dock badge. It stays quiet at zero: the panel's
 * rule is that absence of alarms is stated by the all-quiet signal, not by a
 * chip repeating "0" until it stops being read.
 *
 * Ticks on the shared clock, so it lives in its own component rather than in
 * the header — otherwise the whole header would re-render every second.
 */
export function AttentionChip({ onShowAgents }: AttentionChipProps) {
  const agents = useStore((s) => s.agents);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);
  const count = useAttentionCount(agents, reviewedAgentIds);

  if (count === 0) return null;

  return (
    <button
      type="button"
      data-testid="attention-chip"
      onClick={onShowAgents}
      title="Open the agents panel"
      className="flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-medium text-amber-300 backdrop-blur-sm transition-colors duration-150 hover:bg-amber-500/20"
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
      />
      {/* The agents panel's own wording, so the two never look like two
          different numbers — and distinct from the conductor's "need you",
          which counts approvals rather than the fleet. */}
      {count === 1 ? '1 needs attention' : `${count} need attention`}
    </button>
  );
}
