'use client';

import { useEffect, useState } from 'react';
import { installPrefMirror, syncSharedPrefs } from '@/lib/storage/sharedPrefs';
import { applyStoredSnapshot } from '@/lib/theme/catalog/apply';

/**
 * How long the window waits for the shared preferences before it gives up and
 * renders with whatever this origin holds. Reconciliation is one small file
 * read, so anything near this ceiling means the backend is not answering — and
 * a stale preference beats a window that never fills in.
 */
export const PREFS_SYNC_TIMEOUT_MS = 1500;

/**
 * Holds the first render until the webview's `localStorage` agrees with the
 * file both builds share.
 *
 * The gate exists because the values are read synchronously all over the app:
 * the theme by the script in the document head, the agent spawn defaults when
 * that dialog first mounts, the skill sources when the palette opens. Adopting
 * them a few frames late would leave whichever panel got there first showing
 * the value this origin happened to hold — which is exactly the disagreement
 * between the dev app and the installed one that this is here to end.
 */
export function SharedPrefsGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };

    // Installed first, so a write made during the very first render is shared
    // rather than left behind in this origin.
    installPrefMirror();

    const giveUp = setTimeout(finish, PREFS_SYNC_TIMEOUT_MS);
    void syncSharedPrefs().then(() => {
      // The pre-paint script ran before any of this; whatever was adopted has
      // to be put back on <html> or the window keeps the default colours.
      applyStoredSnapshot();
      finish();
    });

    return () => clearTimeout(giveUp);
  }, []);

  return <>{ready ? children : null}</>;
}
