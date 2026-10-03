import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PmGoal } from '@/lib/tauri/goals';
import { useStore } from '@/lib/store';

const { save, writeFile } = vi.hoisted(() => ({ save: vi.fn(), writeFile: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save }));
vi.mock('@/lib/tauri/fs', () => ({ writeFile, writeFileBase64: vi.fn() }));
vi.mock('@/lib/tauri/goalHistory', () => ({ goalsLoadStatusHistory: vi.fn(async () => []) }));
vi.mock('@/app/components/pm/cost/useProjectUsageRows', () => ({
  useProjectUsageRows: () => [
    {
      goalId: 'a',
      ticketId: null,
      costUsd: 1.25,
      costSource: 'cli',
      inputTokens: 10,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 1,
    },
  ],
}));

import { GoalTable } from './GoalTable';

const mk = (id: string, over: Partial<PmGoal> = {}) =>
  ({
    id,
    parentId: null,
    name: id,
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'user',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as PmGoal;

const parent = mk('parent', { name: 'Parent' });
const goals = [
  parent,
  mk('a', { parentId: 'parent', name: 'Alpha' }),
  mk('b', { parentId: 'parent', name: 'Beta' }),
];

function renderTable(onSelect = vi.fn()) {
  render(<GoalTable goal={parent} goals={goals} tickets={[]} stations={[]} onSelect={onSelect} />);
  return onSelect;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('GoalTable', () => {
  it('shows the default columns, the sub-goals and a totals row', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Status',
      'Progress',
      'Cost (USD)',
    ]);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getAllByText('$1.25').length).toBe(2); // Alpha's row and the total
  });

  it('adds a column when its chip is pressed and remembers the choice', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Priority');
    expect(JSON.parse(localStorage.getItem('auric.goals.table-columns') ?? '[]')).toContain(
      'priority'
    );
  });

  it('keeps the last remaining column on', () => {
    localStorage.setItem('auric.goals.table-columns', '["name"]');
    renderTable();
    expect((screen.getByRole('button', { name: 'Name' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('focuses a sub-goal when its name is clicked', () => {
    const onSelect = renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('exports the visible table as CSV and confirms with a toast', async () => {
    save.mockResolvedValue('/tmp/x.csv');
    renderTable();
    fireEvent.click(screen.getByTestId('goal-table-export-csv'));
    await waitFor(() => expect(writeFile).toHaveBeenCalled());
    const csv = writeFile.mock.calls[0][1] as string;
    expect(csv).toContain('Name,Status,Progress,Cost (USD)');
    expect(csv).toContain('Total');
    await waitFor(() =>
      expect(useStore.getState().toasts.some((t) => /Exported 2/.test(t.message))).toBe(true)
    );
  });

  it('reports a failed export instead of staying quiet', async () => {
    save.mockRejectedValue('disk full');
    renderTable();
    fireEvent.click(screen.getByTestId('goal-table-export-csv'));
    await waitFor(() =>
      expect(useStore.getState().toasts.some((t) => t.message === 'disk full')).toBe(true)
    );
  });
});
