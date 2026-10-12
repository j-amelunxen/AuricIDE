import { useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { chipsFor, type RiskChip } from '@/lib/git/review/riskChips';
import type { RiskFlag } from '@/lib/git/review/riskFlags';

const TONE: Record<RiskChip['tone'], string> = {
  high: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  neutral: 'border-white/10 bg-white/5 text-foreground-muted',
};

/** Risk flags as chips. The tooltip and the screen-reader text say why each one was raised. */
export function RiskChips({ flags }: { flags: readonly RiskFlag[] }) {
  const chips = useMemo(() => chipsFor(flags), [flags]);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <span
          key={`${chip.kind}:${chip.label}`}
          data-testid="risk-chip"
          data-kind={chip.kind}
          title={chip.rule}
          className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 font-sans text-[10px] font-medium leading-4 ${TONE[chip.tone]}`}
        >
          {chip.tone === 'high' ? <AuricIcon name="warning" className="text-[11px]" /> : null}
          {chip.label}
          {chip.count > 1 ? <span className="tabular-nums opacity-70">×{chip.count}</span> : null}
          <span className="sr-only">. {chip.rule}</span>
        </span>
      ))}
    </span>
  );
}
