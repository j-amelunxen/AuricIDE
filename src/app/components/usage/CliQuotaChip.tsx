'use client';

import { useEffect, useState } from 'react';

import { useStore } from '@/lib/store';
import { onUsageLimitsChanged } from '@/lib/tauri/usageEvents';
import { chipSegments, formatPercent, overallTone, type QuotaTone } from '@/lib/usage/quota';
import { CliQuotaPopover } from './CliQuotaPopover';

const DOT_TONE: Record<QuotaTone, string> = {
  calm: 'bg-primary/70 shadow-[0_0_6px_rgba(99,102,241,0.4)]',
  warn: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]',
  critical: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]',
};

const TEXT_TONE: Record<QuotaTone, string> = {
  calm: '',
  warn: 'text-amber-300',
  critical: 'text-red-300',
};

/**
 * How much of the agent CLIs' quota is gone, in the status bar.
 *
 * Deliberately quiet. It goes amber and red as a window fills, but it is not
 * the signal that interrupts — that is the agent attention chip in the header,
 * and a second thing competing for the same colour would blunt it. This one is
 * here to be glanced at, not to be reacted to.
 *
 * Nothing to say means nothing rendered: the feature switched off, an
 * API-key account, or no reading yet all produce no chip rather than a zero.
 */
export function CliQuotaChip() {
  const snapshots = useStore((s) => s.usageSnapshots);
  const loadUsageLimits = useStore((s) => s.loadUsageLimits);
  const refreshUsageLimits = useStore((s) => s.refreshUsageLimits);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // The stored reading first, so the chip can appear before any process runs,
    // then a refresh for anything that has aged out.
    void loadUsageLimits().then(() => refreshUsageLimits());
  }, [loadUsageLimits, refreshUsageLimits]);

  useEffect(() => {
    // The Claude reading is written by a running agent's status line, which
    // this side would otherwise never notice landing.
    return onUsageLimitsChanged(() => {
      void loadUsageLimits();
    });
  }, [loadUsageLimits]);

  useEffect(() => {
    // Coming back to the window is the moment the number is most likely to be
    // out of date. The backend's TTL decides whether this actually costs a
    // process, so it is safe to ask every time.
    const onFocus = () => void refreshUsageLimits();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshUsageLimits]);

  const segments = chipSegments(snapshots);
  if (segments.length === 0) return null;

  const tone = overallTone(snapshots);
  const withWindows = snapshots.filter((snapshot) => snapshot.windows.length > 0);

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => {
        setOpen(true);
        void refreshUsageLimits();
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        data-testid="cli-quota-chip"
        aria-label="Agent CLI quota"
        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
      >
        <span
          data-testid="cli-quota-dot"
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${DOT_TONE[tone]}`}
        />
        <span className={`font-mono ${TEXT_TONE[tone]}`}>
          {segments
            .map((segment) => `${segment.tag} ${formatPercent(segment.usedPercent)}`)
            .join(' · ')}
        </span>
      </button>

      {open && <CliQuotaPopover snapshots={withWindows} />}
    </div>
  );
}
