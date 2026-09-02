'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  loadNotificationSoundEnabled,
  loadNotificationSoundId,
  NOTIFICATION_SOUND_CHANGE_EVENT,
  saveNotificationSoundEnabled,
  saveNotificationSoundId,
  type NotificationSoundId,
} from '@/lib/notifications/sound';

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(NOTIFICATION_SOUND_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(NOTIFICATION_SOUND_CHANGE_EVENT, callback);
  };
}

/**
 * The notification chime belongs to the install, not to a project. Same-tab
 * writes notify through a custom event; other origins through `storage`.
 */
export function useNotificationSound(): {
  enabled: boolean;
  sound: NotificationSoundId;
  setEnabled: (value: boolean) => void;
  setSound: (value: NotificationSoundId) => void;
} {
  const enabled = useSyncExternalStore(subscribe, loadNotificationSoundEnabled, () => false);
  const sound = useSyncExternalStore(subscribe, loadNotificationSoundId, () => 'chime' as const);
  const setEnabled = useCallback((value: boolean) => saveNotificationSoundEnabled(value), []);
  const setSound = useCallback((value: NotificationSoundId) => saveNotificationSoundId(value), []);
  return { enabled, sound, setEnabled, setSound };
}
