'use client';

import { useStore } from '@/lib/store';
import {
  conductorRunScope,
  countConductorGoalAgents,
} from '@/lib/store/conductor/conductorHelpers';

/** Header pulse for conductor state. Click opens Goals. */
export function ConductorPulse() {
  const running = useStore((s) => s.conductorRunning);
  // Ticket implementers, reviewers and goal/planning agents all hold a slot.
  // Selected as a number so streaming agent updates do not re-render the chip.
  const workingCount = useStore(
    (s) =>
      Object.keys(s.conductorAssignments ?? {}).length +
      Object.keys(s.conductorReviewAssignments ?? {}).length +
      countConductorGoalAgents(s.agents ?? [], s.agentSpawnConfigs ?? {}, conductorRunScope(s))
  );
  const pendingApprovals = useStore((s) => s.conductorPendingApprovals);
  const openWorkPlace = useStore((s) => s.openWorkPlace);

  const waitingCount = pendingApprovals.length;

  return (
    <button
      data-testid="conductor-pulse"
      aria-label="Conductor status"
      onClick={() => openWorkPlace('goals')}
      title={running ? 'Conductor running · open Work → Goals' : 'Start conductor in Work → Goals'}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-medium backdrop-blur-sm transition-colors duration-150 hover:bg-white/10 ${
        running ? 'border-green-500/25 bg-green-500/5' : 'border-white/5 bg-black/20'
      }`}
    >
      <span
        data-testid="conductor-pulse-dot"
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          running
            ? 'animate-pulse bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
            : 'bg-gray-500'
        }`}
      />
      <span className={running ? 'text-green-300' : 'text-foreground-muted'}>Conductor</span>
      <span className="text-foreground-muted">{running ? `${workingCount} working` : 'idle'}</span>
      {waitingCount > 0 && (
        <span
          data-testid="conductor-pulse-waiting"
          className="rounded-full bg-amber-500/20 px-1.5 py-0.5 font-bold text-amber-300"
        >
          {waitingCount} need you
        </span>
      )}
    </button>
  );
}
