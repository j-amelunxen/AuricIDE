'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { formatAgentDuration } from '@/lib/agents/duration';
import { useNow } from '@/lib/hooks/useNow';
import {
  ageMs,
  formatPercent,
  msUntilReset,
  providerName,
  quotaTone,
  type QuotaTone,
} from '@/lib/usage/quota';
import type { UsageSnapshot } from '@/lib/usage/types';

const TONE_TEXT: Record<QuotaTone, string> = {
  calm: 'text-foreground',
  warn: 'text-amber-300',
  critical: 'text-red-300',
};

const TONE_BAR: Record<QuotaTone, string> = {
  calm: 'bg-primary/60',
  warn: 'bg-amber-400/70',
  critical: 'bg-red-400/70',
};

/**
 * The detail behind the chip: every window, when each one resets, and — the
 * part that is not decoration — how old the reading is.
 *
 * Nothing here is live. The Claude figure only arrives while one of AuricIDE's
 * own agents is running, and the Codex one is re-read when you ask, so a bare
 * percentage with no age next to it would be a claim the data cannot support.
 */
export function CliQuotaPopover({
  id,
  snapshots,
  refreshing,
  onRefresh,
}: {
  id: string;
  snapshots: UsageSnapshot[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  // The shared clock lives here rather than in the chip: this is the smallest
  // component that actually shows a second-by-second number, and hoisting it
  // would re-render the whole status bar once a second.
  const now = useNow();
  const hasClaude = snapshots.some((snapshot) => snapshot.provider === 'claude');

  return (
    <div
      id={id}
      data-testid="cli-quota-popover"
      /* Not `role="tooltip"`: it holds the refresh button, and a tooltip that
         owns the only control for a thing is a contradiction — it is the
         disclosure the chip's aria-expanded refers to. */
      className="absolute right-0 bottom-full mb-2 z-[var(--z-tool)] w-64 rounded-lg border border-white/10 bg-[#0a0a10] p-3 shadow-2xl animate-in fade-in zoom-in duration-150"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wide text-foreground-muted">CLI quota</span>
        <button
          type="button"
          data-testid="cli-quota-refresh"
          aria-label="Refresh CLI quota"
          disabled={refreshing}
          onClick={onRefresh}
          className="rounded p-0.5 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-50"
        >
          <AuricIcon name="refresh" className={`text-[12px] ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {snapshots.map((snapshot) => (
          <section key={snapshot.provider} className="flex flex-col gap-1.5">
            <header className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">
                {providerName(snapshot.provider)}
              </span>
              {snapshot.planLabel && (
                <span className="text-[9px] uppercase tracking-wide text-foreground-muted">
                  {snapshot.planLabel}
                </span>
              )}
            </header>

            {snapshot.windows.map((window) => {
              const tone = quotaTone(window.usedPercent);
              const remaining = msUntilReset(window.resetsAt, now);
              return (
                <div
                  key={`${window.limitId}-${window.windowMinutes}`}
                  className="flex flex-col gap-1"
                >
                  <div className="flex items-baseline justify-between gap-2 text-[10px]">
                    <span className="text-foreground-muted">
                      {window.limitLabel ? `${window.limitLabel} · ${window.label}` : window.label}
                    </span>
                    <span className={`font-mono ${TONE_TEXT[tone]}`}>
                      {formatPercent(window.usedPercent)}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${TONE_BAR[tone]}`}
                      style={{ width: `${Math.min(100, Math.max(0, window.usedPercent))}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-foreground-muted">
                    {/* A window whose reset time has already passed has not been
                        re-read yet — saying "due" beats a countdown at zero. */}
                    {remaining > 0 ? `resets in ${formatAgentDuration(remaining)}` : 'reset due'}
                  </span>
                </div>
              );
            })}

            {snapshot.credits && (
              <span className="text-[9px] text-foreground-muted">
                {snapshot.credits.unlimited
                  ? 'credits: unlimited'
                  : `credits: ${snapshot.credits.balance}`}
              </span>
            )}

            <span className="text-[9px] text-foreground-muted/70">
              read {formatAgentDuration(ageMs(snapshot.observedAt, now))} ago
            </span>
          </section>
        ))}

        {!hasClaude && (
          <section className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-foreground">Claude Code</span>
            <span className="text-[9px] text-foreground-muted">
              No reading yet. Claude only reports quota while an interactive Claude agent is running
              — headless runs never write one.
            </span>
          </section>
        )}
      </div>
      <div className="absolute right-3 top-full border-8 border-transparent border-t-[#0a0a10]" />
    </div>
  );
}
