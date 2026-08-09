const BASE_TITLE = 'AuricIDE';

/**
 * The window title as a fleet status line: the familiar unread-badge
 * convention, "(2) AuricIDE", while agents need a human — the plain app name
 * the rest of the time. Readable from the dock, the tab strip, and any other
 * app, so checking on the fleet does not require switching to it.
 */
export function composeWindowTitle(attentionCount: number): string {
  return attentionCount > 0 ? `(${attentionCount}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Sets the native window title, falling back to the document in the browser. */
export async function applyWindowTitle(title: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch {
    if (typeof document !== 'undefined') document.title = title;
  }
}

/**
 * Mirrors the attention count onto the dock icon (macOS/Linux). The dock is
 * visible even with the app hidden entirely — the last place the "do I need
 * to look?" number can reach. Zero clears the badge. Best-effort: browsers
 * and platforms without badges just skip it.
 */
export async function applyDockBadge(attentionCount: number): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setBadgeCount(attentionCount > 0 ? attentionCount : undefined);
  } catch {
    // No Tauri backend or unsupported platform — the title still carries it.
  }
}
