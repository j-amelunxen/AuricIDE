import type {
  ConductorDecision,
  ConductorPreflight,
  ConductorRunSummary,
} from '@/lib/store/conductorSlice';

/** Compact human-readable run duration: 42s, 13m, 1h 4m. */
export function formatRunDuration(startedAt: string, endedAt: string): string {
  const ms = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export const LAST_RUN_META: Record<ConductorRunSummary['outcome'], { cls: string; dot: string }> = {
  goal_achieved: { cls: 'text-green-300', dot: 'bg-green-400' },
  goal_blocked: { cls: 'text-amber-300', dot: 'bg-amber-400' },
  finished: { cls: 'text-foreground-muted', dot: 'bg-gray-500' },
  user_stopped: { cls: 'text-foreground-muted', dot: 'bg-gray-500' },
  budget_reached: { cls: 'text-foreground-muted', dot: 'bg-gray-500' },
};

export function lastRunLabel(run: ConductorRunSummary): string {
  switch (run.outcome) {
    case 'goal_achieved':
      return run.goalName ? `achieved "${run.goalName}"` : 'goal achieved';
    case 'goal_blocked':
      return `blocked: ${run.blockers.length} blocker${run.blockers.length === 1 ? '' : 's'}`;
    case 'finished':
      return 'finished';
    case 'user_stopped':
      return 'stopped by you';
    case 'budget_reached':
      return 'budget reached';
  }
}

export const DECISION_ICONS: Record<ConductorDecision['action'], { icon: string; cls: string }> = {
  start: { icon: 'play_arrow', cls: 'text-green-400' },
  stop: { icon: 'stop', cls: 'text-gray-400' },
  spawn: { icon: 'rocket_launch', cls: 'text-primary-light' },
  complete: { icon: 'check_circle', cls: 'text-green-400' },
  fail: { icon: 'error', cls: 'text-red-400' },
  approval_needed: { icon: 'pan_tool', cls: 'text-amber-400' },
  approved: { icon: 'thumb_up', cls: 'text-sky-400' },
  review_started: { icon: 'rate_review', cls: 'text-violet-300' },
  goal_achieved: { icon: 'military_tech', cls: 'text-green-300' },
};

/**
 * Reads the preflight as a sentence a human can act on: what the run will pick
 * up first, then what it will leave alone and why.
 */
export function preflightLabel(
  preflight: ConductorPreflight,
  selectedGoalName: string | null
): string {
  const held: string[] = [];
  if (preflight.blocked > 0) held.push(`${preflight.blocked} blocked`);
  if (preflight.needsApproval > 0) held.push(`${preflight.needsApproval} need approval`);
  if (preflight.inProgress > 0) held.push(`${preflight.inProgress} in progress`);
  if (preflight.toTest > 0) held.push(`${preflight.toTest} to test`);
  if (preflight.inReview > 0) held.push(`${preflight.inReview} in review`);
  if (preflight.exhausted > 0) held.push(`${preflight.exhausted} out of attempts`);

  if (preflight.ready === 0 && preflight.inProgress === 0) {
    const nothing = selectedGoalName
      ? preflight.total === 0
        ? 'No tickets yet - create work first'
        : preflight.done === preflight.total
          ? 'All tickets complete - checking open conditions'
          : 'No runnable tickets right now'
      : 'no open tickets in scope';
    return held.length > 0 ? `${nothing} · ${held.join(' · ')}` : nothing;
  }

  return [`${preflight.ready} ready`, ...held].join(' · ');
}

export const selectCls =
  'rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/30';

export const settingCls = 'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px]';
