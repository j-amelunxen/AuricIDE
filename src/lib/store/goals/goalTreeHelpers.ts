import type { PmGoal } from '../../tauri/goals';

export function getRootGoals(goals: PmGoal[]): PmGoal[] {
  return goals
    .filter((g) => g.parentId === null || g.parentId === undefined)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function getGoalChildren(goals: PmGoal[], parentId: string): PmGoal[] {
  return goals
    .filter((g) => g.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function getGoalDescendants(goals: PmGoal[], goalId: string): PmGoal[] {
  const result: PmGoal[] = [];
  const visited = new Set<string>([goalId]);
  let frontier = [goalId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of getGoalChildren(goals, id)) {
        if (visited.has(child.id)) continue; // guards against corrupted cyclic data
        visited.add(child.id);
        result.push(child);
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return result;
}

export type GoalDropPosition = 'before' | 'inside' | 'after';

export interface GoalMoveUpdate {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/** Plans a tree move while preserving dense sibling ordering and preventing cycles. */
export function planGoalMove(
  goals: PmGoal[],
  draggedId: string,
  targetId: string,
  position: GoalDropPosition
): GoalMoveUpdate[] {
  const dragged = goals.find((goal) => goal.id === draggedId);
  const target = goals.find((goal) => goal.id === targetId);
  if (!dragged || !target || draggedId === targetId) return [];

  const descendants = new Set(getGoalDescendants(goals, draggedId).map((goal) => goal.id));
  if (descendants.has(targetId)) return [];

  const oldParentId = dragged.parentId ?? null;
  const newParentId = position === 'inside' ? target.id : (target.parentId ?? null);
  const newSiblings = goals
    .filter((goal) => (goal.parentId ?? null) === newParentId && goal.id !== draggedId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  const insertionIndex =
    position === 'inside'
      ? newSiblings.length
      : Math.max(
          0,
          newSiblings.findIndex((goal) => goal.id === targetId)
        ) + (position === 'after' ? 1 : 0);
  newSiblings.splice(insertionIndex, 0, dragged);

  const updates = new Map<string, GoalMoveUpdate>();
  newSiblings.forEach((goal, sortOrder) => {
    updates.set(goal.id, { id: goal.id, parentId: newParentId, sortOrder });
  });

  if (oldParentId !== newParentId) {
    goals
      .filter((goal) => (goal.parentId ?? null) === oldParentId && goal.id !== draggedId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
      .forEach((goal, sortOrder) => {
        updates.set(goal.id, { id: goal.id, parentId: oldParentId, sortOrder });
      });
  }

  return [...updates.values()].filter((update) => {
    const original = goals.find((goal) => goal.id === update.id);
    return (
      original &&
      ((original.parentId ?? null) !== update.parentId || original.sortOrder !== update.sortOrder)
    );
  });
}
