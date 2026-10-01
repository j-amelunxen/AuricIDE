import type { PmGoal } from '@/lib/tauri/goals';
import { GOAL_STATUSES, PRIORITIES, type GoalStatusValue, type Priority } from '@/lib/pm/enums';
import type { ContextMenuOption } from '@/app/components/ide/ContextMenu';
import {
  getGoalChildren,
  getGoalDescendants,
  getRootGoals,
  planGoalMove,
} from '@/lib/store/goals/goalTreeHelpers';

/** One goal and the fields to change on it. */
export interface GoalBulkUpdate {
  id: string;
  updates: Partial<PmGoal>;
}

export interface ParentChoice {
  /** `null` is the top level. */
  id: string | null;
  label: string;
  depth: number;
}

export interface BulkOffer {
  count: number;
  sharedStatus: GoalStatusValue | null;
  /** Statuses to switch to: empty when the selection does not share one. */
  statusChoices: GoalStatusValue[];
  statusBlockedReason: string | null;
  sharedPriority: Priority | null;
  parentChoices: ParentChoice[];
  parentBlockedReason: string | null;
}

export type BulkMenuStage = 'root' | 'parent';

export interface BulkMenuHandlers {
  onApply: (updates: GoalBulkUpdate[]) => void;
  onOpenParentStage: () => void;
  onBack: () => void;
}

const STATUS_LABELS: Record<GoalStatusValue, string> = {
  draft: 'Draft',
  active: 'Active',
  in_progress: 'In Progress',
  in_review: 'In Review',
  achieved: 'Achieved',
  failed: 'Failed',
  archived: 'Archived',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

/**
 * Plain click replaces the selection, Shift-click calls this: it toggles one
 * goal. The focused goal (the one the detail panel shows) is always part of the
 * set, so Shift-clicking a second goal extends from it rather than replacing it.
 */
export function toggleGoalSelection(
  selected: ReadonlySet<string>,
  focusId: string | null,
  clickedId: string
): { ids: Set<string>; focusId: string | null } {
  const ids = new Set(selected);
  if (focusId) ids.add(focusId);
  if (ids.has(clickedId)) {
    ids.delete(clickedId);
    if (focusId !== clickedId) return { ids, focusId };
    const [remaining] = ids;
    return { ids, focusId: remaining ?? null };
  }
  ids.add(clickedId);
  return { ids, focusId: clickedId };
}

/** Selected goals that have no selected ancestor: moving them carries the rest along. */
function topmostSelected(goals: PmGoal[], ids: readonly string[]): PmGoal[] {
  const selected = new Set(ids);
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  return goals.filter((goal) => {
    if (!selected.has(goal.id)) return false;
    for (
      let parent = goal.parentId ? byId.get(goal.parentId) : undefined;
      parent;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    ) {
      if (selected.has(parent.id)) return false;
    }
    return true;
  });
}

function parentChoicesFor(goals: PmGoal[], ids: readonly string[]): ParentChoice[] {
  const movers = topmostSelected(goals, ids);
  const blocked = new Set(ids);
  for (const mover of movers) {
    for (const descendant of getGoalDescendants(goals, mover.id)) blocked.add(descendant.id);
  }
  const alreadyThere = (parentId: string | null) =>
    movers.every((mover) => (mover.parentId ?? null) === parentId);

  const choices: ParentChoice[] = [];
  if (movers.length > 0 && !alreadyThere(null)) {
    choices.push({ id: null, label: 'Top level', depth: 0 });
  }
  const walk = (goal: PmGoal, depth: number) => {
    if (blocked.has(goal.id)) return;
    if (!alreadyThere(goal.id)) choices.push({ id: goal.id, label: goal.name, depth });
    for (const child of getGoalChildren(goals, goal.id)) walk(child, depth + 1);
  };
  for (const root of getRootGoals(goals)) walk(root, 0);
  return choices;
}

/** What a right-click on a multi-selection may offer: only what is valid for ALL of it. */
export function describeBulkOffer(goals: PmGoal[], ids: readonly string[]): BulkOffer {
  const selected = goals.filter((goal) => ids.includes(goal.id));
  const statuses = new Set(selected.map((goal) => goal.status));
  const priorities = new Set(selected.map((goal) => goal.priority));
  const sharedStatus = statuses.size === 1 ? [...statuses][0] : null;
  const parentChoices = parentChoicesFor(goals, ids);

  return {
    count: selected.length,
    sharedStatus,
    statusChoices: sharedStatus ? GOAL_STATUSES.filter((status) => status !== sharedStatus) : [],
    statusBlockedReason: sharedStatus ? null : 'Statuses differ - select goals with one status',
    sharedPriority: priorities.size === 1 ? [...priorities][0] : null,
    parentChoices,
    parentBlockedReason:
      parentChoices.length > 0 ? null : 'No valid parent - every target is part of the selection',
  };
}

/**
 * Moves the top-most selected goals under `parentId` (`null` = top level),
 * appended behind the existing children. Never builds a cycle: a target inside
 * the selection or its subtree yields no updates at all.
 */
export function planBulkParentChange(
  goals: PmGoal[],
  ids: readonly string[],
  parentId: string | null
): GoalBulkUpdate[] {
  const movers = topmostSelected(goals, ids);
  if (parentId !== null) {
    const forbidden = new Set(ids);
    for (const mover of movers) {
      for (const d of getGoalDescendants(goals, mover.id)) forbidden.add(d.id);
    }
    if (forbidden.has(parentId) || !goals.some((goal) => goal.id === parentId)) return [];
  }

  if (parentId === null) {
    const roots = getRootGoals(goals);
    let next = Math.max(-1, ...roots.map((root) => root.sortOrder)) + 1;
    return movers
      .filter((mover) => mover.parentId !== null)
      .map((mover) => ({ id: mover.id, updates: { parentId: null, sortOrder: next++ } }));
  }

  // planGoalMove re-densifies siblings against the goals it is given, so each
  // move must see the result of the one before it.
  let current = goals;
  const collected = new Map<string, GoalBulkUpdate>();
  for (const mover of movers) {
    if ((mover.parentId ?? null) === parentId) continue;
    const plan = planGoalMove(current, mover.id, parentId, 'inside');
    const byId = new Map(plan.map((update) => [update.id, update]));
    current = current.map((goal) => {
      const update = byId.get(goal.id);
      return update ? { ...goal, parentId: update.parentId, sortOrder: update.sortOrder } : goal;
    });
    for (const update of plan) {
      collected.set(update.id, {
        id: update.id,
        updates: { parentId: update.parentId, sortOrder: update.sortOrder },
      });
    }
  }
  return [...collected.values()];
}

function applyToAll(
  ids: readonly string[],
  updates: Partial<PmGoal>,
  onApply: BulkMenuHandlers['onApply']
) {
  onApply(ids.map((id) => ({ id, updates })));
}

function parentStageOptions(
  goals: PmGoal[],
  ids: readonly string[],
  offer: BulkOffer,
  handlers: BulkMenuHandlers
): ContextMenuOption[] {
  const options: ContextMenuOption[] = [
    { type: 'header', label: `${offer.count} goals - new parent` },
    { label: 'Back', icon: 'arrow_back', keepOpen: true, action: handlers.onBack },
    { type: 'separator' },
  ];
  for (const choice of offer.parentChoices) {
    options.push({
      label: `${'  '.repeat(choice.depth)}${choice.label}`,
      icon: choice.id === null ? 'vertical_align_top' : 'subdirectory_arrow_right',
      action: () => handlers.onApply(planBulkParentChange(goals, ids, choice.id)),
    });
  }
  return options;
}

export function buildBulkGoalMenuOptions(
  goals: PmGoal[],
  ids: readonly string[],
  stage: BulkMenuStage,
  handlers: BulkMenuHandlers
): ContextMenuOption[] {
  const offer = describeBulkOffer(goals, ids);
  if (stage === 'parent') return parentStageOptions(goals, ids, offer, handlers);

  const options: ContextMenuOption[] = [
    { type: 'header', label: `${offer.count} goal${offer.count === 1 ? '' : 's'}` },
  ];

  options.push({ type: 'header', label: 'Status' });
  if (offer.statusBlockedReason) {
    options.push({ type: 'header', label: offer.statusBlockedReason });
  }
  for (const status of offer.statusChoices) {
    options.push({
      label: STATUS_LABELS[status],
      action: () => applyToAll(ids, { status }, handlers.onApply),
    });
  }

  options.push({ type: 'separator' }, { type: 'header', label: 'Priority' });
  for (const priority of PRIORITIES) {
    options.push({
      label: PRIORITY_LABELS[priority],
      icon: offer.sharedPriority === priority ? 'check' : undefined,
      action: () => applyToAll(ids, { priority }, handlers.onApply),
    });
  }

  options.push({ type: 'separator' }, { type: 'header', label: 'Parent' });
  if (offer.parentBlockedReason) {
    options.push({ type: 'header', label: offer.parentBlockedReason });
  } else {
    options.push({
      label: 'Change parent…',
      icon: 'account_tree',
      keepOpen: true,
      action: handlers.onOpenParentStage,
    });
  }
  return options;
}
