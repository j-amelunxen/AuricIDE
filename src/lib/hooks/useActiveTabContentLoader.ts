import { useEffect, useRef } from 'react';
import { isDiffTabId } from '@/lib/git/diffTabId';

/**
 * Keeps the editor content in sync with the active tab: whenever the active
 * tab changes — by clicking a tab, opening a file, or closing a tab (which
 * activates a neighbour) — the new tab's file is loaded. This is the single
 * owner of content loading; select/open handlers only change the active tab.
 *
 * Diff tabs ('diff:...') are skipped: their patch lives in diffByTabId and
 * is provided by the diff viewer.
 */
export function useActiveTabContentLoader(
  activeTabId: string | null,
  loadTabContent: (path: string) => Promise<void>
) {
  // The loader is recreated on every parent render (it closes over the IDE
  // state object) — track it in a ref so the load effect keys on the tab id
  // only. Declared first so the ref is fresh before the load effect runs.
  const loaderRef = useRef(loadTabContent);
  useEffect(() => {
    loaderRef.current = loadTabContent;
  });

  useEffect(() => {
    if (!activeTabId || isDiffTabId(activeTabId)) return;
    // A failed load (deleted file, browser mode without Tauri) keeps the
    // previous view — it must not surface as an unhandled rejection.
    loaderRef.current(activeTabId).catch(() => {});
  }, [activeTabId]);
}
