import type { StateCreator } from 'zustand';
import type {
  ExcalidrawCollection,
  ExcalidrawSceneSummary,
  ExcalidrawSpecLink,
} from '../excalidraw/types';
import {
  excalidrawListCollections,
  excalidrawListScenes,
  excalidrawGetSceneContent,
} from '../tauri/excalidraw';
import { dbSet, dbDelete, dbList } from '../tauri/db';
import { writeFile, deleteFile } from '../tauri/fs';
import { slugifySceneName } from '../excalidraw/slug';

type LoadStatus = 'idle' | 'loading' | 'error';

const SPEC_LINKS_NAMESPACE = 'excalidraw_specs';

export interface ExcalidrawSlice {
  // Browser state
  excalidrawBrowserOpen: boolean;
  excalidrawCollections: ExcalidrawCollection[];
  excalidrawCollectionsStatus: LoadStatus;
  excalidrawScenes: ExcalidrawSceneSummary[];
  excalidrawScenesStatus: LoadStatus;
  excalidrawSelectedCollectionId: string | null;
  excalidrawPreview: { sceneId: string; fileJson: string } | null;
  excalidrawPreviewStatus: LoadStatus;
  excalidrawError: string | null;
  // Spec-link registry (relPath -> link), persisted in kv namespace excalidraw_specs
  excalidrawSpecLinks: Record<string, ExcalidrawSpecLink>;
  excalidrawSyncing: Record<string, boolean>;
  // Actions
  setExcalidrawBrowserOpen: (open: boolean) => void;
  loadExcalidrawCollections: (projectPath: string) => Promise<void>;
  selectExcalidrawCollection: (projectPath: string, collectionId: string) => Promise<void>;
  previewExcalidrawScene: (projectPath: string, sceneId: string) => Promise<void>;
  loadExcalidrawSpecLinks: (projectPath: string) => Promise<void>;
  /** Snapshot + link: writes specs/<slug>.excalidraw and registers the link. Returns the relPath. */
  markSceneAsSpec: (projectPath: string, scene: ExcalidrawSceneSummary) => Promise<string>;
  resyncSpec: (projectPath: string, relPath: string) => Promise<void>;
  resyncAllSpecs: (projectPath: string) => Promise<{ synced: number; failed: number }>;
  /** Removes the link only — the local snapshot stays authoritative. */
  unlinkSpec: (projectPath: string, relPath: string) => Promise<void>;
  /** Deletes the local copy (file + link). The Excalidraw+ scene is untouched. */
  removeSpecFile: (projectPath: string, relPath: string) => Promise<void>;
  resetExcalidrawInMemory: () => void;
}

const initialState = {
  excalidrawBrowserOpen: false,
  excalidrawCollections: [] as ExcalidrawCollection[],
  excalidrawCollectionsStatus: 'idle' as LoadStatus,
  excalidrawScenes: [] as ExcalidrawSceneSummary[],
  excalidrawScenesStatus: 'idle' as LoadStatus,
  excalidrawSelectedCollectionId: null as string | null,
  excalidrawPreview: null as { sceneId: string; fileJson: string } | null,
  excalidrawPreviewStatus: 'idle' as LoadStatus,
  excalidrawError: null as string | null,
  excalidrawSpecLinks: {} as Record<string, ExcalidrawSpecLink>,
  excalidrawSyncing: {} as Record<string, boolean>,
};

export const createExcalidrawSlice: StateCreator<ExcalidrawSlice> = (set, get) => ({
  ...initialState,

  setExcalidrawBrowserOpen: (open) => set({ excalidrawBrowserOpen: open }),

  loadExcalidrawCollections: async (projectPath) => {
    set({ excalidrawCollectionsStatus: 'loading', excalidrawError: null });
    try {
      const collections = await excalidrawListCollections(projectPath);
      set({ excalidrawCollections: collections, excalidrawCollectionsStatus: 'idle' });
    } catch (err) {
      set({ excalidrawCollectionsStatus: 'error', excalidrawError: String(err) });
    }
  },

  selectExcalidrawCollection: async (projectPath, collectionId) => {
    set({
      excalidrawSelectedCollectionId: collectionId,
      excalidrawScenesStatus: 'loading',
      excalidrawError: null,
    });
    try {
      const scenes = await excalidrawListScenes(projectPath, collectionId);
      set({ excalidrawScenes: scenes, excalidrawScenesStatus: 'idle' });
    } catch (err) {
      set({ excalidrawScenesStatus: 'error', excalidrawError: String(err) });
    }
  },

  previewExcalidrawScene: async (projectPath, sceneId) => {
    set({ excalidrawPreviewStatus: 'loading', excalidrawPreview: null });
    try {
      const fileJson = await excalidrawGetSceneContent(projectPath, sceneId);
      set({ excalidrawPreview: { sceneId, fileJson }, excalidrawPreviewStatus: 'idle' });
    } catch (err) {
      set({ excalidrawPreviewStatus: 'error', excalidrawError: String(err) });
    }
  },

  loadExcalidrawSpecLinks: async (projectPath) => {
    const entries = await dbList(projectPath, SPEC_LINKS_NAMESPACE);
    const links: Record<string, ExcalidrawSpecLink> = {};
    for (const entry of entries) {
      try {
        links[entry.key] = JSON.parse(entry.value) as ExcalidrawSpecLink;
      } catch {
        console.warn(`Skipping malformed excalidraw spec link for ${entry.key}`);
      }
    }
    set({ excalidrawSpecLinks: links });
  },

  markSceneAsSpec: async (projectPath, scene) => {
    const fileJson = await excalidrawGetSceneContent(projectPath, scene.id);
    const { excalidrawSpecLinks } = get();

    // Re-importing the same scene overwrites its existing snapshot.
    const existing = Object.entries(excalidrawSpecLinks).find(
      ([, link]) => link.sceneId === scene.id
    );

    let relPath: string;
    if (existing) {
      relPath = existing[0];
    } else {
      const { allFilePaths = [] } = get() as ExcalidrawSlice & { allFilePaths?: string[] };
      const taken = (candidate: string) =>
        excalidrawSpecLinks[candidate] !== undefined ||
        allFilePaths.includes(`${projectPath}/${candidate}`);
      const slug = slugifySceneName(scene.name);
      relPath = `specs/${slug}.excalidraw`;
      for (let i = 2; taken(relPath); i++) {
        relPath = `specs/${slug}-${i}.excalidraw`;
      }
    }

    await writeFile(`${projectPath}/${relPath}`, fileJson);

    const link: ExcalidrawSpecLink = {
      sceneId: scene.id,
      collectionId: scene.collectionId,
      workspaceId: scene.workspaceId,
      sceneName: scene.name,
      importedAt: new Date().toISOString(),
    };
    await dbSet(projectPath, SPEC_LINKS_NAMESPACE, relPath, JSON.stringify(link));
    set((s) => ({ excalidrawSpecLinks: { ...s.excalidrawSpecLinks, [relPath]: link } }));
    return relPath;
  },

  resyncSpec: async (projectPath, relPath) => {
    const link = get().excalidrawSpecLinks[relPath];
    if (!link) throw new Error(`No Excalidraw+ link registered for ${relPath}`);

    set((s) => ({ excalidrawSyncing: { ...s.excalidrawSyncing, [relPath]: true } }));
    try {
      const fileJson = await excalidrawGetSceneContent(projectPath, link.sceneId);
      await writeFile(`${projectPath}/${relPath}`, fileJson);
      const updated: ExcalidrawSpecLink = { ...link, importedAt: new Date().toISOString() };
      await dbSet(projectPath, SPEC_LINKS_NAMESPACE, relPath, JSON.stringify(updated));
      set((s) => ({ excalidrawSpecLinks: { ...s.excalidrawSpecLinks, [relPath]: updated } }));
    } finally {
      set((s) => {
        const syncing = { ...s.excalidrawSyncing };
        delete syncing[relPath];
        return { excalidrawSyncing: syncing };
      });
    }
  },

  resyncAllSpecs: async (projectPath) => {
    // Sequential on purpose: friendly to the beta API's rate limits.
    let synced = 0;
    let failed = 0;
    for (const relPath of Object.keys(get().excalidrawSpecLinks)) {
      try {
        await get().resyncSpec(projectPath, relPath);
        synced++;
      } catch {
        failed++;
      }
    }
    return { synced, failed };
  },

  unlinkSpec: async (projectPath, relPath) => {
    await dbDelete(projectPath, SPEC_LINKS_NAMESPACE, relPath);
    set((s) => {
      const links = { ...s.excalidrawSpecLinks };
      delete links[relPath];
      return { excalidrawSpecLinks: links };
    });
  },

  removeSpecFile: async (projectPath, relPath) => {
    // Delete first: if it fails, the link stays so nothing dangles silently.
    await deleteFile(`${projectPath}/${relPath}`);
    if (get().excalidrawSpecLinks[relPath]) {
      await get().unlinkSpec(projectPath, relPath);
    }
  },

  resetExcalidrawInMemory: () => set({ ...initialState }),
});
