import type { ToastVariant } from '@/lib/store/toastSlice';
import { notificationTrust } from '@/lib/notifications/trust';
import type { Notification, NotificationAction } from '@/lib/notifications/types';

/**
 * A scheduled conductor run: the one place that turns "a notification arrived"
 * into "a run started" without a human clicking anything. Everything here is
 * pure and store-free — the caller supplies state and effects — so the rules
 * that decide whether zero clicks is safe can be tested without a store, and
 * so `NotificationsSidebar`'s manual Start button and the auto-start hook
 * share exactly one implementation of them.
 *
 * See `docs/design-scheduled-conductor-runs.md` for why each rule exists.
 */

/** How long the window must have gone unused before an automatic switch may happen. */
export const UNATTENDED_AFTER_MS = 10 * 60 * 1000;
/** How old a schedule's occurrence may be and still start on arrival. */
export const AUTO_START_FRESHNESS_MS = 15 * 60 * 1000;
/** How long a project switch may take to finish loading before the run gives up. */
export const PROJECT_LOAD_TIMEOUT_MS = 30_000;

export type RunConductorAction = Extract<NotificationAction, { kind: 'run-conductor' }>;

/** What the gate needs to know about the IDE right now. */
export interface ScheduledRunSnapshot {
  rootPath: string | null;
  conductorRunning: boolean;
  /** Agents with status `running` or `queued`. */
  runningAgentCount: number;
  dirtyTabCount: number;
  /** Milliseconds since the last keyboard/pointer input, or since app start. */
  idleForMs: number;
}

export type GateRefusalReason = 'conductor-running' | 'agents-running' | 'dirty-tabs' | 'in-use';

export type GateVerdict =
  { ok: true; needsSwitch: boolean } | { ok: false; reason: GateRefusalReason };

/**
 * Whether an automatic launch may proceed against `targetRepoPath` right now.
 *
 * A run already using the machine — conductor or agent — always refuses,
 * before the target project is even considered: two overlapping runs must
 * never fight, and neither may interrupt an implementer that is mid-task. The
 * target project being the one already open needs no idle or dirty-tab check
 * at all — that is not a switch, so nothing about it is unattended. Opening
 * into an empty IDE is the same: there are no tabs to lose. Only switching
 * *away* from a different open project costs something (every tab closes),
 * so only that path is gated on both being clean and the window having gone
 * unused for the full unattended window.
 */
export function scheduledRunGate(
  snapshot: ScheduledRunSnapshot,
  targetRepoPath: string
): GateVerdict {
  if (snapshot.conductorRunning) return { ok: false, reason: 'conductor-running' };
  if (snapshot.runningAgentCount > 0) return { ok: false, reason: 'agents-running' };
  if (snapshot.rootPath === targetRepoPath) return { ok: true, needsSwitch: false };
  if (snapshot.rootPath === null) return { ok: true, needsSwitch: true };
  if (snapshot.dirtyTabCount > 0) return { ok: false, reason: 'dirty-tabs' };
  if (snapshot.idleForMs < UNATTENDED_AFTER_MS) return { ok: false, reason: 'in-use' };
  return { ok: true, needsSwitch: true };
}

/** Human sentence for why an automatic launch stayed a button instead. */
export function gateRefusalMessage(reason: GateRefusalReason, scheduleName: string): string {
  const why: Record<GateRefusalReason, string> = {
    'conductor-running': 'another conductor run is already active',
    'agents-running': 'an agent is already running',
    'dirty-tabs': 'you have unsaved changes open',
    'in-use': "the IDE looks like it's still in use",
  };
  return `"${scheduleName}" is waiting for you: ${why[reason]}.`;
}

const SCHEDULE_DEDUPE_KEY = /^schedule:.+:(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})$/;

/** The occurrence time encoded in a schedule dedupe key, read as UTC. */
export function scheduleOccurrenceMs(dedupeKey: string | null): number | null {
  if (dedupeKey === null) return null;
  const match = SCHEDULE_DEDUPE_KEY.exec(dedupeKey);
  if (!match) return null;
  const ms = Date.parse(`${match[1].replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether a schedule occurrence is recent enough to start by itself.
 *
 * A catch-up notification for a schedule that fired hours or days ago (the
 * app was closed) must never launch into whatever the user is doing now — it
 * stays a button. A one-minute future allowance absorbs ordinary clock skew
 * between the scheduler and the reader without opening the door to a stale
 * occurrence.
 */
export function isFreshOccurrence(dedupeKey: string | null, nowMs: number): boolean {
  const occurredAt = scheduleOccurrenceMs(dedupeKey);
  if (occurredAt === null) return false;
  const ageMs = nowMs - occurredAt;
  return ageMs >= -60_000 && ageMs <= AUTO_START_FRESHNESS_MS;
}

/**
 * The `run-conductor` actions in a notification batch that qualify for an
 * automatic start: a user-authored payload (never an agent's), still unread
 * and unanswered, whose occurrence is fresh, and whose action explicitly asks
 * for `launch: 'auto'` — every other launch mode stays a click.
 */
export function autoConductorLaunches(
  notifications: Notification[],
  parse: (notification: Notification) => NotificationAction[],
  nowMs: number
): Array<{ notification: Notification; action: RunConductorAction }> {
  const launches: Array<{ notification: Notification; action: RunConductorAction }> = [];

  for (const notification of notifications) {
    if (notification.readAt !== null) continue;
    if (notification.answeredAt !== null) continue;
    if (notificationTrust(notification.source) !== 'user') continue;
    if (!isFreshOccurrence(notification.dedupeKey, nowMs)) continue;

    for (const action of parse(notification)) {
      if (action.kind === 'run-conductor' && action.launch === 'auto') {
        launches.push({ notification, action });
      }
    }
  }

  return launches;
}

/** What `launchScheduledConductor` needs to know about the IDE to open a project into. */
export interface ScheduledRunState {
  rootPath: string | null;
  pmLoading: boolean;
  goalsLoading: boolean;
  conductorRunning: boolean;
}

/**
 * The operations a scheduled (or manually clicked) conductor run needs,
 * injected so the launcher stays testable without a store. `NotificationsSidebar`
 * and the auto-start hook build these from the real store through the single
 * factory in `scheduledRunDeps.ts` — two copies here would let the button and
 * the automatic path start a run differently.
 */
export interface ScheduledRunDeps {
  getState: () => ScheduledRunState;
  openProject: (path: string) => Promise<void>;
  /** Polls `pred` until it is true or `timeoutMs` elapses; resolves whether it succeeded. */
  waitUntil: (pred: () => boolean, timeoutMs: number) => Promise<boolean>;
  startConductor: (
    goalId: string | null,
    options?: {
      ticketBudget?: number;
      maxConcurrent?: number;
      requireReview?: boolean;
      origin?: string;
    }
  ) => void;
  conductorTick: () => Promise<void>;
  /** Pre-fills the Conductor panel for a human to press Start themselves. */
  prepareConductorPanel: (input: {
    goalId: string | null;
    maxConcurrent: number;
    requireReview: boolean;
  }) => void;
  toast: (message: string, variant?: ToastVariant) => void;
}

export interface LaunchScheduledConductorInput {
  repoPath: string;
  ticketBudget: number;
  maxConcurrent: number;
  goalId?: string;
  requireReview: boolean;
  mode: 'direct' | 'dialog';
  origin?: string;
}

/**
 * Opens `repoPath` if it is not already the open project, waits for it to
 * finish loading, then either starts the run (`mode: 'direct'`) or pre-fills
 * the Conductor panel for a human to press Start (`mode: 'dialog'`).
 *
 * A conductor that is already running is never restarted or pulled out from
 * under: `startConductor` resets the run's bookkeeping, which would orphan the
 * implementers the previous run launched, and switching projects would do the
 * same to its ticket state. So while a run is active, a click that would start
 * one or switch away is answered with a toast and nothing else — the same
 * refusal the automatic path gets from `scheduledRunGate`. Only pre-filling
 * the panel in the project that is already open is harmless enough to allow.
 *
 * The wait checks the target path AND both load flags together — checking
 * only the path would let the run start against a project whose tickets and
 * goals have not arrived yet, because `openProject` returns before its own
 * fire-and-forget loads do.
 */
export async function launchScheduledConductor(
  input: LaunchScheduledConductorInput,
  deps: ScheduledRunDeps
): Promise<'started' | 'prepared' | 'timeout' | 'busy'> {
  const before = deps.getState();
  const needsSwitch = before.rootPath !== input.repoPath;
  if (before.conductorRunning && (needsSwitch || input.mode === 'direct')) {
    deps.toast('A conductor run is already active — stop it before starting another', 'info');
    return 'busy';
  }

  if (needsSwitch) {
    await deps.openProject(input.repoPath);
    const loaded = await deps.waitUntil(() => {
      const state = deps.getState();
      return state.rootPath === input.repoPath && !state.pmLoading && !state.goalsLoading;
    }, PROJECT_LOAD_TIMEOUT_MS);
    if (!loaded) {
      deps.toast('Project did not finish loading; the run was not started', 'error');
      return 'timeout';
    }
  }

  if (input.mode === 'dialog') {
    deps.prepareConductorPanel({
      goalId: input.goalId ?? null,
      maxConcurrent: input.maxConcurrent,
      requireReview: input.requireReview,
    });
    return 'prepared';
  }

  deps.startConductor(input.goalId ?? null, {
    ticketBudget: input.ticketBudget,
    maxConcurrent: input.maxConcurrent,
    requireReview: input.requireReview,
    origin: input.origin,
  });
  void deps.conductorTick();
  deps.toast(
    `Conductor started · up to ${input.ticketBudget} ticket${input.ticketBudget === 1 ? '' : 's'}`,
    'success'
  );
  return 'started';
}
