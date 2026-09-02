'use client';

import { Fragment, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeTicketMetrics, formatDuration } from '@/lib/pm/metrics';

function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface TicketTimingProps {
  ticketId: string;
  status: string;
}

/**
 * How long this ticket sat in each status, plus cycle/lead once it has finished.
 * Reads the saved history — an unsaved status change is not a duration yet.
 */
export function TicketTiming({ ticketId, status }: TicketTimingProps) {
  const history = useStore((s) => s.pmStatusHistory);

  const metrics = useMemo(() => {
    const entries = (history ?? [])
      .filter((h) => h.ticketId === ticketId)
      .map((h) => ({
        ticketId: h.ticketId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedAt: h.changedAt,
      }));
    return computeTicketMetrics(entries, [{ id: ticketId, epicId: '', status }])[0];
  }, [history, ticketId, status]);

  const closedSpells = Object.entries(metrics.timeInStatus);
  const hasAnything =
    metrics.timeInCurrentStatus !== null ||
    closedSpells.length > 0 ||
    metrics.cycleTime !== null ||
    metrics.leadTime !== null;

  if (!hasAnything) return null;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-muted mb-2">
        Timing
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {metrics.timeInCurrentStatus !== null && (
          <>
            <dt className="text-foreground-muted">{statusLabel(metrics.currentStatus)}</dt>
            <dd className="text-right text-foreground">
              {formatDuration(metrics.timeInCurrentStatus)}
            </dd>
          </>
        )}
        {closedSpells.map(([spellStatus, ms]) => (
          <Fragment key={spellStatus}>
            <dt className="text-foreground-muted">{statusLabel(spellStatus)}</dt>
            <dd className="text-right text-foreground">{formatDuration(ms)}</dd>
          </Fragment>
        ))}
        {metrics.cycleTime !== null && (
          <>
            <dt className="text-foreground-muted">Cycle</dt>
            <dd className="text-right text-foreground">{formatDuration(metrics.cycleTime)}</dd>
          </>
        )}
        {metrics.leadTime !== null && (
          <>
            <dt className="text-foreground-muted">Lead</dt>
            <dd className="text-right text-foreground">{formatDuration(metrics.leadTime)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
