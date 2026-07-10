'use client';

import dynamic from 'next/dynamic';
import '@excalidraw/excalidraw/index.css';

// Runtime assets (fonts) are served from public/ so the packaged desktop app
// renders snapshots fully offline — see scripts/copy-excalidraw-assets.mjs.
if (typeof window !== 'undefined') {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
    '/excalidraw-assets/';
}

// The editor bundle is heavy — load it only when a diagram actually opens.
const Excalidraw = dynamic(() => import('@excalidraw/excalidraw').then((m) => m.Excalidraw), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-foreground-muted">
      Loading diagram…
    </div>
  ),
});

export interface ExcalidrawCanvasProps {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  /** true (default) renders read-only; false enables the full editor. */
  viewMode?: boolean;
  /** Fires on every scene change while editing (elements, appState, files). */
  onSceneChange?: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>
  ) => void;
}

/** Excalidraw canvas for local .excalidraw content — read-only or editable. */
export function ExcalidrawCanvas({
  elements,
  appState,
  files,
  viewMode = true,
  onSceneChange,
}: ExcalidrawCanvasProps) {
  const initialData = {
    elements,
    // collaborators from saved appState crash the component (expects a Map).
    appState: { ...appState, collaborators: new Map(), viewModeEnabled: viewMode },
    files,
    scrollToContent: true,
  };

  return (
    <Excalidraw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialData={initialData as any}
      viewModeEnabled={viewMode}
      onChange={
        onSceneChange
          ? (changedElements, changedAppState, changedFiles) =>
              onSceneChange(
                changedElements as readonly unknown[],
                changedAppState as unknown as Record<string, unknown>,
                (changedFiles ?? {}) as Record<string, unknown>
              )
          : undefined
      }
      UIOptions={{ canvasActions: { export: false, saveAsImage: true } }}
    />
  );
}
