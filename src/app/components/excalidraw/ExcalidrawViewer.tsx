'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { writeFile } from '@/lib/tauri/fs';
import { buildExcalidrawFileJson } from '@/lib/excalidraw/serialize';
import { ExcalidrawCanvas } from './ExcalidrawCanvas';

const SAVE_DEBOUNCE_MS = 800;

export interface ExcalidrawViewerProps {
  /** Raw .excalidraw file JSON (already loaded by the tab system). */
  content: string;
  filePath: string;
  /** Re-reads the file from disk after a re-sync overwrote it. */
  onReload?: () => void;
}

interface ParsedScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

function parseScene(content: string): ParsedScene | null {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
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

/**
 * Tab for .excalidraw files. Files imported from Excalidraw+ carry a spec
 * link and stay READ-ONLY (the source of truth lives on Excalidraw+), with
 * Re-sync / Open-in-Excalidraw+ affordances. Plain local files — e.g. drawn
 * with the free excalidraw.com and dropped into the project — open in the
 * full editor and auto-save back to the file.
 */
export function ExcalidrawViewer({ content, filePath, onReload }: ExcalidrawViewerProps) {
  const rootPath = useStore((s) => s.rootPath);
  const specLinks = useStore((s) => s.excalidrawSpecLinks);
  const resyncSpec = useStore((s) => s.resyncSpec);
  const unlinkSpec = useStore((s) => s.unlinkSpec);
  const removeSpecFile = useStore((s) => s.removeSpecFile);
  const closeTab = useStore((s) => s.closeTab);
  const showToast = useStore((s) => s.showToast);
  const [syncing, setSyncing] = useState(false);

  const relPath =
    rootPath && filePath.startsWith(`${rootPath}/`)
      ? filePath.slice(rootPath.length + 1)
      : filePath;
  const link = specLinks[relPath];
  const editable = !link;
  const fileName = filePath.split('/').pop() ?? filePath;

  const parsed = useMemo(() => parseScene(content), [content]);

  // Auto-save for editable files: the first onChange (fired on mount) only
  // establishes the baseline; real edits are written debounced, and the
  // serializer ignores ephemeral state so pan/zoom never dirties the file.
  const baselineRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    baselineRef.current = null;
    return () => clearTimeout(saveTimerRef.current);
  }, [filePath]);

  const handleSceneChange = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>
    ) => {
      const serialized = buildExcalidrawFileJson(elements, appState, files);
      if (baselineRef.current === null) {
        baselineRef.current = serialized;
        return;
      }
      if (serialized === baselineRef.current) return;
      baselineRef.current = serialized;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        writeFile(filePath, serialized).catch((err) => showToast(String(err), 'error'));
      }, SAVE_DEBOUNCE_MS);
    },
    [filePath, showToast]
  );

  const handleResync = async () => {
    if (!rootPath || !link) return;
    setSyncing(true);
    try {
      await resyncSpec(rootPath, relPath);
      showToast(`Re-synced "${link.sceneName}" from Excalidraw+`, 'success');
      onReload?.();
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async () => {
    if (!rootPath || !link) return;
    try {
      await unlinkSpec(rootPath, relPath);
      showToast(`Unlinked "${link.sceneName}" — the file is now local and editable`, 'success');
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  const handleRemoveLocal = async () => {
    if (!rootPath || !link) return;
    if (
      !confirm(
        `Delete the local copy "${fileName}"? The scene stays untouched on Excalidraw+ and can be re-imported anytime.`
      )
    ) {
      return;
    }
    try {
      await removeSpecFile(rootPath, relPath);
      showToast(`Local copy of "${link.sceneName}" deleted — still on Excalidraw+`, 'success');
      closeTab(filePath);
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  const handleOpenInPlus = async () => {
    if (!link) return;
    try {
      const { excalidrawSceneUrl } = await import('@/lib/tauri/excalidraw');
      const { openExternalUrl } = await import('@/lib/tauri/opener');
      const url = await excalidrawSceneUrl(link.workspaceId, link.sceneId);
      await openExternalUrl(url);
    } catch (err) {
      showToast(String(err), 'error');
    }
  };

  return (
    <div data-testid="excalidraw-viewer" className="flex h-full flex-col">
      {/* Slim toolbar */}
      <div className="flex h-9 flex-shrink-0 items-center gap-3 border-b border-white/5 bg-white/2 px-4">
        <span aria-hidden="true" className="material-symbols-outlined text-sm text-primary-light">
          draw
        </span>
        <span className="text-xs font-medium text-foreground">{fileName}</span>
        <span
          data-testid="excalidraw-mode-badge"
          title={
            editable
              ? 'Local diagram — edits are saved back to this file'
              : 'Linked to Excalidraw+ — the source of truth lives there, edit it via "Open in Excalidraw+"'
          }
          className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
            editable ? 'bg-primary/10 text-primary-light' : 'bg-white/5 text-foreground-muted'
          }`}
        >
          {editable ? 'editable' : 'read-only'}
        </span>

        {link && (
          <div className="ml-auto flex items-center gap-2">
            <span
              className="text-[10px] text-foreground-muted"
              title={`Linked to Excalidraw+ scene "${link.sceneName}"`}
            >
              synced {new Date(link.importedAt).toLocaleString()}
            </span>
            <button
              data-testid="excalidraw-resync"
              onClick={handleResync}
              disabled={syncing}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className={`material-symbols-outlined text-[12px] ${syncing ? 'animate-spin' : ''}`}
              >
                sync
              </span>
              {syncing ? 'Syncing…' : 'Re-sync'}
            </button>
            <button
              data-testid="excalidraw-open-plus"
              onClick={handleOpenInPlus}
              className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary-light transition-colors hover:bg-primary/20"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[12px]">
                open_in_new
              </span>
              Open in Excalidraw+
            </button>
            <div aria-hidden="true" className="h-3 w-[1px] bg-white/10" />
            <button
              data-testid="excalidraw-unlink"
              onClick={handleUnlink}
              title="Remove the link to Excalidraw+ — the file stays and becomes locally editable"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
              aria-label="Unlink from Excalidraw+"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                link_off
              </span>
            </button>
            <button
              data-testid="excalidraw-remove-local"
              onClick={handleRemoveLocal}
              title="Delete the local copy — the scene stays on Excalidraw+"
              className="flex h-6 w-6 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-red-500/15 hover:text-red-300"
              aria-label="Delete local copy"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
                delete
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Canvas or error panel */}
      {parsed ? (
        <div className="flex-1 overflow-hidden">
          <ExcalidrawCanvas
            elements={parsed.elements}
            appState={parsed.appState}
            files={parsed.files}
            viewMode={!editable}
            onSceneChange={editable ? handleSceneChange : undefined}
          />
        </div>
      ) : (
        <div
          data-testid="excalidraw-viewer-error"
          className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-3xl text-amber-400">
            broken_image
          </span>
          <p className="text-sm font-bold text-foreground">
            This file is not a valid Excalidraw scene
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">
            Expected JSON with an <code className="font-mono">elements</code> array. If this spec
            came from Excalidraw+, try re-importing it from the workspace browser.
          </p>
        </div>
      )}
    </div>
  );
}
