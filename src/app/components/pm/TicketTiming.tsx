'use client';

import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { computeTicketMetrics } from '@/lib/pm/metrics/ticketMetrics';
import { TimingCard, timingRows } from './TimingCard';

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

  return <TimingCard rows={timingRows(metrics)} />;
}
