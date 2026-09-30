import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usageRow } from '@/lib/pm/usage/testRow';
import type { PmGoal } from '@/lib/tauri/goals';
import { GoalCost } from './GoalCost';

const goal = (id: string, parentId: string | null = null) => ({ id, parentId }) as PmGoal;
const ticket = (id: string, goalId: string | null) => ({
  id,
  epicId: 'e1',
  status: 'open' as const,
  goalId,
});

function stat(label: string): string | undefined {
  const term = screen.getAllByText(label).find((el) => el.tagName === 'DT');
  return term?.nextElementSibling?.textContent ?? undefined;
}

describe('GoalCost', () => {
  it('sums the goal, its sub-goals and their tickets, and picks up runs that arrive later', () => {
    const goals = [goal('g1'), goal('g2', 'g1'), goal('other')];
    const tickets = [ticket('t1', 'g2'), ticket('t2', 'other')];
    const { rerender } = render(<GoalCost goalId="g1" goals={goals} tickets={tickets} rows={[]} />);
    expect(screen.getByText('No agent runs recorded yet.')).toBeDefined();

    const rows = [
      usageRow({ goalId: 'g1', ticketId: null, costUsd: 1 }),
      usageRow({ goalId: null, ticketId: 't1', costUsd: 2 }),
      usageRow({ goalId: null, ticketId: 't2', costUsd: 40 }),
    ];
    rerender(<GoalCost goalId="g1" goals={goals} tickets={tickets} rows={rows} />);

    expect(stat('Total')).toBe('$3.00');
    expect(stat('Runs')).toBe('2');
  });
});
