'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { computeGoalMetrics } from '@/lib/pm/metrics/goalMetrics';
import { goalsLoadStatusHistory, type GoalStatusHistoryEntry } from '@/lib/tauri/goalHistory';
import { TimingCard, timingRows } from '@/app/components/pm/TimingCard';
import { parseUtcDate } from '@/lib/time/utcStamp';

interface GoalTimingProps {
  goalId: string;
  /** The status shown in the panel — the draft's, which may be ahead of the saved one. */
  status: string;
}

function formatSince(changedAt: string): string {
  const date = parseUtcDate(changedAt);
  if (!date) return changedAt;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * How long this goal sat in each status, how often it went into review, and
 * cycle/lead once achieved. Reads the saved history — Rust records it when the
 * goal is saved — so it reloads whenever the saved goal changes.
 */
export function GoalTiming({ goalId, status }: GoalTimingProps) {
  const rootPath = useStore((s) => s.rootPath);
  // A primitive, so the selector stays stable: re-fetch on every saved change,
  // including ones an agent made through MCP and the store picked up.
  const savedRevision = useStore((s) => {
    const saved = s.goals.find((g) => g.id === goalId);
    return saved ? `${saved.status}|${saved.updatedAt}` : null;
  });
  const [history, setHistory] = useState<GoalStatusHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    goalsLoadStatusHistory(rootPath, goalId)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch(() => {
        // Browser mode or a closed project: there is no history to show.
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath, goalId, savedRevision]);

  const metrics = useMemo(
    () => (history ? computeGoalMetrics(history, status) : null),
    [history, status]
  );
  if (!metrics || metrics.trackedSince === null) return null;

  const rows = timingRows(
    metrics,
    metrics.reviewRounds > 0
      ? [{ label: 'Review rounds', value: String(metrics.reviewRounds) }]
      : []
  );

  const note = metrics.backfilled
    ? `Tracked since ${formatSince(metrics.trackedSince)}. Earlier status changes were not recorded.`
    : undefined;

  return <TimingCard rows={rows} note={note} />;
}
