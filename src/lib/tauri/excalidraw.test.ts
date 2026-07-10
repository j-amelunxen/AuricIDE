import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  excalidrawTestConnection,
  excalidrawListCollections,
  excalidrawListScenes,
  excalidrawGetSceneContent,
  excalidrawSceneUrl,
} from './excalidraw';

describe('excalidraw IPC wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('tests the connection for a project', async () => {
    mockInvoke.mockResolvedValue('Connected to Excalidraw+ — 3 collection(s) visible');
    const result = await excalidrawTestConnection('/p');
    expect(mockInvoke).toHaveBeenCalledWith('excalidraw_test_connection', { projectPath: '/p' });
    expect(result).toContain('Connected');
  });

  it('lists collections', async () => {
    mockInvoke.mockResolvedValue([{ id: 'c1', name: 'Arch', emoji: null, updatedAt: null }]);
    const collections = await excalidrawListCollections('/p');
    expect(mockInvoke).toHaveBeenCalledWith('excalidraw_list_collections', { projectPath: '/p' });
    expect(collections[0].id).toBe('c1');
  });

  it('lists scenes of a collection', async () => {
    mockInvoke.mockResolvedValue([]);
    await excalidrawListScenes('/p', 'col_1');
    expect(mockInvoke).toHaveBeenCalledWith('excalidraw_list_scenes', {
      projectPath: '/p',
      collectionId: 'col_1',
    });
  });

  it('fetches scene content as ready-to-write file JSON', async () => {
    mockInvoke.mockResolvedValue('{"type":"excalidraw"}');
    const json = await excalidrawGetSceneContent('/p', 'scn_1');
    expect(mockInvoke).toHaveBeenCalledWith('excalidraw_get_scene_content', {
      projectPath: '/p',
      sceneId: 'scn_1',
    });
    expect(json).toContain('excalidraw');
  });

  it('builds the scene web URL', async () => {
    mockInvoke.mockResolvedValue('https://app.excalidraw.com/s/ws/scn');
    const url = await excalidrawSceneUrl('ws', 'scn');
    expect(mockInvoke).toHaveBeenCalledWith('excalidraw_scene_url', {
      workspaceId: 'ws',
      sceneId: 'scn',
    });
    expect(url).toContain('app.excalidraw.com');
  });

  it('propagates taxonomy errors verbatim', async () => {
    mockInvoke.mockRejectedValue('EXCALIDRAW_AUTH: Excalidraw+ rejected the API key (HTTP 401)');
    await expect(excalidrawListCollections('/p')).rejects.toMatch(/^EXCALIDRAW_AUTH:/);
  });
});
