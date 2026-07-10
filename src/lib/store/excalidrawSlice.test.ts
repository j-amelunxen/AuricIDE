import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcalidrawSceneSummary } from '../excalidraw/types';

const mockListCollections = vi.fn();
const mockListScenes = vi.fn();
const mockGetSceneContent = vi.fn();
vi.mock('@/lib/tauri/excalidraw', () => ({
  excalidrawListCollections: (...args: unknown[]) => mockListCollections(...args),
  excalidrawListScenes: (...args: unknown[]) => mockListScenes(...args),
  excalidrawGetSceneContent: (...args: unknown[]) => mockGetSceneContent(...args),
}));

const mockDbSet = vi.fn();
const mockDbDelete = vi.fn();
const mockDbList = vi.fn();
vi.mock('@/lib/tauri/db', () => ({
  dbSet: (...args: unknown[]) => mockDbSet(...args),
  dbDelete: (...args: unknown[]) => mockDbDelete(...args),
  dbList: (...args: unknown[]) => mockDbList(...args),
  dbGet: vi.fn(async () => null),
  initProjectDb: vi.fn(async () => {}),
  closeProjectDb: vi.fn(async () => {}),
}));

const mockWriteFile = vi.fn();
const mockDeleteFile = vi.fn();
vi.mock('@/lib/tauri/fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  };
});

import { useStore } from '@/lib/store';

const PROJECT = '/tmp/project';

function makeScene(overrides: Partial<ExcalidrawSceneSummary> = {}): ExcalidrawSceneSummary {
  return {
    id: 'scn_checkout',
    name: 'Checkout Flow',
    collectionId: 'col_flows',
    workspaceId: 'ws_1',
    updatedAt: '2026-07-05T16:20:00Z',
    previewUrl: null,
    ...overrides,
  };
}

describe('excalidrawSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.getState().resetExcalidrawInMemory();
    useStore.setState({ allFilePaths: [] });
    mockWriteFile.mockResolvedValue(undefined);
    mockDbSet.mockResolvedValue(undefined);
    mockDbDelete.mockResolvedValue(true);
  });

  it('starts closed, idle and without links', () => {
    const s = useStore.getState();
    expect(s.excalidrawBrowserOpen).toBe(false);
    expect(s.excalidrawCollections).toEqual([]);
    expect(s.excalidrawCollectionsStatus).toBe('idle');
    expect(s.excalidrawSpecLinks).toEqual({});
  });

  it('loads collections and stores them', async () => {
    mockListCollections.mockResolvedValue([
      { id: 'c1', name: 'Arch', emoji: null, updatedAt: null },
    ]);
    await useStore.getState().loadExcalidrawCollections(PROJECT);
    expect(useStore.getState().excalidrawCollections).toHaveLength(1);
    expect(useStore.getState().excalidrawCollectionsStatus).toBe('idle');
  });

  it('captures the taxonomy error when loading collections fails', async () => {
    mockListCollections.mockRejectedValue('EXCALIDRAW_AUTH: rejected (HTTP 401)');
    await useStore.getState().loadExcalidrawCollections(PROJECT);
    expect(useStore.getState().excalidrawCollectionsStatus).toBe('error');
    expect(useStore.getState().excalidrawError).toContain('EXCALIDRAW_AUTH');
  });

  it('selecting a collection loads its scenes', async () => {
    mockListScenes.mockResolvedValue([makeScene()]);
    await useStore.getState().selectExcalidrawCollection(PROJECT, 'col_flows');
    expect(useStore.getState().excalidrawSelectedCollectionId).toBe('col_flows');
    expect(mockListScenes).toHaveBeenCalledWith(PROJECT, 'col_flows');
    expect(useStore.getState().excalidrawScenes).toHaveLength(1);
  });

  it('previews a scene lazily', async () => {
    mockGetSceneContent.mockResolvedValue('{"type":"excalidraw","elements":[]}');
    await useStore.getState().previewExcalidrawScene(PROJECT, 'scn_checkout');
    expect(useStore.getState().excalidrawPreview?.sceneId).toBe('scn_checkout');
    expect(useStore.getState().excalidrawPreview?.fileJson).toContain('excalidraw');
  });

  it('loads spec links from the kv registry and skips malformed entries', async () => {
    mockDbList.mockResolvedValue([
      {
        namespace: 'excalidraw_specs',
        key: 'specs/checkout-flow.excalidraw',
        value: JSON.stringify({
          sceneId: 'scn_checkout',
          collectionId: 'col_flows',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        }),
        updated_at: '',
      },
      {
        namespace: 'excalidraw_specs',
        key: 'specs/broken.excalidraw',
        value: '{oops',
        updated_at: '',
      },
    ]);
    await useStore.getState().loadExcalidrawSpecLinks(PROJECT);
    const links = useStore.getState().excalidrawSpecLinks;
    expect(Object.keys(links)).toEqual(['specs/checkout-flow.excalidraw']);
    expect(links['specs/checkout-flow.excalidraw'].sceneId).toBe('scn_checkout');
  });

  it('marks a scene as spec: snapshot file + registered link', async () => {
    mockGetSceneContent.mockResolvedValue('{"type":"excalidraw","elements":[]}');
    const relPath = await useStore.getState().markSceneAsSpec(PROJECT, makeScene());

    expect(relPath).toBe('specs/checkout-flow.excalidraw');
    expect(mockWriteFile).toHaveBeenCalledWith(
      `${PROJECT}/specs/checkout-flow.excalidraw`,
      '{"type":"excalidraw","elements":[]}'
    );
    expect(mockDbSet).toHaveBeenCalledWith(
      PROJECT,
      'excalidraw_specs',
      'specs/checkout-flow.excalidraw',
      expect.stringContaining('"sceneId":"scn_checkout"')
    );
    expect(useStore.getState().excalidrawSpecLinks[relPath].sceneName).toBe('Checkout Flow');
  });

  it('suffixes the file name when a different file already occupies the slug', async () => {
    mockGetSceneContent.mockResolvedValue('{}');
    useStore.setState({ allFilePaths: [`${PROJECT}/specs/checkout-flow.excalidraw`] });
    const relPath = await useStore
      .getState()
      .markSceneAsSpec(PROJECT, makeScene({ id: 'scn_other' }));
    expect(relPath).toBe('specs/checkout-flow-2.excalidraw');
  });

  it('re-imports the same scene into its existing file instead of suffixing', async () => {
    mockGetSceneContent.mockResolvedValue('{}');
    useStore.setState({
      allFilePaths: [`${PROJECT}/specs/checkout-flow.excalidraw`],
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_checkout',
          collectionId: 'col_flows',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    const relPath = await useStore.getState().markSceneAsSpec(PROJECT, makeScene());
    expect(relPath).toBe('specs/checkout-flow.excalidraw');
  });

  it('re-syncs a linked spec and bumps importedAt', async () => {
    mockGetSceneContent.mockResolvedValue('{"fresh":true}');
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_checkout',
          collectionId: 'col_flows',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2020-01-01T00:00:00Z',
        },
      },
    });

    await useStore.getState().resyncSpec(PROJECT, 'specs/checkout-flow.excalidraw');

    expect(mockWriteFile).toHaveBeenCalledWith(
      `${PROJECT}/specs/checkout-flow.excalidraw`,
      '{"fresh":true}'
    );
    const link = useStore.getState().excalidrawSpecLinks['specs/checkout-flow.excalidraw'];
    expect(Date.parse(link.importedAt)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00Z'));
  });

  it('keeps the snapshot and link when the scene was deleted upstream', async () => {
    mockGetSceneContent.mockRejectedValue(
      'EXCALIDRAW_NOT_FOUND: GET /scenes/x — resource does not exist'
    );
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_gone',
          collectionId: null,
          workspaceId: null,
          sceneName: 'Checkout Flow',
          importedAt: '2020-01-01T00:00:00Z',
        },
      },
    });

    await expect(
      useStore.getState().resyncSpec(PROJECT, 'specs/checkout-flow.excalidraw')
    ).rejects.toMatch(/EXCALIDRAW_NOT_FOUND/);

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(useStore.getState().excalidrawSpecLinks['specs/checkout-flow.excalidraw']).toBeDefined();
  });

  it('sync-all reports synced and failed counts', async () => {
    mockGetSceneContent
      .mockResolvedValueOnce('{"a":1}')
      .mockRejectedValueOnce('EXCALIDRAW_NOT_FOUND: gone');
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/a.excalidraw': {
          sceneId: 's_a',
          collectionId: null,
          workspaceId: null,
          sceneName: 'A',
          importedAt: '',
        },
        'specs/b.excalidraw': {
          sceneId: 's_b',
          collectionId: null,
          workspaceId: null,
          sceneName: 'B',
          importedAt: '',
        },
      },
    });

    const result = await useStore.getState().resyncAllSpecs(PROJECT);
    expect(result).toEqual({ synced: 1, failed: 1 });
  });

  it('removes the local copy: deletes the file and the link, remote untouched', async () => {
    mockDeleteFile.mockResolvedValue(undefined);
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/a.excalidraw': {
          sceneId: 's_a',
          collectionId: null,
          workspaceId: null,
          sceneName: 'A',
          importedAt: '',
        },
      },
    });

    await useStore.getState().removeSpecFile(PROJECT, 'specs/a.excalidraw');

    expect(mockDeleteFile).toHaveBeenCalledWith(`${PROJECT}/specs/a.excalidraw`);
    expect(mockDbDelete).toHaveBeenCalledWith(PROJECT, 'excalidraw_specs', 'specs/a.excalidraw');
    expect(useStore.getState().excalidrawSpecLinks).toEqual({});
  });

  it('keeps the link when deleting the local file fails', async () => {
    mockDeleteFile.mockRejectedValue('EACCES: permission denied');
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/a.excalidraw': {
          sceneId: 's_a',
          collectionId: null,
          workspaceId: null,
          sceneName: 'A',
          importedAt: '',
        },
      },
    });

    await expect(useStore.getState().removeSpecFile(PROJECT, 'specs/a.excalidraw')).rejects.toMatch(
      /EACCES/
    );

    expect(mockDbDelete).not.toHaveBeenCalled();
    expect(useStore.getState().excalidrawSpecLinks['specs/a.excalidraw']).toBeDefined();
  });

  it('can also remove an unlinked local file (plain delete)', async () => {
    mockDeleteFile.mockResolvedValue(undefined);
    await useStore.getState().removeSpecFile(PROJECT, 'specs/loose.excalidraw');
    expect(mockDeleteFile).toHaveBeenCalledWith(`${PROJECT}/specs/loose.excalidraw`);
  });

  it('unlinks a spec but leaves the local file alone', async () => {
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/a.excalidraw': {
          sceneId: 's_a',
          collectionId: null,
          workspaceId: null,
          sceneName: 'A',
          importedAt: '',
        },
      },
    });

    await useStore.getState().unlinkSpec(PROJECT, 'specs/a.excalidraw');

    expect(mockDbDelete).toHaveBeenCalledWith(PROJECT, 'excalidraw_specs', 'specs/a.excalidraw');
    expect(useStore.getState().excalidrawSpecLinks).toEqual({});
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
