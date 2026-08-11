'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { gitLogSince, type CommitInfo } from '@/lib/tauri/git';
import { dbGet, dbSet } from '@/lib/tauri/db';
import { getRootGoals } from '@/lib/store/goalsSlice';
import { detectForks } from '@/lib/evidence/forkDetector';
import type { PmGoalStation } from '@/lib/tauri/goals';

const DISMISS_NS = 'goal_line_fork_dismissals';
const DISMISS_KEY = '_global';

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Unclaimed work: commits appeared that no station claims. The detector
 * proposes, the human decides — Claim turns a cluster into a real station
 * with a git_touches predicate; Dismiss records the prefix and never nags
 * about it again.
 */
export function ForkProposals() {
  const rootPath = useStore((s) => s.rootPath);
  const stations = useStore((s) => s.goalStationsDraft);
  const goalsDraft = useStore((s) => s.goalsDraft);
  const addStation = useStore((s) => s.addStation);
  const saveGoals = useStore((s) => s.saveGoals);

  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    void gitLogSince(rootPath)
      .then((log) => {
        if (!cancelled) setCommits(log);
      })
      .catch(() => {
        // No repo, or browser mode: the detector simply has nothing to say.
      });
    void dbGet(rootPath, DISMISS_NS, DISMISS_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) setDismissed(parsed.filter((p) => typeof p === 'string'));
        } catch {
          // corrupt dismissal memory: start over rather than crash
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const proposals = useMemo(
    () => detectForks(commits, stations, dismissed),
    [commits, stations, dismissed]
  );

  const claimableGoals = useMemo(
    () => getRootGoals(goalsDraft).filter((g) => g.status !== 'archived'),
    [goalsDraft]
  );

  const dismiss = useCallback(
    (prefix: string) => {
      const next = [...dismissed, prefix];
      setDismissed(next);
      if (rootPath) void dbSet(rootPath, DISMISS_NS, DISMISS_KEY, JSON.stringify(next));
    },
    [dismissed, rootPath]
  );

  const claim = useCallback(
    (prefix: string, suggestedName: string) => {
      const goalId = targets[prefix] ?? claimableGoals[0]?.id;
      if (!goalId || !rootPath) return;
      const ts = nowTimestamp();
      const station: PmGoalStation = {
        id: crypto.randomUUID(),
        goalId,
        name: suggestedName,
        kind: 'normal',
        status: 'planned',
        evidenceKind: 'claim',
        predicate: { type: 'git_touches', pathPrefix: prefix, sinceIso: ts },
        evidenceNote: '',
        ticketId: null,
        lane: 0,
        sortOrder: stations.filter((s) => s.goalId === goalId).length,
        lastCheckedAt: null,
        doneAt: null,
        createdAt: ts,
        updatedAt: ts,
      };
      addStation(station);
      void saveGoals(rootPath);
    },
    [targets, claimableGoals, rootPath, stations, addStation, saveGoals]
  );

  if (proposals.length === 0 || claimableGoals.length === 0) return null;

  return (
    <div data-testid="fork-proposals" className="flex flex-col gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground-muted/60">
        Unclaimed work
      </p>
      {proposals.map((p) => (
        <div
          key={p.pathPrefix}
          data-testid={`fork-proposal-${p.pathPrefix}`}
          className="flex flex-wrap items-center gap-2 rounded-xl bg-[#ffce2e]/[0.06] px-3.5 py-2 text-xs"
        >
          <span className="text-foreground">
            {p.commits.length} commit{p.commits.length === 1 ? '' : 's'} in{' '}
            <span className="font-mono">{p.pathPrefix}</span> match no checkpoint
          </span>
          <span className="ml-auto flex items-center gap-2">
            <select
              data-testid={`fork-target-${p.pathPrefix}`}
              value={targets[p.pathPrefix] ?? claimableGoals[0].id}
              onChange={(e) => setTargets((t) => ({ ...t, [p.pathPrefix]: e.target.value }))}
              className="rounded-lg bg-black/30 px-2 py-1 text-[10px] text-foreground outline-none"
              aria-label="Line to claim this work onto"
            >
              {claimableGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              data-testid={`fork-claim-${p.pathPrefix}`}
              onClick={() => claim(p.pathPrefix, p.suggestedName)}
              className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-white/10"
            >
              Make it a checkpoint
            </button>
            <button
              data-testid={`fork-dismiss-${p.pathPrefix}`}
              onClick={() => dismiss(p.pathPrefix)}
              className="rounded-lg px-2 py-1 text-[10px] text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              Noise
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
