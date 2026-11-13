'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { subscribeAppPrefs } from '@/lib/config/appConfig';
import {
  loadNotificationSoundEnabled,
  loadNotificationSoundId,
  NOTIFICATION_SOUND_KEYS,
  saveNotificationSoundEnabled,
  saveNotificationSoundId,
  type NotificationSoundId,
} from '@/lib/notifications/sound';

function subscribe(callback: () => void): () => void {
  return subscribeAppPrefs(NOTIFICATION_SOUND_KEYS, callback);
}

/** The notification chime belongs to the install, not to a project. */
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
