'use client';

import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { defaultCommands } from '@/lib/commands/registry';
import { parseNotificationActions } from '@/lib/notifications/types';
import {
  autoConductorLaunches,
  gateRefusalMessage,
  launchScheduledConductor,
  scheduledRunGate,
  type ScheduledRunSnapshot,
} from '@/lib/conductor/scheduledRun';
import { buildScheduledRunDeps } from '@/lib/conductor/scheduledRunDeps';
import { idleForMs, installUserActivityTracker } from '@/lib/ide/userActivity';

const KNOWN_COMMAND_IDS = new Set(defaultCommands.map((command) => command.id));
const isKnownCommandId = (id: string) => KNOWN_COMMAND_IDS.has(id);

/**
 * The zero-click half of scheduled conductor runs: watches the inbox for a
 * fresh, trusted `launch: 'auto'` notification and either starts the run or —
 * if the IDE is not genuinely unattended — leaves it as a button and says why.
 *
 * See `docs/design-scheduled-conductor-runs.md` and `scheduledRunGate` for the
 * rules this defers to; this hook only gathers the live snapshot they need and
 * makes sure each notification is attempted exactly once.
 */
export function useScheduledConductorRuns(openProject: (path: string) => Promise<void>): void {
  const notifications = useStore((s) => s.notifications);
  // Guards against a re-render re-attempting a notification before its
  // `markNotificationRead` write has landed in the store — the primary
  // guard is that write itself (it drops the notification out of
  // `autoConductorLaunches`' "unread" filter), this is the belt for the
  // in-between render.
  const attempted = useRef(new Set<string>());

  useEffect(() => installUserActivityTracker(window), []);

  useEffect(() => {
    const candidates = autoConductorLaunches(
      notifications,
      (n) => parseNotificationActions(n.actions, isKnownCommandId),
      Date.now()
    );

    for (const { notification, action } of candidates) {
      if (attempted.current.has(notification.uid)) continue;
      attempted.current.add(notification.uid);

      const store = useStore.getState();
      const snapshot: ScheduledRunSnapshot = {
        rootPath: store.rootPath,
        conductorRunning: store.conductorRunning,
        runningAgentCount: store.agents.filter(
          (a) => a.status === 'running' || a.status === 'queued'
        ).length,
        dirtyTabCount: store.openTabs.filter((t) => t.isDirty).length,
        idleForMs: idleForMs(),
      };

      const verdict = scheduledRunGate(snapshot, action.repoPath);
      if (!verdict.ok) {
        store.showToast(
          gateRefusalMessage(verdict.reason, notification.origin ?? 'Scheduled run'),
          'info'
        );
        continue;
      }

      void (async () => {
        // Marked read before the run starts: a re-render mid-launch must see
        // this notification as already handled, not as a fresh candidate.
        await store.markNotificationRead(notification.uid);
        await launchScheduledConductor(
          {
            repoPath: action.repoPath,
            ticketBudget: action.ticketBudget,
            maxConcurrent: action.maxConcurrent ?? 1,
            goalId: action.goalId,
            requireReview: action.requireReview ?? false,
            mode: 'direct',
            origin: notification.origin ?? undefined,
          },
          buildScheduledRunDeps(openProject)
        );
      })();
    }
  }, [notifications, openProject]);
}
