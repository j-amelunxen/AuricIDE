import { isFreshOccurrence } from '@/lib/conductor/scheduledRun';
import { describeDependencyBlock } from '@/lib/store/goals/goalDependencyAdapters';
import type { PmGoal, PmGoalDependency } from '@/lib/tauri/goals';
import { decideLaunch } from './launchGate';
import { isLaunchRequest } from './launchRequest';
import type { LaunchGrant } from './launchGrants';
import { notificationTrust } from './trust';
import type { Notification, NotificationAction } from './types';

type AutoAgentAction =
  | Extract<NotificationAction, { kind: 'spawn-agent' }>
  | Extract<NotificationAction, { kind: 'run-skill' }>;

function isEligibleAutoStart(notification: Notification, nowMs: number): boolean {
  return (
    notification.readAt === null &&
    notification.answeredAt === null &&
    notificationTrust(notification) === 'user' &&
    isFreshOccurrence(notification.dedupeKey, nowMs)
  );
}

function isAutoAgentAction(action: NotificationAction): action is AutoAgentAction {
  return (action.kind === 'spawn-agent' || action.kind === 'run-skill') && action.launch === 'auto';
}

/**
 * The `spawn-agent` and `run-skill` actions in a notification batch that
 * qualify for an automatic start: a user-authored payload, still unread and
 * unanswered, whose occurrence is fresh, and whose action explicitly asks for
 * `launch: 'auto'`.
 *
 * Unlike conductor auto-start this does not wait for an idle IDE and does not
 * switch the open project — the agent runs in `repoPath` / `cwd` as it is.
 * Catch-up rows and model-written payloads stay a button.
 */
export function autoAgentLaunches(
  notifications: Notification[],
  parse: (notification: Notification) => NotificationAction[],
  nowMs: number
): Array<{ notification: Notification; action: AutoAgentAction }> {
  const launches: Array<{ notification: Notification; action: AutoAgentAction }> = [];

  for (const notification of notifications) {
    if (!isEligibleAutoStart(notification, nowMs)) continue;

    for (const action of parse(notification)) {
      if (isAutoAgentAction(action)) {
        launches.push({ notification, action });
      }
    }
  }

  return launches;
}

/**
 * Why an automatic goal launch must wait, or null when it may proceed. Only
 * `spawn-agent` actions carry a `goalId`; a `run-skill` action is never a goal
 * launch and is never held back by this. The reason is the same "waits for
 * <name>" wording `describeDependencyBlock` gives the run-blocked report, so
 * a toast and a run summary never disagree about why.
 */
export function goalLaunchBlockReason(
  goals: readonly PmGoal[],
  goalDependencies: readonly PmGoalDependency[],
  action: AutoAgentAction
): string | null {
  if (action.kind !== 'spawn-agent' || !action.goalId) return null;
  return describeDependencyBlock(goals, goalDependencies, action.goalId);
}

type SpawnAgentAction = Extract<NotificationAction, { kind: 'spawn-agent' }>;

/** What the grant check needs to know about the IDE right now. */
export interface GrantLaunchContext {
  /** Grants in force as last read from the inbox db, with their usage. */
  grants: LaunchGrant[];
  /**
   * The goal tree of the open project as the UI holds it. Only used to pick
   * which grant to try; the native claim re-checks ancestry in project.db.
   */
  goals: Array<{ id: string; parentId: string | null }>;
  openProjectPath: string | null;
  activeAgents: Array<{ status: string; spawnedByGoalId?: string | null }>;
  nowMs: number;
}

/** SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC; anything else is unreadable. */
function sqliteUtcMs(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/u.test(value)) return null;
  const ms = Date.parse(`${value.slice(0, 19).replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** True when `goalId` is `rootId` or below it. Cycle-safe, bounded by the tree. */
function isUnderRoot(goalId: string, rootId: string, parents: Map<string, string | null>): boolean {
  let current: string | null | undefined = goalId;
  for (let hops = 0; current && hops <= parents.size; hops += 1) {
    // Existence first: a deleted root is not its own root (goal 10).
    if (!parents.has(current)) return false;
    if (current === rootId) return true;
    current = parents.get(current);
  }
  return false;
}

function isLiveForeignRequest(notification: Notification, nowMs: number): boolean {
  if (!isLaunchRequest(notification)) return false;
  if (notificationTrust(notification) !== 'foreign') return false;
  const expires = sqliteUtcMs(notification.expiresAt);
  return !(expires !== null && expires <= nowMs);
}

function grantFor(
  notification: Notification,
  action: SpawnAgentAction,
  ctx: GrantLaunchContext,
  parents: Map<string, string | null>
): LaunchGrant | null {
  const goalId = action.goalId;
  const project = notification.projectPath;
  if (!goalId || goalId !== notification.refId) return null;
  // The folder the agent runs in (the requester's own, or a new worktree of
  // its repo) is checked natively at spawn; here it only has to be named.
  if (!action.repoPath) return null;
  if (!project || ctx.openProjectPath === null || project !== ctx.openProjectPath) return null;

  return (
    ctx.grants.find(
      (grant) => grant.projectPath === project && isUnderRoot(goalId, grant.rootGoalId, parents)
    ) ?? null
  );
}

/**
 * Launch requests (MCP `request_agent_launch`) that Jennifer's grant lets start
 * without a click — the opt-in half of MET-09-trust.
 *
 * Every condition has to hold: the row is an unread, unanswered, unexpired
 * foreign launch request; its goal sits under a granted mission root in the
 * open project; the row and the grant name the same project; the mission has
 * fewer active agents than the grant allows and budget left; and no agent is
 * already running on that goal. A request written before the grant counts like
 * any other (decision Jennifer 2026-09-26). The grant, budget and slot part is
 * `decideLaunch`; this is only a pre-filter. The native claim decides again,
 * atomically, against the grant row and the goal tree in project.db.
 * Trusted rows are not handled here — the schedule rules above cover them,
 * and a grant must not widen what a schedule may do.
 *
 * Whatever passes still starts as `foreign` (see the hook): the grant decides
 * *that* an agent starts, never how much it may do.
 */
export function grantedAgentLaunches(
  notifications: Notification[],
  parse: (notification: Notification) => NotificationAction[],
  ctx: GrantLaunchContext
): Array<{ notification: Notification; action: SpawnAgentAction; grant: LaunchGrant }> {
  const parents = new Map(ctx.goals.map((goal) => [goal.id, goal.parentId]));
  const active = ctx.activeAgents.filter((a) => a.status === 'running' || a.status === 'queued');
  const busyGoals = new Set(active.map((a) => a.spawnedByGoalId).filter(Boolean) as string[]);
  const startedPerGrant = new Map<string, number>();
  const launches: Array<{
    notification: Notification;
    action: SpawnAgentAction;
    grant: LaunchGrant;
  }> = [];

  for (const notification of notifications) {
    if (!isLiveForeignRequest(notification, ctx.nowMs)) continue;
    const action = parse(notification).find(
      (entry): entry is SpawnAgentAction => entry.kind === 'spawn-agent'
    );
    if (!action?.goalId || busyGoals.has(action.goalId)) continue;
    const grant = grantFor(notification, action, ctx, parents);

    const started = grant ? (startedPerGrant.get(grant.id) ?? 0) : 0;
    const decision = decideLaunch({
      grant,
      alreadyClaimed: notification.readAt !== null || notification.answeredAt !== null,
      used: grant ? grant.launchesUsed + started : 0,
      held: grant
        ? active.filter(
            (a) => a.spawnedByGoalId && isUnderRoot(a.spawnedByGoalId, grant.rootGoalId, parents)
          ).length + started
        : 0,
    });
    if (decision !== 'start' || !grant) continue;

    startedPerGrant.set(grant.id, started + 1);
    busyGoals.add(action.goalId);
    launches.push({ notification, action, grant });
  }

  return launches;
}
