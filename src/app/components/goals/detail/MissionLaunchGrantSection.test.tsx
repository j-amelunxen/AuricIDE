import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The grant table in the inbox db, behind the native commands.
const table = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const mockSave = vi.fn(async (input: Record<string, unknown>) => {
  const row = { ...input, grantedAt: '2026-09-26 10:00:00', launchesUsed: 0 };
  table.rows = [row];
  return row;
});
const mockRevoke = vi.fn(async (id: string) => {
  table.rows = table.rows.filter((row) => row.id !== id);
});
const mockList = vi.fn(async (_projectPath?: string) => table.rows);
const inbox = vi.hoisted(() => ({ changed: () => undefined as void }));
vi.mock('@/lib/tauri/notifications', () => ({
  notificationsSaveLaunchGrant: (input: Record<string, unknown>) => mockSave(input),
  notificationsRevokeLaunchGrant: (id: string) => mockRevoke(id),
  notificationsListLaunchGrants: (projectPath?: string) => mockList(projectPath),
  onNotificationsChanged: (callback: () => void) => {
    inbox.changed = callback;
    return () => undefined;
  },
}));

import { MissionLaunchGrantSection } from './MissionLaunchGrantSection';

const REPO = '/repo/auric';

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    projectPath: REPO,
    rootGoalId: 'root',
    rootGoalName: 'Mission',
    maxConcurrent: 2,
    launchBudget: 10,
    grantedAt: '2026-09-26 10:00:00',
    launchesUsed: 0,
    ...overrides,
  };
}

describe('MissionLaunchGrantSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.rows = [];
    mockList.mockImplementation(async () => table.rows);
  });

  const renderSection = () =>
    render(
      <MissionLaunchGrantSection
        projectPath={REPO}
        rootGoalId="root"
        rootGoalName="Mission"
        labelCls=""
      />
    );

  it('shows that nothing starts on its own by default', async () => {
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(REPO));
    expect(screen.getByTestId('launch-grant-status').textContent).toContain('until you click');
    expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Allow automatic starts');
  });

  it('grants automatic starts with the chosen limits, shown once the database confirmed', async () => {
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('launch-grant-concurrent'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('launch-grant-budget'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('launch-grant-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-status').textContent).toContain('0 of 7 starts')
    );
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: REPO, rootGoalId: 'root', maxConcurrent: 3 })
    );
    expect(screen.getByTestId('launch-grant-status').textContent).toContain('Waiting requests');
  });

  // Review r2 (1): the UI must not show a grant the database did not take.
  it('keeps showing "off" and says why when the save is not acknowledged', async () => {
    mockSave.mockRejectedValueOnce(new Error('disk I/O error'));
    renderSection();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('launch-grant-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-error').textContent).toContain('disk I/O error')
    );
    expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Allow automatic starts');
  });

  it('keeps showing the grant and says why when the revoke is not acknowledged', async () => {
    table.rows = [grantRow()];
    mockRevoke.mockRejectedValueOnce(new Error('database is locked'));
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts')
    );
    fireEvent.click(screen.getByTestId('launch-grant-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-error').textContent).toContain('database is locked')
    );
    expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts');
  });

  // Review r3, blocker 3: another instance replaced g1 with g2 without this
  // one hearing about it. The native revoke of g1 is a conflict; the section
  // says so and shows the grant that is really in force, never 'off'.
  it('shows a revoke conflict and the grant really in force', async () => {
    table.rows = [grantRow()];
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts')
    );
    table.rows = [grantRow({ id: 'g2', launchesUsed: 3 })];
    mockRevoke.mockRejectedValueOnce(
      new Error("Launch grant 'g1' is no longer in force; grant 'g2' is")
    );
    fireEvent.click(screen.getByTestId('launch-grant-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-status').textContent).toContain('3 of 10 starts')
    );
    expect(screen.getByTestId('launch-grant-error').textContent).toContain('no longer in force');
    expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts');
  });

  it('shows the starts the native claim counted', async () => {
    table.rows = [grantRow({ launchesUsed: 4 })];
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-status').textContent).toContain('4 of 10 starts')
    );
  });

  it('says the state is unknown, and offers no switch, when the grants cannot be read', async () => {
    mockList.mockRejectedValue(new Error('unreadable'));
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-error').textContent).toContain('unreadable')
    );
    expect(screen.queryByTestId('launch-grant-toggle')).toBeNull();
  });

  it('revokes the grant once the database confirmed', async () => {
    table.rows = [grantRow()];
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts')
    );
    fireEvent.click(screen.getByTestId('launch-grant-toggle'));

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Allow automatic starts')
    );
    expect(mockRevoke).toHaveBeenCalledWith('g1');
  });

  it('follows a revoke made in another app instance', async () => {
    table.rows = [grantRow()];
    renderSection();
    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Revoke automatic starts')
    );
    table.rows = [];
    inbox.changed();

    await waitFor(() =>
      expect(screen.getByTestId('launch-grant-toggle').textContent).toBe('Allow automatic starts')
    );
  });
});
