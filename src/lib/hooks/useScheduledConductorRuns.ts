'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { defaultCommands } from '@/lib/commands/registry';
import { autoAgentLaunches, grantedAgentLaunches } from '@/lib/notifications/autoLaunch';
import { executeNotificationAction, NotificationActionError } from '@/lib/notifications/execute';
import {
  LAUNCH_GRANTS_CHANGED_EVENT,
  listLaunchGrants,
  type LaunchGrant,
} from '@/lib/notifications/launchGrants';
import {
  notificationsClaimLaunch,
  notificationsReleaseLaunchClaim,
  onNotificationsChanged,
  type LaunchClaimOutcome,
} from '@/lib/tauri/notifications';
import {
  isLaunchRequest,
  launchFailedAnswer,
  launchStartedAnswer,
} from '@/lib/notifications/launchRequest';
import { notificationTrust, type NotificationTrust } from '@/lib/notifications/trust';
import {
  parseNotificationActions,
  type Notification,
  type NotificationAction,
} from '@/lib/notifications/types';
import {
  autoConductorLaunches,
  gateRefusalMessage,
  launchScheduledConductor,
  scheduledRunGate,
  type ScheduledRunSnapshot,
} from '@/lib/conductor/scheduledRun';
import { buildScheduledRunDeps } from '@/lib/conductor/scheduledRunDeps';
import { idleForMs, installUserActivityTracker } from '@/lib/ide/userActivity';
import { isDir } from '@/lib/tauri/fs';

const KNOWN_COMMAND_IDS = new Set(defaultCommands.map((command) => command.id));

/**
 * How long a launch request that was held back (slot taken, possibly by
 * another app instance; claim or grant read failed; goal not under the root
 * in project.db) waits before it is looked at again, even if nothing else
 * changes. The claim is cheap and writes nothing when it refuses.
 */
export const LAUNCH_RETRY_MS = 5_000;

/** Claim answers after which the same request is tried again later. */
const RETRIED_OUTCOMES: ReadonlySet<GrantStartOutcome> = new Set([
  'at-capacity',
  'claim-failed',
  'outside-root',
  'no-grant',
  'budget-spent',
]);
const isKnownCommandId = (id: string) => KNOWN_COMMAND_IDS.has(id);

/**
 * The zero-click half of scheduled launches: watches the inbox for a fresh,
 * trusted `launch: 'auto'` notification.
 *
 * Conductor runs still go through `scheduledRunGate` — they may switch the
 * open project. Custom-agent and skill runs do not: they spawn in the named
 * folder, leave the open project alone, and do not steal the terminal, even
 * while you are typing.
 *
 * See `docs/design-scheduled-conductor-runs.md` and `scheduledRunGate` for the
 * conductor rules; this hook gathers the live snapshot they need and makes
 * sure each notification is attempted exactly once.
 */
export function useScheduledConductorRuns(openProject: (path: string) => Promise<void>): void {
  const notifications = useStore((s) => s.notifications);
  // Guards against a re-render re-attempting a notification before its
  // `markNotificationRead` write has landed in the store — the primary
  // guard is that write itself (it drops the notification out of
  // `autoConductorLaunches`' "unread" filter), this is the belt for the
  // in-between render.
  const attempted = useRef(new Set<string>());
  // Granted launches whose spawn has not returned yet; they count against the
  // grant's limit before the agent shows up in the store.
  const inFlight = useRef(new Map<string, string>());
  // Re-evaluated when agents change, so a request held back at the limit
  // starts once a slot frees up.
  const agents = useStore((s) => s.agents);
  // Grants in force with their usage, as last read from the inbox db. Empty
  // until read, and empty again when a read fails: nothing starts (fail
  // closed) until a retry reads them.
  const grants = useRef<LaunchGrant[]>([]);
  // Bumped when something the grant check depends on changed outside the
  // store: grants re-read, an in-flight start resolved, a retry came due.
  // Without it such a change would wait for an unrelated render.
  const [grantTick, setGrantTick] = useState(0);
  const reevaluate = useCallback(() => setGrantTick((tick) => tick + 1), []);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Requests the claim held back, with the time they may be tried again. Keeps
  // a refusing claim from being repeated on every re-render in between.
  const heldBack = useRef(new Map<string, number>());
  const reloadGrants = useRef<() => void>(() => undefined);
  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(function retry() {
      retryTimer.current = null;
      const now = Date.now();
      for (const [uid, until] of heldBack.current) if (until <= now) heldBack.current.delete(uid);
      reloadGrants.current();
      // A request held back after this timer was set is still cooling down.
      if (heldBack.current.size > 0) retryTimer.current = setTimeout(retry, LAUNCH_RETRY_MS);
    }, LAUNCH_RETRY_MS);
  }, []);

  useEffect(() => installUserActivityTracker(window), []);

  // The grant rows live in the app-global inbox db. They are re-read on this
  // instance's own save or revoke, on every change to the inbox file (another
  // app instance granting, revoking or freeing a slot), after each start
  // under a grant, and on the retry timer.
  useEffect(() => {
    let live = true;
    reloadGrants.current = () => {
      listLaunchGrants()
        .then((list) => {
          if (!live) return;
          grants.current = list;
          reevaluate();
        })
        .catch(() => {
          if (!live) return;
          grants.current = [];
          scheduleRetry();
        });
    };
    reloadGrants.current();
    const reload = () => reloadGrants.current();
    window.addEventListener(LAUNCH_GRANTS_CHANGED_EVENT, reload);
    const unlisten = onNotificationsChanged(reload);
    return () => {
      live = false;
      window.removeEventListener(LAUNCH_GRANTS_CHANGED_EVENT, reload);
      unlisten();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [reevaluate, scheduleRetry]);

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
            judgeForm: action.judgeForm,
            judgeProviderId: action.judgeProviderId,
            judgeModel: action.judgeModel,
            mode: 'direct',
            origin: notification.origin ?? undefined,
          },
          buildScheduledRunDeps(openProject)
        );
      })();
    }

    const agentCandidates = autoAgentLaunches(
      notifications,
      (n) => parseNotificationActions(n.actions, isKnownCommandId),
      Date.now()
    );

    for (const { notification, action } of agentCandidates) {
      if (attempted.current.has(notification.uid)) continue;
      attempted.current.add(notification.uid);
      void startAgentFromNotification(notification, action, notificationTrust(notification));
    }

    // Launch requests an agent sent via MCP, started because Jennifer granted
    // their mission root. Always as `foreign`: the grant decides *that* an
    // agent starts, the payload never decides how much it may do. This pass is
    // a pre-filter; the native claim decides again, atomically, against the
    // grant row and the goal tree in project.db, right before the spawn. A
    // request held back is not marked attempted, so it is looked at again
    // when an agent finishes, the inbox changes or the retry comes due.
    const store = useStore.getState();
    // Requests already attempted here are left out before the batch is
    // counted, so one that is settling cannot take a slot in the count.
    const now = Date.now();
    const granted = grantedAgentLaunches(
      notifications.filter(
        (n) => !attempted.current.has(n.uid) && !((heldBack.current.get(n.uid) ?? 0) > now)
      ),
      (n) => parseNotificationActions(n.actions, isKnownCommandId),
      {
        grants: grants.current,
        goals: store.goalsDraft,
        openProjectPath: store.rootPath,
        activeAgents: [
          ...store.agents,
          ...[...inFlight.current.values()].map((goalId) => ({
            status: 'queued',
            spawnedByGoalId: goalId,
          })),
        ],
        nowMs: now,
      }
    );

    for (const { notification, action, grant } of granted) {
      if (attempted.current.has(notification.uid)) continue;
      attempted.current.add(notification.uid);
      inFlight.current.set(notification.uid, action.goalId ?? '');
      void startUnderGrant(notification, action, grant).then((outcome) => {
        inFlight.current.delete(notification.uid);
        if (RETRIED_OUTCOMES.has(outcome)) {
          heldBack.current.set(notification.uid, Date.now() + LAUNCH_RETRY_MS);
          attempted.current.delete(notification.uid);
          scheduleRetry();
        }
        // Usage changed or a slot may be free: read the grants again, which
        // re-evaluates once they are in.
        reloadGrants.current();
      });
    }
  }, [notifications, agents, openProject, grantTick, scheduleRetry]);
}

type AutoStartAction = Extract<NotificationAction, { kind: 'spawn-agent' | 'run-skill' }>;
type SpawnAgentAction = Extract<NotificationAction, { kind: 'spawn-agent' }>;
type GrantStartOutcome = LaunchClaimOutcome | 'claim-failed' | 'spawn-failed';

/**
 * One automatic start under a grant: claim natively, spawn, and give the slot
 * back if the start did not happen.
 *
 * The claim is the authority (REQ-LAUNCH-01..03): it checks the grant row is
 * still in force for the request's project (a revoke in any app instance is
 * seen), that the goal is under the grant's root in project.db now, and books
 * budget and slot atomically. Fail closed at every step: a claim that errors
 * or any answer but `claimed` means no spawn. A slot is released only for a
 * start that certainly did not happen; a started agent frees its slot when its
 * run is recorded as finished (`record_launch_run_impl`).
 */
async function startUnderGrant(
  notification: Notification,
  action: SpawnAgentAction,
  grant: LaunchGrant
): Promise<GrantStartOutcome> {
  const store = useStore.getState();
  let outcome: LaunchClaimOutcome;
  try {
    outcome = await notificationsClaimLaunch({ requestUid: notification.uid, grantId: grant.id });
  } catch (error) {
    store.showToast(
      `Agent request not started: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    return 'claim-failed';
  }
  if (outcome !== 'claimed') return outcome;

  const started = await startAgentFromNotification(notification, action, 'foreign');
  if (started) return 'claimed';
  await releaseClaim(notification.uid);
  return 'spawn-failed';
}

/** A release that fails leaves the slot taken: stricter, never looser. */
async function releaseClaim(requestUid: string): Promise<void> {
  try {
    await notificationsReleaseLaunchClaim(requestUid);
  } catch {
    // The slot stays held until the app instance restarts (orphan sweep).
  }
}

/**
 * Starts one agent from a notification without a click, and — for a launch
 * request — records on the row which agent it became or why it did not.
 */
async function startAgentFromNotification(
  notification: Notification,
  action: AutoStartAction,
  trust: NotificationTrust
): Promise<boolean> {
  const store = useStore.getState();
  const request = isLaunchRequest(notification);
  await store.markNotificationRead(notification.uid);
  try {
    await executeNotificationAction(
      action,
      {
        spawnAgent: async (config) => {
          const agent = await store.spawnNewAgent(config);
          store.showToast(`${agent.name} started`, 'success');
          if (request)
            await store.answerNotification(notification.uid, launchStartedAnswer(agent.id));
          return agent;
        },
        openSpawnDialog: () => undefined,
        startSkillCombo: async () => undefined,
        projectDirExists: (path) => isDir(path),
        openFile: () => undefined,
        openTicket: () => undefined,
        openGoal: () => undefined,
        openAgent: () => undefined,
        runCommand: () => undefined,
        startConductorRun: async () => undefined,
      },
      {
        fallbackCwd: store.rootPath ?? undefined,
        trust,
        providers: store.providers,
        origin: notification.origin ?? undefined,
        launchRequestUid: request ? notification.uid : undefined,
        launchProjectPath: notification.projectPath ?? undefined,
        notificationUid: notification.uid,
      }
    );
    return true;
  } catch (error) {
    if (request) await store.answerNotification(notification.uid, launchFailedAnswer(error));
    const message =
      error instanceof NotificationActionError && error.code === 'missing-project'
        ? 'Project folder not found'
        : `"${action.label}" could not run`;
    store.showToast(message, 'error');
    return false;
  }
}
