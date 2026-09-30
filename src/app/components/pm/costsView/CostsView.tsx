'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { formatDuration } from '@/lib/pm/metrics';
import {
  estimateDeviation,
  groupUsage,
  type UsageGroup,
  sumUsage,
  withinWindow,
  type UsageGroupBy,
  type UsageWindow,
} from '@/lib/pm/usage/aggregate';
import { DASH, MetricCard, MetricPanel, statusLabel } from '../metricsView/metricsUi';
import { useProjectUsageRows } from '../cost/useProjectUsageRows';
import { formatTokens, formatTotalCost, unpricedNote } from '../cost/usageFormat';
import { ToggleGroup } from './ToggleGroup';

const WINDOWS: { value: UsageWindow; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

const GROUPINGS: { value: UsageGroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'epic', label: 'Epic' },
  { value: 'goal', label: 'Goal' },
  { value: 'provider', label: 'Provider' },
  { value: 'model', label: 'Model' },
];

const UNATTRIBUTED_KEY = '—';

function groupLabel(group: UsageGroup, groupBy: UsageGroupBy): string {
  if (group.key === UNATTRIBUTED_KEY) return 'Unattributed';
  return groupBy === 'status' ? statusLabel(group.label) : group.label;
}

function percent(value: number): string {
  return `${value.toFixed(1)} %`;
}

export function CostsView() {
  const rows = useProjectUsageRows();
  const tickets = useStore((s) => s.pmTickets);
  const epics = useStore((s) => s.pmEpics);
  const goals = useStore((s) => s.goals);

  const [usageWindow, setUsageWindow] = useState<UsageWindow>('30d');
  const [groupBy, setGroupBy] = useState<UsageGroupBy>('status');
  // One instant, held in state: reading the clock during render would let the
  // window edge move between two renders of the same data.
  const [now] = useState(() => new Date());

  const windowed = useMemo(() => withinWindow(rows, usageWindow, now), [rows, usageWindow, now]);
  const totals = useMemo(() => sumUsage(windowed), [windowed]);
  const deviation = useMemo(() => estimateDeviation(windowed), [windowed]);
  const groups = useMemo(
    () => groupUsage(windowed, groupBy, { tickets, goals, epics }),
    [windowed, groupBy, tickets, goals, epics]
  );

  const note = unpricedNote(totals);
  const estimatedShare =
    totals.runs > 0 ? `${Math.round((totals.estimatedRuns / totals.runs) * 100)} %` : DASH;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <ToggleGroup
          label="Window"
          options={WINDOWS}
          value={usageWindow}
          onChange={setUsageWindow}
        />
        <ToggleGroup label="Group by" options={GROUPINGS} value={groupBy} onChange={setGroupBy} />
      </div>

      <div className="grid grid-cols-5 gap-4">
        <MetricCard
          label="Cost"
          value={formatTotalCost(totals)}
          hint={note ?? 'List-price equivalent'}
        />
        <MetricCard label="Tokens" value={formatTokens(totals.totalTokens)} />
        <MetricCard label="Agent time" value={formatDuration(totals.durationMs)} />
        <MetricCard label="Runs" value={String(totals.runs)} />
        <MetricCard label="Estimated" value={estimatedShare} hint="Share of runs priced by us" />
      </div>

      <p className="text-[11px] text-foreground-muted">
        {deviation
          ? `Estimates deviate by ${percent(deviation.meanAbsPct)} on average (median ${percent(deviation.medianAbsPct)}, n = ${deviation.n} headless runs)`
          : 'No benchmark yet — needs a headless Claude run'}
      </p>

      <MetricPanel title="Cost by group">
        {groups.length === 0 ? (
          <p className="text-xs text-foreground-muted">No agent runs recorded in this window.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-foreground-muted">
                <th scope="col" className="pb-2 font-medium">
                  {GROUPINGS.find((g) => g.value === groupBy)?.label}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Runs
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Tokens
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Agent time
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const groupNote = unpricedNote(group.totals);
                return (
                  <tr key={group.key} className="border-t border-white/[0.05]">
                    <th scope="row" className="py-1.5 text-left font-normal text-foreground">
                      {groupLabel(group, groupBy)}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{group.totals.runs}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatTokens(group.totals.totalTokens)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-foreground-muted">
                      {formatDuration(group.totals.durationMs)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {groupNote && (
                        <span className="mr-2 text-[10px] text-amber-300/80">{groupNote}</span>
                      )}
                      {formatTotalCost(group.totals)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </MetricPanel>
    </div>
  );
}
