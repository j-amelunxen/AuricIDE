import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { chimeIfWanted, isNotificationSoundId, NOTIFICATION_SOUNDS } from './sound';

describe('notification sounds', () => {
  afterEach(() => {
    localStorage.removeItem(APP_CONFIG_KEYS.notificationSoundEnabled);
    localStorage.removeItem(APP_CONFIG_KEYS.notificationSound);
    vi.restoreAllMocks();
  });

  it('offers a small named set, never a free-text picker', () => {
    expect(NOTIFICATION_SOUNDS.map((s) => s.id)).toEqual(['chime', 'ping', 'glass', 'pop']);
    expect(isNotificationSoundId('chime')).toBe(true);
    expect(isNotificationSoundId('trombone')).toBe(false);
  });

  it('does not chime when the setting is off', () => {
    const play = vi.fn();
    chimeIfWanted(
      [{ severity: 'error', kind: 'info', source: 'system', title: 'Down', body: null }],
      play
    );
    expect(play).not.toHaveBeenCalled();
  });

  it('chimes once for a batch that would have earned a banner', () => {
    localStorage.setItem(APP_CONFIG_KEYS.notificationSoundEnabled, 'true');
    const play = vi.fn();
    chimeIfWanted(
      [
        { severity: 'error', kind: 'info', source: 'agent', title: 'Failed', body: null },
        { severity: 'info', kind: 'info', source: 'agent', title: 'Done', body: null },
      ],
      play
    );
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for arrivals that have not earned a banner', () => {
    localStorage.setItem(APP_CONFIG_KEYS.notificationSoundEnabled, 'true');
    const play = vi.fn();
    chimeIfWanted(
      [{ severity: 'info', kind: 'info', source: 'agent', title: 'Done', body: null }],
      play
    );
    expect(play).not.toHaveBeenCalled();
  });

  it('chimes for a system reminder even though its severity is info', () => {
    localStorage.setItem(APP_CONFIG_KEYS.notificationSoundEnabled, 'true');
    const play = vi.fn();
    chimeIfWanted(
      [{ severity: 'info', kind: 'info', source: 'system', title: 'Stand-up', body: null }],
      play
    );
    expect(play).toHaveBeenCalledTimes(1);
  });
});
