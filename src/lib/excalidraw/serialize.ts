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

/**
 * Canonical empty scene for freshly created `.excalidraw` files. The viewer
 * rejects anything whose `elements` isn't an array, so app-side creation must
 * seed this instead of an empty file.
 */
export function emptyExcalidrawSceneJson(): string {
  return buildExcalidrawFileJson([], {}, {});
}

/** An `.excalidraw` file's scene, read back. */
export interface ParsedExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * Reads what `buildExcalidrawFileJson` writes (or Excalidraw itself saved):
 * null when it is not JSON or has no element list; app state and files
 * default to empty.
 */
export function parseExcalidrawFileJson(json: string): ParsedExcalidrawScene | null {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(value.elements)) return null;
    return {
      elements: value.elements,
      appState: (value.appState as Record<string, unknown>) ?? {},
      files: (value.files as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}
