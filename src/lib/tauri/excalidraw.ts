import { invoke } from './invoke';
import type { ExcalidrawCollection, ExcalidrawSceneSummary } from '../excalidraw/types';

export async function excalidrawTestConnection(projectPath: string): Promise<string> {
  return await invoke<string>('excalidraw_test_connection', { projectPath });
}

export async function excalidrawListCollections(
  projectPath: string
): Promise<ExcalidrawCollection[]> {
  return await invoke<ExcalidrawCollection[]>('excalidraw_list_collections', { projectPath });
}

export async function excalidrawListScenes(
  projectPath: string,
  collectionId: string
): Promise<ExcalidrawSceneSummary[]> {
  return await invoke<ExcalidrawSceneSummary[]>('excalidraw_list_scenes', {
    projectPath,
    collectionId,
  });
}

/** Returns ready-to-write `.excalidraw` file JSON (validated + cleaned in Rust). */
export async function excalidrawGetSceneContent(
  projectPath: string,
  sceneId: string
): Promise<string> {
  return await invoke<string>('excalidraw_get_scene_content', { projectPath, sceneId });
}

export async function excalidrawSceneUrl(
  workspaceId: string | null,
  sceneId: string
): Promise<string> {
  return await invoke<string>('excalidraw_scene_url', { workspaceId, sceneId });
}
