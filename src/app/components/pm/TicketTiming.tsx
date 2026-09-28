'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeTicketMetrics, formatDuration } from '@/lib/pm/metrics';
import { statusLabel, TimingCard, type TimingRow } from './TimingCard';

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

  const rows: TimingRow[] = [];
  if (metrics.timeInCurrentStatus !== null) {
    rows.push({
      label: statusLabel(metrics.currentStatus),
      value: formatDuration(metrics.timeInCurrentStatus),
    });
  }
  for (const [spellStatus, ms] of Object.entries(metrics.timeInStatus)) {
    rows.push({ label: statusLabel(spellStatus), value: formatDuration(ms) });
  }
  if (metrics.cycleTime !== null) {
    rows.push({ label: 'Cycle', value: formatDuration(metrics.cycleTime) });
  }
  if (metrics.leadTime !== null) {
    rows.push({ label: 'Lead', value: formatDuration(metrics.leadTime) });
  }

  return <TimingCard rows={rows} />;
}
