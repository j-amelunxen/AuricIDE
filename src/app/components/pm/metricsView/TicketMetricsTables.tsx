'use client';

import type { StatusDuration, TicketMetrics } from '@/lib/pm/metrics';
import { formatDuration } from '@/lib/pm/metrics';
import { MetricPanel, DASH, statusLabel } from './metricsUi';

export interface TicketRow extends TicketMetrics {
  name: string;
}

export interface StatusDurationsTableProps {
  statusDurations: StatusDuration[];
}

export function StatusDurationsTable({ statusDurations }: StatusDurationsTableProps) {
  if (statusDurations.length === 0) return null;

  return (
    <MetricPanel title="Time in Status">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
            <th className="pb-2 font-medium">Status</th>
            <th className="pb-2 font-medium text-center">Tickets</th>
            <th className="pb-2 font-medium text-right">Median</th>
            <th className="pb-2 font-medium text-right">Average</th>
            <th className="pb-2 font-medium text-right">Longest</th>
          </tr>
        </thead>
        <tbody>
          {statusDurations.map((s) => (
            <tr key={s.status} className="border-b border-white/[0.04]">
              <td className="py-2 text-foreground">{statusLabel(s.status)}</td>
              <td className="py-2 text-center text-foreground-muted">{s.ticketCount}</td>
              <td className="py-2 text-right text-foreground-muted">
                {formatDuration(s.medianMs)}
              </td>
              <td className="py-2 text-right text-foreground-muted">
                {formatDuration(s.averageMs)}
              </td>
              <td className="py-2 text-right text-foreground-muted">
                {formatDuration(s.longestMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-foreground-muted mt-3">
        Counts spells a ticket has already left. The status a ticket sits in right now has no end
        yet, so it is listed below instead.
      </p>
    </MetricPanel>
  );
}

export interface CompletedTicketsTableProps {
  completedTicketRows: TicketRow[];
}

export function CompletedTicketsTable({ completedTicketRows }: CompletedTicketsTableProps) {
  if (completedTicketRows.length === 0) return null;

  return (
    <MetricPanel title={`Completed Tickets (${completedTicketRows.length})`}>
      <div className="max-h-[320px] overflow-y-auto pr-2">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel-bg">
            <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
              <th className="pb-2 font-medium">Ticket</th>
              <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">Cycle</th>
              <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">Lead</th>
              <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">In progress</th>
            </tr>
          </thead>
          <tbody>
            {completedTicketRows.map((t) => (
              <tr key={t.ticketId} className="border-b border-white/[0.04]">
                <td className="py-2 text-foreground truncate max-w-0 w-full" title={t.name}>
                  {t.name}
                </td>
                <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                  {t.cycleTime !== null ? formatDuration(t.cycleTime) : DASH}
                </td>
                <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                  {t.leadTime !== null ? formatDuration(t.leadTime) : DASH}
                </td>
                <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                  {t.timeInStatus.in_progress ? formatDuration(t.timeInStatus.in_progress) : DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-foreground-muted mt-3">
        Cycle is the last spell in progress until done. Lead is created until done.
      </p>
    </MetricPanel>
  );
}

export interface OpenTicketsTableProps {
  openTicketRows: TicketRow[];
}

export function OpenTicketsTable({ openTicketRows }: OpenTicketsTableProps) {
  if (openTicketRows.length === 0) return null;

  return (
    <MetricPanel title={`Open Tickets (${openTicketRows.length})`}>
      <div className="max-h-[320px] overflow-y-auto pr-2">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel-bg">
            <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
              <th className="pb-2 font-medium">Ticket</th>
              <th className="pb-2 font-medium whitespace-nowrap pr-4">Status</th>
              <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">
                In status since
              </th>
              <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">Waiting before</th>
            </tr>
          </thead>
          <tbody>
            {openTicketRows.map((t) => (
              <tr key={t.ticketId} className="border-b border-white/[0.04]">
                <td className="py-2 text-foreground truncate max-w-0 w-full" title={t.name}>
                  {t.name}
                </td>
                <td className="py-2 text-foreground-muted whitespace-nowrap pr-4">
                  {statusLabel(t.currentStatus)}
                </td>
                <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                  {t.timeInCurrentStatus !== null ? formatDuration(t.timeInCurrentStatus) : DASH}
                </td>
                <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                  {Object.values(t.timeInStatus).length > 0
                    ? formatDuration(Object.values(t.timeInStatus).reduce((sum, ms) => sum + ms, 0))
                    : DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MetricPanel>
  );
}
