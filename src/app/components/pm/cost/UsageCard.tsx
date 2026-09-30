'use client';

import { useMemo } from 'react';
import { formatDuration } from '@/lib/pm/metrics';
import { sumUsage } from '@/lib/pm/usage/aggregate';
import type { AgentUsageRow } from '@/lib/tauri/agentUsage';
import { UsageRunLog } from './UsageRunLog';
import { formatTokens, formatTotalCost, unpricedNote } from './usageFormat';

/** The "Cost" box shared by tickets and goals: the totals, then every run behind them. */
export function UsageCard({ rows }: { rows: readonly AgentUsageRow[] }) {
  const totals = useMemo(() => sumUsage(rows), [rows]);
  const note = unpricedNote(totals);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-muted mb-2">
        Cost
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-foreground-muted">No agent runs recorded yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-foreground-muted">Total</dt>
            <dd className="text-right text-foreground tabular-nums">
              {formatTotalCost(totals)}
              {note && <span className="ml-1.5 text-[10px] text-amber-300/80">{note}</span>}
            </dd>
            <dt className="text-foreground-muted">Tokens</dt>
            <dd className="text-right text-foreground tabular-nums">
              {formatTokens(totals.totalTokens)}
            </dd>
            <dt className="text-foreground-muted">Agent time</dt>
            <dd className="text-right text-foreground tabular-nums">
              {formatDuration(totals.durationMs)}
            </dd>
            <dt className="text-foreground-muted">Runs</dt>
            <dd className="text-right text-foreground tabular-nums">{totals.runs}</dd>
          </dl>
          <UsageRunLog rows={rows} />
        </>
      )}
    </div>
  );
}
