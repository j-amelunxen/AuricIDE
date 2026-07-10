/**
 * Serializes a live Excalidraw scene back into `.excalidraw` file JSON.
 * Only durable appState survives — ephemeral state (scroll, zoom, selection,
 * collaborators) is dropped so panning around never dirties the file. The
 * output is deterministic, so callers can use string equality as a
 * did-anything-change guard before writing to disk.
 */

const PERSISTED_APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
] as const;

export function buildExcalidrawFileJson(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown> | null | undefined
): string {
  const persistedState: Record<string, unknown> = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) persistedState[key] = appState[key];
  }

  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'auric-ide',
      elements,
      appState: persistedState,
      files: files ?? {},
    },
    null,
    2
  );
}
