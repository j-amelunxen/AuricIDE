'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { BurndownChart } from './BurndownChart';
import { VelocityChart } from './VelocityChart';
import {
  computeBurndown,
  computeEpicProjections,
  computeProjectProjection,
  computeStatusDurations,
  computeTicketMetrics,
  computeVelocity,
  computeVelocityBasis,
  formatDuration,
} from '@/lib/pm/metrics';

/**
 * How much history an estimate is allowed to lean on. The whole point of the
 * narrow windows is that a project's recent pace and its lifetime pace are
 * different numbers, and the one you want depends on what you are deciding.
 */
const BASIS_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Last 5', value: 5 },
  { label: 'Last 10', value: 10 },
  { label: 'Last 20', value: 20 },
  { label: 'All', value: undefined },
];

const FORECAST_DAYS = 30;
/** How often the "still sitting here" figures catch up with the clock. */
const CLOCK_TICK_MS = 60_000;
const DASH = '—';

const COMPLETED_STATUSES = new Set(['done', 'archived']);

function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
      <div className="text-[10px] font-medium text-foreground-muted uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
      {hint && <div className="text-[10px] text-foreground-muted mt-1">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function ProgressCell({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 justify-center">
      <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500/50" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-foreground-muted w-7 text-right">{Math.round(pct)}%</span>
    </div>
  );
}

export function MetricsView() {
  const rootPath = useStore((s) => s.rootPath);
  const history = useStore((s) => s.pmStatusHistory);
  const loading = useStore((s) => s.pmHistoryLoading);
  const loadPmHistory = useStore((s) => s.loadPmHistory);
  // The persisted snapshot, not the drafts: every figure here is measured
  // against recorded history, and an unsaved status change has no history entry
  // to be measured against. Mixing the two would count a ticket as done in the
  // epic table while the burndown, reading the same moment, had never seen it.
  const tickets = useStore((s) => s.pmTickets);
  const epics = useStore((s) => s.pmEpics);
  const pmDirty = useStore((s) => s.pmDirty);

  const [basisSize, setBasisSize] = useState<number | undefined>(10);

  useEffect(() => {
    if (rootPath) {
      loadPmHistory(rootPath);
    }
  }, [rootPath, loadPmHistory]);

  // One instant for the whole page, held in state rather than read during
  // render: every figure is then measured against the same moment, and the
  // ones that count against the clock keep moving on their own.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

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
    () => tickets.map((t) => ({ id: t.id, epicId: t.epicId, status: t.status })),
    [tickets]
  );

  const epicInfos = useMemo(() => epics.map((e) => ({ id: e.id, name: e.name })), [epics]);

  const basis = useMemo(
    () => computeVelocityBasis(historyEntries, ticketInfos, basisSize),
    [historyEntries, ticketInfos, basisSize]
  );

  const ticketMetrics = useMemo(
    () => computeTicketMetrics(historyEntries, ticketInfos, now),
    [historyEntries, ticketInfos, now]
  );

  const statusDurations = useMemo(
    () => computeStatusDurations(historyEntries, ticketInfos),
    [historyEntries, ticketInfos]
  );

  const velocity = useMemo(
    () => computeVelocity(historyEntries, ticketInfos, 1, now),
    [historyEntries, ticketInfos, now]
  );

  const burndown = useMemo(
    () =>
      computeBurndown(historyEntries, ticketInfos, {
        now,
        throughputPerDay: basis.ticketsPerDay,
        forecastDays: FORECAST_DAYS,
      }),
    [historyEntries, ticketInfos, basis.ticketsPerDay, now]
  );

  const projections = useMemo(
    () => computeEpicProjections(historyEntries, ticketInfos, epicInfos, basis, now),
    [historyEntries, ticketInfos, epicInfos, basis, now]
  );

  const project = useMemo(
    () => computeProjectProjection(ticketInfos, basis, now),
    [ticketInfos, basis, now]
  );

  // Longest-waiting first: the point of the list is to surface what is stuck.
  const openTicketRows = useMemo(() => {
    const names = new Map(tickets.map((t) => [t.id, t.name]));
    return ticketMetrics
      .filter((m) => !COMPLETED_STATUSES.has(m.currentStatus))
      .map((m) => ({ ...m, name: names.get(m.ticketId) ?? m.ticketId }))
      .sort((a, b) => (b.timeInCurrentStatus ?? 0) - (a.timeInCurrentStatus ?? 0));
  }, [ticketMetrics, tickets]);

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

  const basisSelector = (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-foreground-muted mr-1">Estimate from</span>
      {BASIS_OPTIONS.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => setBasisSize(opt.value)}
          aria-pressed={basisSize === opt.value}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
            basisSize === opt.value
              ? 'bg-white/15 text-white'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  const throughput = basis.ticketsPerDay > 0 ? `${basis.ticketsPerDay.toFixed(2)}/day` : DASH;

  const basisNote =
    basis.sampleSize === 0
      ? 'Nothing completed yet, so no pace can be measured.'
      : basis.sampleSize === 1
        ? '1 ticket completed — too few to measure a pace.'
        : `${basis.sampleSize} tickets completed over ${formatDuration(basis.spanMs)}` +
          (basis.spanMs < 24 * 60 * 60 * 1000
            ? ', measured over a full day since a shorter window cannot claim a daily rate'
            : '');

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Basis — everything below is measured from this window */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {basisSelector}
        <span className="text-[10px] text-foreground-muted">{basisNote}</span>
      </div>

      {pmDirty && (
        <p className="text-[10px] text-amber-400/80">
          Unsaved changes are not counted yet — these figures read the saved history.
        </p>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card
          label="Avg Cycle Time"
          value={basis.avgCycleTime ? formatDuration(basis.avgCycleTime) : DASH}
          hint="Started work → done"
        />
        <Card
          label="Avg Lead Time"
          value={basis.avgLeadTime ? formatDuration(basis.avgLeadTime) : DASH}
          hint="Created → done"
        />
        <Card
          label="Throughput"
          value={throughput}
          hint={
            basis.ticketsPerDay > 0 ? `${(basis.ticketsPerDay * 7).toFixed(1)} per week` : undefined
          }
        />
        <Card
          label="Project ETA"
          value={
            project.estimatedDaysRemaining !== null ? `${project.estimatedDaysRemaining}d` : DASH
          }
          hint={
            project.estimatedCompletionDate
              ? `${project.remainingTickets} left · ${project.estimatedCompletionDate}`
              : `${project.remainingTickets} left`
          }
        />
      </div>

      <Panel title="Burndown">
        <div className="h-[240px]">
          <BurndownChart data={burndown} />
        </div>
      </Panel>

      <Panel title="Velocity (Daily)">
        <div className="h-[200px]">
          <VelocityChart data={velocity} />
        </div>
      </Panel>

      {statusDurations.length > 0 && (
        <Panel title="Time in Status">
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
            Counts spells a ticket has already left. The status a ticket sits in right now has no
            end yet, so it is listed below instead.
          </p>
        </Panel>
      )}

      {projections.length > 0 && (
        <Panel title="Epic Projections">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
                <th className="pb-2 font-medium">Epic</th>
                <th className="pb-2 font-medium text-center">Total</th>
                <th className="pb-2 font-medium text-center">Done</th>
                <th className="pb-2 font-medium text-center">Progress</th>
                <th className="pb-2 font-medium text-center">Left</th>
                <th className="pb-2 font-medium text-right">Est. Days</th>
                <th className="pb-2 font-medium text-right">Est. Date</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p) => (
                <tr key={p.epicId} className="border-b border-white/[0.04]">
                  <td className="py-2 text-foreground">{p.epicName}</td>
                  <td className="py-2 text-center text-foreground-muted">{p.totalTickets}</td>
                  <td className="py-2 text-center text-foreground-muted">{p.completedTickets}</td>
                  <td className="py-2 text-center">
                    <ProgressCell done={p.completedTickets} total={p.totalTickets} />
                  </td>
                  <td className="py-2 text-center text-foreground-muted">{p.remainingTickets}</td>
                  <td className="py-2 text-right text-foreground-muted">
                    {p.estimatedDaysRemaining !== null ? `${p.estimatedDaysRemaining}d` : DASH}
                  </td>
                  <td className="py-2 text-right text-foreground-muted">
                    {p.estimatedCompletionDate ?? DASH}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-foreground font-semibold border-t border-white/[0.08]">
                <td className="py-3">Project</td>
                <td className="py-3 text-center">{project.totalTickets}</td>
                <td className="py-3 text-center">{project.completedTickets}</td>
                <td className="py-3 text-center">
                  <ProgressCell done={project.completedTickets} total={project.totalTickets} />
                </td>
                <td className="py-3 text-center">{project.remainingTickets}</td>
                <td className="py-3 text-right">
                  {project.estimatedDaysRemaining !== null
                    ? `${project.estimatedDaysRemaining}d`
                    : DASH}
                </td>
                <td className="py-3 text-right">{project.estimatedCompletionDate ?? DASH}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-[10px] text-foreground-muted mt-3">
            Each epic&apos;s estimate assumes the whole throughput is aimed at it, so the project
            row is the shared estimate rather than the sum of the rows above.
          </p>
        </Panel>
      )}

      {openTicketRows.length > 0 && (
        <Panel title={`Open Tickets (${openTicketRows.length})`}>
          <div className="max-h-[320px] overflow-y-auto pr-2">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-bg">
                <tr className="text-foreground-muted text-left border-b border-white/[0.08]">
                  <th className="pb-2 font-medium">Ticket</th>
                  <th className="pb-2 font-medium whitespace-nowrap pr-4">Status</th>
                  <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">
                    In status since
                  </th>
                  <th className="pb-2 font-medium text-right whitespace-nowrap pl-4">
                    Waiting before
                  </th>
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
                      {t.timeInCurrentStatus !== null
                        ? formatDuration(t.timeInCurrentStatus)
                        : DASH}
                    </td>
                    <td className="py-2 text-right text-foreground-muted whitespace-nowrap">
                      {Object.values(t.timeInStatus).length > 0
                        ? formatDuration(
                            Object.values(t.timeInStatus).reduce((sum, ms) => sum + ms, 0)
                          )
                        : DASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
