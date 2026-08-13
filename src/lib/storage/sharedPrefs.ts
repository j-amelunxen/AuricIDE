import { invoke } from '../tauri/invoke';

/**
 * Keeps the webview's `localStorage` in step with a file the backend owns.
 *
 * WebKit scopes `localStorage` by data store and by page origin. The dev binary
 * runs unbundled from `http://localhost:41873`, the installed app runs bundled
 * from `tauri://localhost`, and neither axis is ours to align — so the two
 * builds looked like two different installs even though every store the backend
 * keeps (recent projects, starred projects, the inbox) already agreed, because
 * those resolve from the identifier in `tauri.conf.json`.
 *
 * The fix is to give the webview the same footing: `localStorage` stays the
 * synchronous cache every call site already reads, and `webview-prefs.json` in
 * the app data directory is the value both builds share.
 */

/** Records that this origin has handed its existing profile to the backend. */
export const PREFS_SEEDED_KEY = 'auric.prefs.seeded';

type PatchedWrites = {
  setItem: Storage['setItem'];
  removeItem: Storage['removeItem'];
  clear: Storage['clear'];
};

/** The untouched methods, kept so adoption can write without mirroring back. */
let untouched: PatchedWrites | null = null;

/**
 * The mirror runs one backend call at a time, in the order the webview made the
 * writes. Firing them off concurrently would let a write and the removal that
 * follows it land in either order, and each one is a read-modify-write of the
 * same file — the loser would put the deleted value back.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Sends a change to the backend without making the webview wait for it. A
 * rejected call is dropped on purpose: the value is already in this
 * `localStorage`, and browser mode has no backend to reach at all.
 */
function enqueue(command: string, args: Record<string, unknown>): void {
  queue = queue.then(() => invoke(command, args)).catch(() => {});
}

function writes(): PatchedWrites {
  return (
    untouched ?? {
      setItem: localStorage.setItem,
      removeItem: localStorage.removeItem,
      clear: localStorage.clear,
    }
  );
}

function snapshotLocal(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || key === PREFS_SEEDED_KEY) continue;
    const value = localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}

/**
 * Tells anything already listening that a key changed underneath it. A page
 * never sees a `storage` event for its own writes, so adoption has to say so
 * itself or a subscriber would keep serving the value it read at mount.
 */
function announce(key: string, newValue: string | null): void {
  try {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  } catch {
    // Older webviews refuse to construct the event; the value is stored either
    // way and the next read picks it up.
  }
}

/**
 * Makes this origin match the shared file exactly: adopt what it holds, drop
 * what it no longer holds. Both halves matter — without the second, a
 * preference cleared in one build would be handed back by the other.
 */
function adopt(stored: Record<string, string>): void {
  const { setItem, removeItem } = writes();
  for (const [key, value] of Object.entries(stored)) {
    if (localStorage.getItem(key) === value) continue;
    setItem.call(localStorage, key, value);
    announce(key, value);
  }
  for (const key of Object.keys(snapshotLocal())) {
    if (key in stored) continue;
    removeItem.call(localStorage, key);
    announce(key, null);
  }
}

/**
 * Reconciles this origin against the shared file. Call once at startup, before
 * anything reads a preference.
 *
 * The first run of an origin offers its local entries for adoption, which is
 * what carries an existing profile into the other build. Afterwards the file is
 * the whole truth, absences included.
 */
export async function syncSharedPrefs(): Promise<void> {
  const seeded = localStorage.getItem(PREFS_SEEDED_KEY) === '1';
  let stored: Record<string, string>;
  try {
    stored = await invoke<Record<string, string>>('webview_prefs_sync', {
      local: seeded ? {} : snapshotLocal(),
    });
  } catch {
    // Browser mode, or the backend is not up yet. The local values stand, and
    // the origin stays unseeded so the next launch offers them again.
    return;
  }
  adopt(stored);
  writes().setItem.call(localStorage, PREFS_SEEDED_KEY, '1');
}

/**
 * Mirrors every subsequent write to the backend. Returns the uninstaller.
 *
 * Wrapping the storage methods rather than routing each call site through a
 * helper is deliberate: a preference added later inherits the sharing instead
 * of staying local because someone reached for `localStorage` directly.
 *
 * The patch sits on `Storage.prototype`, not on the instance — a `Storage`
 * object treats an unknown assignment as a stored item, so patching the
 * instance would write an entry called "setItem" and leave the method as it
 * was. Every method therefore checks it is serving `localStorage`, so
 * `sessionStorage` keeps its own untracked behaviour.
 */
export function installPrefMirror(): () => void {
  if (untouched) return () => {};

  const proto = Object.getPrototypeOf(localStorage) as Storage;
  const original: PatchedWrites = {
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    clear: proto.clear,
  };
  untouched = original;

  proto.setItem = function patchedSetItem(this: Storage, key: string, value: string): void {
    original.setItem.call(this, key, value);
    if (this !== localStorage || key === PREFS_SEEDED_KEY) return;
    enqueue('webview_prefs_set', { key, value: String(value) });
  };

  proto.removeItem = function patchedRemoveItem(this: Storage, key: string): void {
    original.removeItem.call(this, key);
    if (this !== localStorage || key === PREFS_SEEDED_KEY) return;
    enqueue('webview_prefs_remove', { key });
  };

  proto.clear = function patchedClear(this: Storage): void {
    const mirrored = this === localStorage;
    const keys = mirrored ? Object.keys(snapshotLocal()) : [];
    original.clear.call(this);
    for (const key of keys) {
      enqueue('webview_prefs_remove', { key });
    }
  };

  return () => {
    if (untouched !== original) return;
    proto.setItem = original.setItem;
    proto.removeItem = original.removeItem;
    proto.clear = original.clear;
    untouched = null;
  };
}
