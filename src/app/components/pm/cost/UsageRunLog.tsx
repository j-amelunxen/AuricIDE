'use client';

import { formatDuration } from '@/lib/pm/metrics';
import type { AgentUsageRow, UsageCostSource } from '@/lib/tauri/agentUsage';
import { formatDate } from '../ticketEdit/types';
import { formatRunCost, formatTokens, rowTokens } from './usageFormat';

const SOURCE_BADGE: Record<UsageCostSource, { label: string; className: string }> = {
  cli: { label: 'exact', className: 'bg-emerald-500/15 text-emerald-300' },
  estimated: { label: 'estimated', className: 'bg-amber-500/15 text-amber-300' },
  none: { label: 'no data', className: 'bg-white/10 text-foreground-muted' },
};

const OUTCOME_CLASS: Record<AgentUsageRow['outcome'], string> = {
  success: 'text-green-300',
  error: 'text-red-300',
  killed: 'text-foreground-muted',
};

function formatWhen(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(iso)}, ${time}`;
}

function SourceBadges({ row }: { row: AgentUsageRow }) {
  const badge = SOURCE_BADGE[row.costSource];
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      <span className={`rounded px-1 py-px text-[9px] font-medium ${badge.className}`}>
        {badge.label}
      </span>
      {row.costSource !== 'none' && row.matchKind === 'heuristic' && (
        <span
          className="rounded bg-white/10 px-1 py-px text-[9px] text-foreground-muted"
          title="The transcript was matched by working directory and start time, not by id"
        >
          heuristic match
        </span>
      )}
    </span>
  );
}

/** Every recorded run, newest first, one line each. Shared by tickets and goals. */
export function UsageRunLog({ rows }: { rows: readonly AgentUsageRow[] }) {
  return (
    <div className="mt-3 max-h-56 overflow-auto">
      <table className="w-full border-collapse text-[11px]">
        <caption className="sr-only">Agent runs</caption>
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wider text-foreground-muted">
            <th scope="col" className="pb-1 pr-2 font-medium">
              When
            </th>
            <th scope="col" className="pb-1 pr-2 font-medium">
              Run
            </th>
            <th scope="col" className="pb-1 pr-2 text-right font-medium">
              Tokens
            </th>
            <th scope="col" className="pb-1 pr-2 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="pb-1 pr-2 text-right font-medium">
              Time
            </th>
            <th scope="col" className="pb-1 font-medium">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-white/[0.05] align-top">
              <td className="py-1 pr-2 tabular-nums text-foreground-muted">
                {formatWhen(row.startedAt)}
              </td>
              <td className="py-1 pr-2 text-foreground">
                {row.provider}
                {row.model ? ` · ${row.model}` : ''}
                <SourceBadges row={row} />
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-foreground">
                {formatTokens(rowTokens(row))}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-foreground">
                {formatRunCost(row)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-foreground-muted">
                {formatDuration(row.durationMs)}
              </td>
              <td className={`py-1 ${OUTCOME_CLASS[row.outcome]}`}>{row.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
