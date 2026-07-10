/**
 * Normalized Excalidraw+ types as returned by the Rust IPC layer. The raw
 * beta-API contract lives in src-tauri/src/excalidraw/contract.rs — by the
 * time data reaches the frontend it has already been validated there.
 */

export interface ExcalidrawCollection {
  id: string;
  name: string;
  emoji: string | null;
  updatedAt: string | null;
}

export interface ExcalidrawSceneSummary {
  id: string;
  name: string;
  collectionId: string | null;
  workspaceId: string | null;
  updatedAt: string | null;
  previewUrl: string | null;
}

/**
 * The retained link between a local spec snapshot (specs/*.excalidraw) and
 * its Excalidraw+ scene. Persisted per project in the kv namespace
 * `excalidraw_specs`, keyed by the spec file path relative to project root.
 */
export interface ExcalidrawSpecLink {
  sceneId: string;
  collectionId: string | null;
  workspaceId: string | null;
  sceneName: string;
  importedAt: string;
}
