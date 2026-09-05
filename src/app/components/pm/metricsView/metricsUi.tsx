import type React from 'react';

export const BASIS_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Last 5', value: 5 },
  { label: 'Last 10', value: 10 },
  { label: 'Last 20', value: 20 },
  { label: 'All', value: undefined },
];

export const FORECAST_DAYS = 30;
export const CLOCK_TICK_MS = 60_000;
export const DASH = '—';
export const COMPLETED_STATUSES = new Set(['done', 'archived']);

export function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
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

export function MetricPanel({
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

export function ProgressCell({ done, total }: { done: number; total: number }) {
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
