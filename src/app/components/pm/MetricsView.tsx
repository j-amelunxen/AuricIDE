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
  parseHistoryTime,
} from '@/lib/pm/metrics';
import { isClosedTicketStatus } from '@/lib/pm/enums';
import {
  BASIS_OPTIONS,
  CLOCK_TICK_MS,
  COMPLETED_STATUSES,
  DASH,
  FORECAST_DAYS,
  MetricCard,
  MetricPanel,
} from './metricsView/metricsUi';
import { EpicProjectionsTable } from './metricsView/EpicProjectionsTable';
import {
  CompletedTicketsTable,
  OpenTicketsTable,
  StatusDurationsTable,
} from './metricsView/TicketMetricsTables';

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
  const [epicFilter, setEpicFilter] = useState('all');

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

  const scopedTickets = useMemo(
    () => (epicFilter === 'all' ? ticketInfos : ticketInfos.filter((t) => t.epicId === epicFilter)),
    [ticketInfos, epicFilter]
  );

  const scopedIds = useMemo(() => new Set(scopedTickets.map((t) => t.id)), [scopedTickets]);

  const scopedHistory = useMemo(
    () =>
      epicFilter === 'all'
        ? historyEntries
        : historyEntries.filter((h) => scopedIds.has(h.ticketId)),
    [historyEntries, scopedIds, epicFilter]
  );

  const scopedEpics = useMemo(
    () => (epicFilter === 'all' ? epicInfos : epicInfos.filter((e) => e.id === epicFilter)),
    [epicInfos, epicFilter]
  );

  const basis = useMemo(
    () => computeVelocityBasis(scopedHistory, scopedTickets, basisSize),
    [scopedHistory, scopedTickets, basisSize]
  );

  const ticketMetrics = useMemo(
    () => computeTicketMetrics(scopedHistory, scopedTickets, now),
    [scopedHistory, scopedTickets, now]
  );

  const statusDurations = useMemo(
    () => computeStatusDurations(scopedHistory, scopedTickets),
    [scopedHistory, scopedTickets]
  );

  const velocity = useMemo(
    () => computeVelocity(scopedHistory, scopedTickets, 1, now),
    [scopedHistory, scopedTickets, now]
  );

  const burndown = useMemo(
    () =>
      computeBurndown(scopedHistory, scopedTickets, {
        now,
        throughputPerDay: basis.ticketsPerDay,
        forecastDays: FORECAST_DAYS,
      }),
    [scopedHistory, scopedTickets, basis.ticketsPerDay, now]
  );

  const projections = useMemo(
    () => computeEpicProjections(scopedHistory, scopedTickets, scopedEpics, basis, now),
    [scopedHistory, scopedTickets, scopedEpics, basis, now]
  );

  const project = useMemo(
    () => computeProjectProjection(scopedTickets, basis, now),
    [scopedTickets, basis, now]
  );

  const ticketNames = useMemo(() => new Map(tickets.map((t) => [t.id, t.name])), [tickets]);

  // Longest-waiting first: the point of the list is to surface what is stuck.
  const openTicketRows = useMemo(
    () =>
      ticketMetrics
        .filter((m) => !isClosedTicketStatus(m.currentStatus))
        .map((m) => ({ ...m, name: ticketNames.get(m.ticketId) ?? m.ticketId }))
        .sort((a, b) => (b.timeInCurrentStatus ?? 0) - (a.timeInCurrentStatus ?? 0)),
    [ticketMetrics, ticketNames]
  );

  const completedTicketRows = useMemo(
    () =>
      ticketMetrics
        .filter((m) => COMPLETED_STATUSES.has(m.currentStatus))
        .map((m) => ({ ...m, name: ticketNames.get(m.ticketId) ?? m.ticketId }))
        .sort((a, b) => {
          const at = a.completedAt ? parseHistoryTime(a.completedAt) : 0;
          const bt = b.completedAt ? parseHistoryTime(b.completedAt) : 0;
          return bt - at;
        }),
    [ticketMetrics, ticketNames]
  );

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
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-foreground-muted">Epic</span>
        <select
          aria-label="Epic"
          value={epicFilter}
          onChange={(e) => setEpicFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[10px] text-foreground"
        >
          <option value="all">All</option>
          {epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.name}
            </option>
          ))}
        </select>
      </div>
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
        <MetricCard
          label="Avg Cycle Time"
          value={basis.avgCycleTime ? formatDuration(basis.avgCycleTime) : DASH}
          hint="Started work → done"
        />
        <MetricCard
          label="Avg Lead Time"
          value={basis.avgLeadTime ? formatDuration(basis.avgLeadTime) : DASH}
          hint="Created → done"
        />
        <MetricCard
          label="Throughput"
          value={throughput}
          hint={
            basis.ticketsPerDay > 0 ? `${(basis.ticketsPerDay * 7).toFixed(1)} per week` : undefined
          }
        />
        <MetricCard
          label={epicFilter === 'all' ? 'Project ETA' : 'Epic ETA'}
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

      <MetricPanel title="Burndown">
        <div className="h-[240px]">
          <BurndownChart data={burndown} />
        </div>
      </MetricPanel>

      <MetricPanel title="Velocity (Daily)">
        <div className="h-[200px]">
          <VelocityChart data={velocity} />
        </div>
      </MetricPanel>

      <StatusDurationsTable statusDurations={statusDurations} />

      <EpicProjectionsTable projections={projections} project={project} />

      <CompletedTicketsTable completedTicketRows={completedTicketRows} />

      <OpenTicketsTable openTicketRows={openTicketRows} />
    </div>
  );
}
