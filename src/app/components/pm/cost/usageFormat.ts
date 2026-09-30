import { formatCost, formatTokens } from '@/lib/usage/breakdown';
import type { UsageTotals } from '@/lib/pm/usage/aggregate';
import type { AgentUsageRow } from '@/lib/tauri/agentUsage';

/** An unknown cost is shown as this, never as $0.00. */
export const NO_PRICE = '—';

export function formatRunCost(row: Pick<AgentUsageRow, 'costUsd'>): string {
  return row.costUsd === null ? NO_PRICE : formatCost(row.costUsd, 'USD');
}

/** A total with no known cost at all reads as unknown, not as free. */
export function formatTotalCost(totals: UsageTotals): string {
  return totals.costKnownRuns === 0 && totals.runs > 0
    ? NO_PRICE
    : formatCost(totals.costUsd, 'USD');
}

export function unpricedNote(totals: UsageTotals): string | null {
  const n = totals.unknownCostRuns;
  return n > 0 ? `+ ${n} ${n === 1 ? 'run' : 'runs'} without price` : null;
}

export function rowTokens(row: AgentUsageRow): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens;
}

export { formatTokens };
