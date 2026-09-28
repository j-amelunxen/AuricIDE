import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalStatusHistoryEntry } from '@/lib/tauri/goalHistory';

const mockStore: Record<string, unknown> = {
  rootPath: '/project',
  goals: [],
};

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}));

const loadHistory = vi.fn<(path: string, goalId?: string) => Promise<GoalStatusHistoryEntry[]>>();
vi.mock('@/lib/tauri/goalHistory', () => ({
  goalsLoadStatusHistory: (path: string, goalId?: string) => loadHistory(path, goalId),
}));

import { GoalTiming } from './GoalTiming';

const NOW = '2026-09-10T12:00:00Z';

function entry(
  fromStatus: string | null,
  toStatus: string,
  changedAt: string,
  source = 'ui'
): GoalStatusHistoryEntry {
  return { id: `${toStatus}-${changedAt}`, goalId: 'g1', fromStatus, toStatus, changedAt, source };
}

describe('GoalTiming', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    loadHistory.mockReset();
    mockStore.goals = [{ id: 'g1', status: 'in_review', updatedAt: '2026-09-10 10:00:00' }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the goal history for the open project and shows time per status', async () => {
    loadHistory.mockResolvedValue([
      entry(null, 'active', '2026-09-01T12:00:00Z'),
      entry('active', 'in_progress', '2026-09-02T12:00:00Z'),
      entry('in_progress', 'in_review', '2026-09-10T10:00:00Z'),
    ]);

    render(<GoalTiming goalId="g1" status="in_review" />);

    expect(await screen.findByText('Timing')).toBeDefined();
    expect(loadHistory).toHaveBeenCalledWith('/project', 'g1');
    expect(screen.getByText('In review')).toBeDefined();
    expect(screen.getByText('2h 0m')).toBeDefined();
    expect(screen.getByText('In progress')).toBeDefined();
    expect(screen.getByText('7d 22h')).toBeDefined();
    expect(screen.getByText('Review rounds')).toBeDefined();
  });

  it('says where the record starts when it begins at the backfill snapshot', async () => {
    loadHistory.mockResolvedValue([entry(null, 'in_review', '2026-09-08 12:00:00', 'backfill')]);

    render(<GoalTiming goalId="g1" status="in_review" />);

    expect(await screen.findByText(/Tracked since/)).toBeDefined();
  });

  it('reloads when the saved goal changes', async () => {
    loadHistory.mockResolvedValue([entry(null, 'draft', '2026-09-01T12:00:00Z')]);
    const { rerender } = render(<GoalTiming goalId="g1" status="draft" />);
    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1));

    mockStore.goals = [{ id: 'g1', status: 'active', updatedAt: '2026-09-10 11:00:00' }];
    await act(async () => rerender(<GoalTiming goalId="g1" status="active" />));

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
  });

  it('renders nothing when the history cannot be loaded (browser mode)', async () => {
    loadHistory.mockRejectedValue(new Error('Tauri IPC is unavailable'));
    const { container } = render(<GoalTiming goalId="g1" status="draft" />);
    await waitFor(() => expect(loadHistory).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
