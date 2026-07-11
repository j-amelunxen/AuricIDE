import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsPermissionGranted = vi.fn();
const mockRequestPermission = vi.fn();
const mockSendNotification = vi.fn();

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: (...args: unknown[]) => mockIsPermissionGranted(...args),
  requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

import { conductorNotificationContent, notifyConductor } from './conductorNotifications';

describe('conductorNotificationContent', () => {
  it('describes the approval-needed moment with the ticket name', () => {
    const content = conductorNotificationContent('approval_needed', 'Deploy to prod');
    expect(content.title).toBe('Conductor needs your approval');
    expect(content.body).toContain('Deploy to prod');
  });

  it('describes the goal-achieved payoff with the goal name', () => {
    const content = conductorNotificationContent('goal_achieved', 'Ship v1');
    expect(content.title).toBe('Goal achieved');
    expect(content.body).toContain('Ship v1');
  });

  it('describes a blocked stop with the blockers', () => {
    const content = conductorNotificationContent('goal_blocked', '2 tickets stuck');
    expect(content.title).toBe('Conductor stopped — goal not satisfied');
    expect(content.body).toContain('2 tickets stuck');
  });

  it('describes a finished run', () => {
    const content = conductorNotificationContent('run_finished', '');
    expect(content.title).toBe('Conductor finished');
    expect(content.body.length).toBeGreaterThan(0);
  });
});

describe('notifyConductor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPermissionGranted.mockResolvedValue(true);
    mockRequestPermission.mockResolvedValue('granted');
  });

  it('sends an OS notification when the window is not focused', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    await notifyConductor('goal_achieved', 'Ship v1');

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Goal achieved' })
    );
  });

  it('stays silent while the window is focused — the user already sees the panel', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    await notifyConductor('goal_achieved', 'Ship v1');

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('requests permission once when not yet granted, then sends', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue('granted');

    await notifyConductor('approval_needed', 'Deploy to prod');

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalled();
  });

  it('does not send when the user denied permission', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue('denied');

    await notifyConductor('approval_needed', 'Deploy to prod');

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('never throws in browser mode (plugin unavailable)', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    mockIsPermissionGranted.mockRejectedValue(new Error('not in tauri'));

    await expect(notifyConductor('run_finished', '')).resolves.toBeUndefined();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
