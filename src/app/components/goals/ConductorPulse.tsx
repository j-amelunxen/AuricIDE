'use client';

import { useStore } from '@/lib/store';

/**
 * The conductor's heartbeat — a permanently visible organ in the header.
 * The state it renders (running, working agents, pending approvals) already
 * lives in conductorSlice; this makes it ambient instead of modal-buried.
 * Clicking opens Goals & Orchestration where the full controls live.
 */
export function ConductorPulse() {
  const running = useStore((s) => s.conductorRunning);
  const assignments = useStore((s) => s.conductorAssignments);
  const pendingApprovals = useStore((s) => s.conductorPendingApprovals);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);

  const workingCount = Object.keys(assignments).length;
  const waitingCount = pendingApprovals.length;

  return (
    <button
      data-testid="conductor-pulse"
      aria-label="Conductor status"
      onClick={() => setGoalsModalOpen(true)}
      title={
        running
          ? 'The conductor is working autonomously — click for Goals & Orchestration'
          : 'Start the conductor from Goals & Orchestration'
      }
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
          {waitingCount} waiting for you
        </span>
      )}
    </button>
  );
}
