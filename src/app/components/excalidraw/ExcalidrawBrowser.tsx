'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { ExcalidrawCanvas } from './ExcalidrawCanvas';
import type { ExcalidrawSceneSummary } from '@/lib/excalidraw/types';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface ExcalidrawBrowserProps {
  /** Called after a scene was imported as spec so the file tree can refresh. */
  onImported?: () => void;
  /** Opens the settings modal (its open state lives outside the store). */
  onOpenSettings?: () => void;
}

interface ParsedPreview {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

function parsePreview(fileJson: string): ParsedPreview | null {
  try {
    const value = JSON.parse(fileJson) as Record<string, unknown>;
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

export function ExcalidrawBrowser(props: ExcalidrawBrowserProps) {
  const open = useStore((s) => s.excalidrawBrowserOpen);
  if (!open) return null;
  return <ExcalidrawBrowserContent {...props} />;
}

function ExcalidrawBrowserContent({ onImported, onOpenSettings }: ExcalidrawBrowserProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  const rootPath = useStore((s) => s.rootPath);
  const collections = useStore((s) => s.excalidrawCollections);
  const collectionsStatus = useStore((s) => s.excalidrawCollectionsStatus);
  const scenes = useStore((s) => s.excalidrawScenes);
  const scenesStatus = useStore((s) => s.excalidrawScenesStatus);
  const selectedCollectionId = useStore((s) => s.excalidrawSelectedCollectionId);
  const preview = useStore((s) => s.excalidrawPreview);
  const previewStatus = useStore((s) => s.excalidrawPreviewStatus);
  const error = useStore((s) => s.excalidrawError);
  const specLinks = useStore((s) => s.excalidrawSpecLinks);

  const setBrowserOpen = useStore((s) => s.setExcalidrawBrowserOpen);
  const loadCollections = useStore((s) => s.loadExcalidrawCollections);
  const selectCollection = useStore((s) => s.selectExcalidrawCollection);
  const previewScene = useStore((s) => s.previewExcalidrawScene);
  const markSceneAsSpec = useStore((s) => s.markSceneAsSpec);
  const resyncAllSpecs = useStore((s) => s.resyncAllSpecs);
  const removeSpecFile = useStore((s) => s.removeSpecFile);
  const showToast = useStore((s) => s.showToast);

  const [importing, setImporting] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  useEffect(() => {
    if (rootPath) void loadCollections(rootPath);
  }, [rootPath, loadCollections]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBrowserOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setBrowserOpen]);

  const linkedSceneIds = useMemo(
    () => new Set(Object.values(specLinks).map((l) => l.sceneId)),
    [specLinks]
  );
  const relPathForScene = (sceneId: string) =>
    Object.entries(specLinks).find(([, l]) => l.sceneId === sceneId)?.[0];
  const linkedCount = Object.keys(specLinks).length;

  const notConfigured =
    collectionsStatus === 'error' && (error ?? '').startsWith('EXCALIDRAW_NOT_CONFIGURED');

  const handleMarkAsSpec = async (scene: ExcalidrawSceneSummary) => {
    if (!rootPath) return;
    setImporting(scene.id);
    try {
      const relPath = await markSceneAsSpec(rootPath, scene);
      showToast(`"${scene.name}" imported as ${relPath}`, 'success');
      onImported?.();
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setImporting(null);
    }
  };

  const handleRemoveLocal = async (scene: ExcalidrawSceneSummary) => {
    const relPath = relPathForScene(scene.id);
    if (!rootPath || !relPath) return;
    if (
      !confirm(
        `Delete the local copy of "${scene.name}" (${relPath})? The scene stays untouched on Excalidraw+.`
      )
    ) {
      return;
    }
    try {
      await removeSpecFile(rootPath, relPath);
      showToast(`Local copy of "${scene.name}" deleted — still on Excalidraw+`, 'success');
      onImported?.();
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  const handleSyncAll = async () => {
    if (!rootPath) return;
    setSyncingAll(true);
    try {
      const { synced, failed } = await resyncAllSpecs(rootPath);
      showToast(
        `Excalidraw+ specs: ${synced} synced${failed > 0 ? `, ${failed} failed` : ''}`,
        failed > 0 ? 'error' : 'success'
      );
      onImported?.();
    } finally {
      setSyncingAll(false);
    }
  };

  const parsedPreview = preview ? parsePreview(preview.fileJson) : null;

  return createPortal(
    <div
      data-testid="excalidraw-browser"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setBrowserOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="excalidraw-browser-title"
        className="flex h-[85vh] w-[90vw] max-w-[1400px] flex-col rounded-2xl border border-white/10 bg-background-dark shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-3">
          <div className="flex items-center gap-3">
            <AuricIcon aria-hidden="true" name="draw" className="text-primary-light" />
            <h1 id="excalidraw-browser-title" className="text-sm font-bold text-foreground">
              Excalidraw+ Workspace
            </h1>
            <span className="text-[10px] text-foreground-muted">
              {linkedCount} spec{linkedCount === 1 ? '' : 's'} linked
            </span>
          </div>
          <div className="flex items-center gap-2">
            {linkedCount > 0 && (
              <button
                data-testid="excalidraw-sync-all"
                onClick={handleSyncAll}
                disabled={syncingAll}
                className="flex items-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <AuricIcon
                  aria-hidden="true"
                  name="sync"
                  className={`text-sm ${syncingAll ? 'animate-spin' : ''}`}
                />
                {syncingAll ? 'Syncing…' : 'Sync all specs'}
              </button>
            )}
            <button
              data-testid="excalidraw-browser-close"
              onClick={() => setBrowserOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
            >
              <AuricIcon aria-hidden="true" name="close" className="text-base" />
            </button>
          </div>
        </div>

        {/* Body */}
        {notConfigured ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <AuricIcon aria-hidden="true" name="key" className="text-3xl text-primary-light" />
            <p className="text-sm font-bold text-foreground">No Excalidraw+ API key configured</p>
            <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">
              Create an API key in your Excalidraw+ workspace settings and add it under Settings →
              Excalidraw+ to browse your collections here.
            </p>
            <button
              data-testid="excalidraw-configure-cta"
              onClick={() => {
                setBrowserOpen(false);
                onOpenSettings?.();
              }}
              className="rounded-xl bg-primary/10 border border-primary/20 px-6 py-2.5 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20"
            >
              Open Settings
            </button>
          </div>
        ) : collectionsStatus === 'error' ? (
          <div
            data-testid="excalidraw-browser-error"
            className="flex flex-1 items-center justify-center p-8 text-center text-xs text-red-300"
          >
            {error}
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Collections sidebar */}
            <div className="flex w-[280px] flex-col overflow-y-auto border-r border-white/5 p-2">
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
                Collections
              </p>
              {collectionsStatus === 'loading' && (
                <p className="px-2 py-2 text-xs text-foreground-muted">Loading…</p>
              )}
              {collectionsStatus === 'idle' && collections.length === 0 && (
                <p className="px-2 py-2 text-xs text-foreground-muted">No collections found.</p>
              )}
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  data-testid={`excalidraw-collection-${collection.id}`}
                  onClick={() => rootPath && void selectCollection(rootPath, collection.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                    selectedCollectionId === collection.id
                      ? 'bg-primary/10 text-primary-light'
                      : 'text-foreground hover:bg-white/5'
                  }`}
                >
                  <span className="text-sm">{collection.emoji ?? <AuricIcon name="folder" />}</span>
                  <span className="flex-1 truncate">{collection.name}</span>
                </button>
              ))}
            </div>

            {/* Scenes + preview */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-3">
                {!selectedCollectionId ? (
                  <p className="p-4 text-xs text-foreground-muted">
                    Select a collection to see its diagrams.
                  </p>
                ) : scenesStatus === 'loading' ? (
                  <p className="p-4 text-xs text-foreground-muted">Loading scenes…</p>
                ) : scenes.length === 0 ? (
                  <p className="p-4 text-xs text-foreground-muted">
                    This collection has no diagrams.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {scenes.map((scene) => {
                      const isLinked = linkedSceneIds.has(scene.id);
                      return (
                        <div
                          key={scene.id}
                          data-testid={`excalidraw-scene-${scene.id}`}
                          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 hover:border-white/15 transition-colors"
                        >
                          <AuricIcon
                            aria-hidden="true"
                            name="draw"
                            className="text-base text-primary-light opacity-70"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium text-foreground">
                                {scene.name}
                              </span>
                              {isLinked && (
                                <span
                                  data-testid={`excalidraw-spec-badge-${scene.id}`}
                                  className="rounded-full bg-green-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-300"
                                >
                                  Spec
                                </span>
                              )}
                            </div>
                            {scene.updatedAt && (
                              <span className="text-[10px] text-foreground-muted">
                                updated {new Date(scene.updatedAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                          <button
                            data-testid={`excalidraw-preview-${scene.id}`}
                            onClick={() => rootPath && void previewScene(rootPath, scene.id)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-foreground hover:bg-white/10 transition-colors"
                          >
                            Preview
                          </button>
                          <button
                            data-testid={`excalidraw-mark-spec-${scene.id}`}
                            onClick={() => void handleMarkAsSpec(scene)}
                            disabled={importing === scene.id}
                            className="rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary-light hover:bg-primary/20 transition-colors disabled:opacity-50"
                          >
                            {importing === scene.id
                              ? 'Importing…'
                              : isLinked
                                ? 'Re-sync'
                                : 'Mark as Spec'}
                          </button>
                          {isLinked && (
                            <button
                              data-testid={`excalidraw-remove-local-${scene.id}`}
                              onClick={() => void handleRemoveLocal(scene)}
                              title="Delete the local copy — the scene stays on Excalidraw+"
                              aria-label={`Delete local copy of ${scene.name}`}
                              className="flex h-6 w-6 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-red-500/15 hover:text-red-300"
                            >
                              <AuricIcon aria-hidden="true" name="delete" className="text-[13px]" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {scenesStatus === 'error' && <p className="p-4 text-xs text-red-300">{error}</p>}
              </div>

              {/* Lazy preview pane */}
              {(previewStatus === 'loading' || parsedPreview) && (
                <div className="h-[45%] flex-shrink-0 border-t border-white/5">
                  {previewStatus === 'loading' ? (
                    <div className="flex h-full items-center justify-center text-xs text-foreground-muted">
                      Loading preview…
                    </div>
                  ) : (
                    parsedPreview && (
                      <ExcalidrawCanvas
                        elements={parsedPreview.elements}
                        appState={parsedPreview.appState}
                        files={parsedPreview.files}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
