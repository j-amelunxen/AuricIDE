'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useStore } from '@/lib/store';
import { ccUsagePlugins } from '@/lib/usage/ccUsage';
import { onUsageLimitsChanged } from '@/lib/tauri/usageEvents';
import { chipGroups, formatPercent, overallTone, type QuotaTone } from '@/lib/usage/quota';
import { CliQuotaPopover } from './CliQuotaPopover';
import { UsageReportModal } from './UsageReportModal';

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

const POPOVER_ID = 'cli-quota-detail';

/**
 * How much of the agent CLIs' quota is gone, in the status bar.
 *
 * Deliberately quiet. It goes amber and red as a window fills, but it is not
 * the signal that interrupts — that is the agent attention chip in the header,
 * and a second thing competing for the same colour would blunt it. This one is
 * here to be glanced at, not to be reacted to.
 *
 * Every window a provider reported is named and shown — `CC 5h 4% · 7d 61%` —
 * rather than only the one closest to running out. The two say different
 * things: a spent five-hour session refills by itself within the afternoon, a
 * spent week does not, and one figure cannot stand for both. Each keeps its own
 * tone so a calm session is not painted red by the week beside it.
 *
 * Beside it sits the way into the usage report, as its own control rather than
 * as a second meaning for the chip's click. The two answer different questions
 * — how full the window is now, versus what a period actually consumed — and a
 * single button that did both would make which one you get depend on how you
 * pressed it.
 *
 * Nothing to say means nothing rendered: the feature switched off, an
 * API-key account, or no reading yet all produce no quota chip rather than a
 * zero. The report button has its own condition and can appear alone.
 */
export function CliQuotaChip() {
  const snapshots = useStore((s) => s.usageSnapshots);
  const usageStatus = useStore((s) => s.usageStatus);
  const loadUsageLimits = useStore((s) => s.loadUsageLimits);
  const refreshUsageLimits = useStore((s) => s.refreshUsageLimits);
  // Two reasons to be open, tracked apart. Folding them into one flag would
  // make a click close the popover under a mouse user who is still hovering
  // it, because a click focuses the chip first and would toggle the same flag.
  const [hovered, setHovered] = useState(false);
  const [stickyOpen, setStickyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportAvailable, setReportAvailable] = useState(false);
  const open = hovered || stickyOpen;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Listening on the document, not the wrapper: content shown on hover has
    // to be dismissible without the pointer moving, and in that case nothing
    // inside the chip is focused for a key event to bubble through.
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHovered(false);
      setStickyOpen(false);
      if (wrapperRef.current?.contains(document.activeElement)) chipRef.current?.focus();
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [open]);

  useEffect(() => {
    // Stored readings only. A Codex check costs credits, so mount, hover and
    // focus never spawn one — the 15-minute poller in Rust writes the store
    // and we pick the new numbers up through the change event.
    void loadUsageLimits();
  }, [loadUsageLimits]);

  useEffect(() => {
    // The Claude reading is written by a running agent's status line, which
    // this side would otherwise never notice landing.
    return onUsageLimitsChanged(() => {
      void loadUsageLimits();
    });
  }, [loadUsageLimits]);

  useEffect(() => {
    // Only asks which plugins exist — no transcript is read until the panel is
    // actually opened, so this costs nothing at startup.
    let cancelled = false;
    ccUsagePlugins()
      .then((plugins) => {
        if (!cancelled) setReportAvailable(plugins.some((plugin) => plugin.available));
      })
      .catch(() => {
        // Browser mode, or a backend without the command. Offering a button
        // that cannot open anything is worse than offering none.
        if (!cancelled) setReportAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = chipGroups(snapshots);
  const tone = overallTone(snapshots);
  const withWindows = snapshots.filter((snapshot) => snapshot.windows.length > 0);

  if (groups.length === 0 && !reportAvailable) return null;

  return (
    <div className="flex items-center gap-2">
      {groups.length > 0 && (
        <div
          ref={wrapperRef}
          className="relative flex items-center"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          // Only focus crossing the wrapper's edge counts. Moving between the chip
          // and the popover's refresh button is neither an arrival nor a
          // departure — and treating it as one would close the popover under the
          // keyboard user reaching for that button, or reopen what Escape just
          // dismissed when focus is handed back to the chip.
          onFocus={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setStickyOpen(true);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setStickyOpen(false);
          }}
        >
          <button
            ref={chipRef}
            type="button"
            data-testid="cli-quota-chip"
            aria-expanded={open}
            aria-controls={POPOVER_ID}
            onClick={() => setStickyOpen((wasOpen) => !wasOpen)}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            {/* No aria-label: it would override the figures below, and those are
                the whole point — the chip would announce itself as "Agent CLI
                quota" and say nothing about the quota. */}
            <span className="sr-only">Agent CLI quota: </span>
            <span
              data-testid="cli-quota-dot"
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${DOT_TONE[tone]}`}
            />
            <span className="flex items-center gap-2 font-mono">
              {groups.map((group, index) => (
                <span key={group.provider} className="flex items-center gap-2">
                  {/* The tag alone separates two providers poorly once each carries
                      two figures, so they get the divider the status bar already
                      uses elsewhere. */}
                  {index > 0 && <span aria-hidden="true" className="h-3 w-[1px] bg-white/10" />}
                  {/* The separators are text rather than flex gaps: a screen reader
                      reading `CC5h 4%7d 61%` off one element helps nobody. */}
                  <span>
                    {group.tag}{' '}
                    {group.windows.map((window, windowIndex) => (
                      <Fragment key={window.kind}>
                        {windowIndex > 0 && <span className="text-foreground-muted/50"> · </span>}
                        <span
                          data-testid={`cli-quota-window-${group.provider}-${window.kind}`}
                          className={TEXT_TONE[window.tone]}
                        >
                          {window.label} {formatPercent(window.usedPercent)}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                </span>
              ))}
            </span>
          </button>

          {open && (
            <CliQuotaPopover
              id={POPOVER_ID}
              snapshots={withWindows}
              refreshing={usageStatus === 'loading'}
              onRefresh={() => void refreshUsageLimits()}
            />
          )}
        </div>
      )}

      {reportAvailable && (
        <button
          type="button"
          data-testid="usage-report-open"
          aria-label="Open usage report"
          aria-haspopup="dialog"
          onClick={() => setReportOpen(true)}
          className="flex items-center text-foreground-muted transition-colors hover:text-foreground"
        >
          <AuricIcon name="analytics" className="text-[13px]" />
        </button>
      )}

      <UsageReportModal isOpen={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
