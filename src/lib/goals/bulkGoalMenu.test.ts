import { describe, it, expect, vi } from 'vitest';
import type { PmGoal } from '@/lib/tauri/goals';
import {
  buildBulkGoalMenuOptions,
  describeBulkOffer,
  planBulkParentChange,
  toggleGoalSelection,
} from './bulkGoalMenu';

function goal(id: string, overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id,
    parentId: null,
    name: `Goal ${id}`,
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

// root r1 -> a, b ; root r2 -> c ; root r3
const tree = [
  goal('r1', { sortOrder: 0 }),
  goal('a', { parentId: 'r1', sortOrder: 0 }),
  goal('b', { parentId: 'r1', sortOrder: 1 }),
  goal('r2', { sortOrder: 1 }),
  goal('c', { parentId: 'r2', sortOrder: 0 }),
  goal('r3', { sortOrder: 2 }),
];

describe('toggleGoalSelection', () => {
  it('adds the clicked goal and keeps the focused one in the set', () => {
    const next = toggleGoalSelection(new Set(['a']), 'a', 'b');
    expect([...next.ids].sort()).toEqual(['a', 'b']);
    expect(next.focusId).toBe('b');
  });

  it('removes a goal that is already selected and moves the focus to a remaining one', () => {
    const next = toggleGoalSelection(new Set(['a', 'b']), 'b', 'b');
    expect([...next.ids]).toEqual(['a']);
    expect(next.focusId).toBe('a');
  });

  it('keeps the focus when a non-focused goal is removed', () => {
    const next = toggleGoalSelection(new Set(['a', 'b']), 'a', 'b');
    expect([...next.ids]).toEqual(['a']);
    expect(next.focusId).toBe('a');
  });

  it('starts from the focused goal when the set does not contain it yet', () => {
    const next = toggleGoalSelection(new Set(), 'a', 'b');
    expect([...next.ids].sort()).toEqual(['a', 'b']);
  });

  it('empties the selection when the last goal is removed', () => {
    const next = toggleGoalSelection(new Set(['a']), 'a', 'a');
    expect(next.ids.size).toBe(0);
    expect(next.focusId).toBeNull();
  });
});

describe('describeBulkOffer', () => {
  it('offers status changes only when every selected goal has the same status', () => {
    const same = describeBulkOffer(tree, ['a', 'b']);
    expect(same.sharedStatus).toBe('active');
    expect(same.statusChoices).not.toContain('active');
    expect(same.statusChoices).toContain('achieved');

    const mixed = describeBulkOffer(
      tree.map((g) => (g.id === 'b' ? { ...g, status: 'failed' as const } : g)),
      ['a', 'b']
    );
    expect(mixed.sharedStatus).toBeNull();
    expect(mixed.statusChoices).toEqual([]);
    expect(mixed.statusBlockedReason).toMatch(/differ/i);
  });

  it('marks the shared priority and none when priorities differ', () => {
    expect(describeBulkOffer(tree, ['a', 'b']).sharedPriority).toBe('normal');
    const mixed = tree.map((g) => (g.id === 'a' ? { ...g, priority: 'high' as const } : g));
    expect(describeBulkOffer(mixed, ['a', 'b']).sharedPriority).toBeNull();
  });

  it('never offers the selection itself or its descendants as a new parent', () => {
    const offer = describeBulkOffer(tree, ['r1', 'c']);
    const ids = offer.parentChoices.map((choice) => choice.id);
    expect(ids).not.toContain('r1');
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).not.toContain('c');
    expect(ids).toContain('r2');
    expect(ids).toContain('r3');
  });

  it('offers top level only when somebody is not there yet', () => {
    expect(describeBulkOffer(tree, ['r1', 'r3']).parentChoices.map((c) => c.id)).not.toContain(
      null
    );
    expect(describeBulkOffer(tree, ['a', 'r3']).parentChoices.map((c) => c.id)).toContain(null);
  });

  it('skips a parent that already holds every selected goal', () => {
    const ids = describeBulkOffer(tree, ['a', 'b']).parentChoices.map((c) => c.id);
    expect(ids).not.toContain('r1');
  });

  it('lists parent choices in tree order with their depth', () => {
    const choices = describeBulkOffer(tree, ['r3']).parentChoices.filter((c) => c.id !== null);
    expect(choices.map((c) => [c.id, c.depth])).toEqual([
      ['r1', 0],
      ['a', 1],
      ['b', 1],
      ['r2', 0],
      ['c', 1],
    ]);
  });

  it('blocks a parent change with a reason when no valid target is left', () => {
    const lonely = [goal('x'), goal('y', { parentId: 'x' })];
    const offer = describeBulkOffer(lonely, ['x', 'y']);
    expect(offer.parentChoices).toEqual([]);
    expect(offer.parentBlockedReason).toBeTruthy();
  });
});

describe('planBulkParentChange', () => {
  it('moves every selected goal under the new parent', () => {
    const updates = planBulkParentChange(tree, ['a', 'c'], 'r3');
    const applied = new Map(updates.map((u) => [u.id, u.updates.parentId]));
    expect(applied.get('a')).toBe('r3');
    expect(applied.get('c')).toBe('r3');
  });

  it('gives moved goals distinct sort orders under the new parent', () => {
    const updates = planBulkParentChange(tree, ['a', 'c'], 'r3');
    const orders = updates
      .filter((u) => u.updates.parentId === 'r3')
      .map((u) => u.updates.sortOrder);
    expect(new Set(orders).size).toBe(2);
  });

  it('moves only the top-most goals when a goal and its child are both selected', () => {
    const updates = planBulkParentChange(tree, ['r1', 'a'], 'r3');
    const moved = updates.filter((u) => u.updates.parentId === 'r3').map((u) => u.id);
    expect(moved).toEqual(['r1']);
  });

  it('refuses a move into the selection or its subtree', () => {
    expect(planBulkParentChange(tree, ['r1'], 'a')).toEqual([]);
    expect(planBulkParentChange(tree, ['r1'], 'r1')).toEqual([]);
  });

  it('moves goals to top level behind the existing roots', () => {
    const updates = planBulkParentChange(tree, ['a', 'r3'], null);
    expect(updates.map((u) => u.id)).toEqual(['a']);
    expect(updates[0].updates.parentId).toBeNull();
    expect(updates[0].updates.sortOrder).toBeGreaterThan(2);
  });
});

describe('buildBulkGoalMenuOptions', () => {
  const handlers = () => ({
    onApply: vi.fn(),
    onOpenParentStage: vi.fn(),
    onBack: vi.fn(),
  });

  const labels = (options: ReturnType<typeof buildBulkGoalMenuOptions>) =>
    options.map((o) => ('label' in o ? o.label : '---'));

  it('titles the menu with the number of goals', () => {
    const options = buildBulkGoalMenuOptions(tree, ['a', 'b'], 'root', handlers());
    expect(options[0]).toEqual({ type: 'header', label: '2 goals' });
  });

  it('applies a status to every selected goal', () => {
    const h = handlers();
    const options = buildBulkGoalMenuOptions(tree, ['a', 'b'], 'root', h);
    const item = options.find((o) => 'label' in o && o.label === 'Achieved');
    expect(item && 'action' in item).toBe(true);
    if (item && 'action' in item) item.action?.();
    expect(h.onApply).toHaveBeenCalledWith([
      { id: 'a', updates: { status: 'achieved' } },
      { id: 'b', updates: { status: 'achieved' } },
    ]);
  });

  it('shows a reason instead of status entries when statuses differ', () => {
    const mixed = tree.map((g) => (g.id === 'b' ? { ...g, status: 'failed' as const } : g));
    const all = labels(buildBulkGoalMenuOptions(mixed, ['a', 'b'], 'root', handlers()));
    expect(all).not.toContain('Achieved');
    expect(all.some((l) => /differ/i.test(l))).toBe(true);
  });

  it('applies a priority to every selected goal', () => {
    const h = handlers();
    const options = buildBulkGoalMenuOptions(tree, ['a', 'b'], 'root', h);
    const item = options.find((o) => 'label' in o && o.label === 'Critical');
    if (item && 'action' in item) item.action?.();
    expect(h.onApply).toHaveBeenCalledWith([
      { id: 'a', updates: { priority: 'critical' } },
      { id: 'b', updates: { priority: 'critical' } },
    ]);
  });

  it('opens the parent stage without closing the menu', () => {
    const h = handlers();
    const options = buildBulkGoalMenuOptions(tree, ['a', 'b'], 'root', h);
    const item = options.find((o) => 'label' in o && o.label === 'Change parent…');
    expect(item && 'keepOpen' in item && item.keepOpen).toBe(true);
    if (item && 'action' in item) item.action?.();
    expect(h.onOpenParentStage).toHaveBeenCalled();
  });

  it('lists the valid parents in the parent stage and applies the move', () => {
    const h = handlers();
    const options = buildBulkGoalMenuOptions(tree, ['a'], 'parent', h);
    const item = options.find((o) => 'label' in o && o.label.trim() === 'Goal r3');
    if (item && 'action' in item) item.action?.();
    expect(h.onApply).toHaveBeenCalledTimes(1);
    expect(h.onApply.mock.calls[0][0][0]).toMatchObject({ id: 'a', updates: { parentId: 'r3' } });
  });
});
