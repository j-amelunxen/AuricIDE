import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import {
  loadNotificationSoundEnabled,
  loadNotificationSoundId,
  saveNotificationSoundEnabled,
  saveNotificationSoundId,
} from '@/lib/notifications/sound';
import { useNotificationSound } from './notificationSound';

describe('notification sound setting', () => {
  afterEach(() => {
    localStorage.removeItem(APP_CONFIG_KEYS.notificationSoundEnabled);
    localStorage.removeItem(APP_CONFIG_KEYS.notificationSound);
  });

  it('stays off until asked for', () => {
    // A chime on a fresh install would be a surprise, and the first one
    // would land before anyone had a chance to find the switch.
    expect(loadNotificationSoundEnabled()).toBe(false);
  });

  it('defaults to chime when nothing is stored', () => {
    expect(loadNotificationSoundId()).toBe('chime');
  });

  it('persists on/off', () => {
    saveNotificationSoundEnabled(true);
    expect(loadNotificationSoundEnabled()).toBe(true);
    saveNotificationSoundEnabled(false);
    expect(loadNotificationSoundEnabled()).toBe(false);
  });

  it('persists a chosen sound', () => {
    saveNotificationSoundId('glass');
    expect(loadNotificationSoundId()).toBe('glass');
  });

  it('falls back to chime for a sound it does not offer', () => {
    localStorage.setItem(APP_CONFIG_KEYS.notificationSound, 'trombone');
    expect(loadNotificationSoundId()).toBe('chime');
  });

  it('exposes the current values and notifies subscribers', () => {
    const { result } = renderHook(() => useNotificationSound());
    expect(result.current.enabled).toBe(false);
    expect(result.current.sound).toBe('chime');

    act(() => {
      result.current.setEnabled(true);
      result.current.setSound('ping');
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.sound).toBe('ping');
    expect(loadNotificationSoundEnabled()).toBe(true);
    expect(loadNotificationSoundId()).toBe('ping');
  });
});
