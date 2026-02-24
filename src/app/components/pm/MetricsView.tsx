'use client';

import { useEffect, useState, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { BurndownChart } from './BurndownChart';
import { VelocityChart } from './VelocityChart';
import {
  computeTicketMetrics,
  computeVelocity,
  computeBurndown,
  computeEpicProjections,
  formatDuration,
} from '@/lib/pm/metrics';

export function MetricsView() {
  const rootPath = useStore((s) => s.rootPath);
  const history = useStore((s) => s.pmStatusHistory);
  const loading = useStore((s) => s.pmHistoryLoading);
  const loadPmHistory = useStore((s) => s.loadPmHistory);
  const tickets = useStore((s) => s.pmDraftTickets);
  const epics = useStore((s) => s.pmDraftEpics);
  const [burndownFilter, setBurndownFilter] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (rootPath) {
      loadPmHistory(rootPath);
    }
  }, [rootPath, loadPmHistory]);

  const historyEntries = useMemo(
    () =>
      history.map((h) => ({
        ticketId: h.ticketId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        changedAt: h.changedAt,
      })),
    [history]
  );

  const ticketInfos = useMemo(
    () =>
      tickets.map((t) => ({
        id: t.id,
        epicId: t.epicId,
        status: t.status,
      })),
    [tickets]
  );

  const epicInfos = useMemo(
    () =>
      epics.map((e) => ({
        id: e.id,
        name: e.name,
      })),
    [epics]
  );

  const ticketMetrics = useMemo(
    () => computeTicketMetrics(historyEntries, ticketInfos),
    [historyEntries, ticketInfos]
  );
  const velocity = useMemo(() => computeVelocity(historyEntries), [historyEntries]);
  const burndown = useMemo(
    () => computeBurndown(historyEntries, ticketInfos, burndownFilter),
    [historyEntries, ticketInfos, burndownFilter]
  );
  const projections = useMemo(
    () => computeEpicProjections(historyEntries, ticketInfos, epicInfos),
    [historyEntries, ticketInfos, epicInfos]
  );

  const completedMetrics = ticketMetrics.filter((m) => m.cycleTime !== null);
  const avgCycleTime =
    completedMetrics.length > 0
      ? completedMetrics.reduce((sum, m) => sum + (m.cycleTime ?? 0), 0) / completedMetrics.length
      : null;
  const avgLeadTime =
    completedMetrics.length > 0
      ? completedMetrics.reduce((sum, m) => sum + (m.leadTime ?? 0), 0) / completedMetrics.length
      : null;
  const totalCompleted = ticketInfos.filter(
    (t) => t.status === 'done' || t.status === 'archived'
  ).length;
  const recentVelocity = velocity.length > 0 ? velocity[velocity.length - 1].completed : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-foreground-muted text-sm">
        Loading metrics...
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-foreground-muted text-sm">
        No status history data yet. Metrics will appear as tickets change status.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: 'Avg Cycle Time',
            value: avgCycleTime ? formatDuration(avgCycleTime) : '\u2014',
          },
          { label: 'Avg Lead Time', value: avgLeadTime ? formatDuration(avgLeadTime) : '\u2014' },
          { label: 'Current Velocity', value: `${recentVelocity}/week` },
          { label: 'Total Completed', value: String(totalCompleted) },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4"
          >
            <div className="text-[10px] font-medium text-foreground-muted uppercase tracking-wider mb-1">
              {card.label}
            </div>
            <div className="text-xl font-semibold text-foreground">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Burndown Chart */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-foreground">Burndown</h3>
          <div className="flex gap-1">
            {[
              { label: 'Last 5', value: 5 as number | undefined },
              { label: 'Last 10', value: 10 as number | undefined },
              { label: 'All', value: undefined as number | undefined },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setBurndownFilter(opt.value)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  burndownFilter === opt.value
                    ? 'bg-white/15 text-white'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[220px]">
          <BurndownChart data={burndown} />
        </div>
      </div>

      {/* Velocity Chart */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
        <h3 className="text-xs font-semibold text-foreground mb-4">Velocity (Weekly)</h3>
        <div className="h-[200px]">
          <VelocityChart data={velocity} />
        </div>
      </div>

      {/* Epic Projections Table */}
      {projections.length > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
          <h3 className="text-xs font-semibold text-foreground mb-3">Epic Projections</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
                <th className="pb-2 font-medium">Epic</th>
                <th className="pb-2 font-medium text-center">Total</th>
                <th className="pb-2 font-medium text-center">Done</th>
                <th className="pb-2 font-medium text-center">Velocity</th>
                <th className="pb-2 font-medium text-right">Est. Completion</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p) => (
                <tr key={p.epicId} className="border-b border-white/[0.04]">
                  <td className="py-2 text-foreground">{p.epicName}</td>
                  <td className="py-2 text-center text-foreground-muted">{p.totalTickets}</td>
                  <td className="py-2 text-center text-foreground-muted">{p.completedTickets}</td>
                  <td className="py-2 text-center text-foreground-muted">
                    {p.avgVelocity.toFixed(1)}/wk
                  </td>
                  <td className="py-2 text-right text-foreground-muted">
                    {p.estimatedDaysRemaining !== null
                      ? `${Math.ceil(p.estimatedDaysRemaining)}d`
                      : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
