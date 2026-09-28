'use client';

export function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface TimingRow {
  label: string;
  value: string;
}

interface TimingCardProps {
  rows: TimingRow[];
  /** A caveat under the figures, e.g. where the record starts. */
  note?: string;
}

/** The "Timing" box shared by tickets and goals. Renders nothing without rows. */
export function TimingCard({ rows, note }: TimingCardProps) {
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-muted mb-2">
        Timing
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {/* A status can appear twice: once as "now", once as an earlier spell. */}
        {rows.map((row, index) => (
          <div key={`${index}-${row.label}`} className="contents">
            <dt className="text-foreground-muted">{row.label}</dt>
            <dd className="text-right text-foreground tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-[11px] text-foreground-muted">{note}</p>}
    </div>
  );
}
