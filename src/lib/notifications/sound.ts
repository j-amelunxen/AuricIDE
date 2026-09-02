import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { osBannerForBatch } from './os';
import type { NotificationKind, NotificationSeverity, NotificationSource } from './types';

export const NOTIFICATION_SOUNDS = [
  { id: 'chime', label: 'Chime' },
  { id: 'ping', label: 'Ping' },
  { id: 'glass', label: 'Glass' },
  { id: 'pop', label: 'Pop' },
] as const;

export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number]['id'];

export function isNotificationSoundId(value: string): value is NotificationSoundId {
  return NOTIFICATION_SOUNDS.some((s) => s.id === value);
}

const ENABLED_KEY = APP_CONFIG_KEYS.notificationSoundEnabled;
const SOUND_KEY = APP_CONFIG_KEYS.notificationSound;
export const NOTIFICATION_SOUND_CHANGE_EVENT = 'auric-notification-sound-change';

/** Default is OFF — a chime on a fresh install would be a surprise. */
export function loadNotificationSoundEnabled(): boolean {
  return readAppPref(ENABLED_KEY) === 'true';
}

export function saveNotificationSoundEnabled(value: boolean): void {
  writeAppPref(ENABLED_KEY, String(value));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATION_SOUND_CHANGE_EVENT));
  }
}

export function loadNotificationSoundId(): NotificationSoundId {
  const raw = readAppPref(SOUND_KEY);
  return raw && isNotificationSoundId(raw) ? raw : 'chime';
}

export function saveNotificationSoundId(value: NotificationSoundId): void {
  writeAppPref(SOUND_KEY, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATION_SOUND_CHANGE_EVENT));
  }
}

type Arrival = {
  severity: NotificationSeverity;
  kind: NotificationKind;
  source: NotificationSource | string;
  title: string;
  body: string | null;
};

/**
 * One chime for a batch that would have earned an OS banner. The banner itself
 * stays quiet while the window is focused; the chime does not — you are in the
 * app, just not looking at the inbox. Off until the setting is on. Agent
 * successes stay silent: the same rule as the banner, so a run of green
 * results never trains anyone to ignore the sound that finally matters.
 */
export function chimeIfWanted(
  incoming: Arrival[],
  play: (id?: NotificationSoundId) => void = playNotificationSound
): void {
  if (!loadNotificationSoundEnabled()) return;
  if (osBannerForBatch(incoming) === null) return;
  play(loadNotificationSoundId());
}

type Note = {
  freq: number;
  start: number;
  dur: number;
  vol: number;
  type: OscillatorType;
};

const NOTES: Record<NotificationSoundId, Note[]> = {
  chime: [
    { freq: 523.25, start: 0, dur: 0.16, vol: 0.12, type: 'sine' },
    { freq: 659.25, start: 0.12, dur: 0.28, vol: 0.14, type: 'sine' },
  ],
  ping: [{ freq: 880, start: 0, dur: 0.18, vol: 0.12, type: 'triangle' }],
  glass: [
    { freq: 1318.5, start: 0, dur: 0.45, vol: 0.08, type: 'sine' },
    { freq: 1975.5, start: 0, dur: 0.35, vol: 0.05, type: 'sine' },
  ],
  pop: [
    { freq: 220, start: 0, dur: 0.05, vol: 0.1, type: 'square' },
    { freq: 440, start: 0.03, dur: 0.1, vol: 0.08, type: 'sine' },
  ],
};

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AC();
  if (sharedCtx.state === 'suspended') void sharedCtx.resume();
  return sharedCtx;
}

/** Preview and live arrivals share this so the picker is an honest sample. */
export function playNotificationSound(id: NotificationSoundId = loadNotificationSoundId()): void {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const note of NOTES[id] ?? NOTES.chime) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, now + note.start);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(note.vol, now + note.start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.02);
    }
  } catch {
    // No output device, autoplay blocked, or a closed context — the inbox
    // still has the row.
  }
}
