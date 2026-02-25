import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createBlueprintsSlice, type BlueprintsSlice } from './blueprintsSlice';
import type { Blueprint, BlueprintState } from '../tauri/blueprints';
import type { SyncResult } from '../blueprints/serverSync';

const mockBlueprintsLoad = vi.fn<(...args: unknown[]) => Promise<BlueprintState>>(() =>
  Promise.resolve({ blueprints: [] })
);
const mockBlueprintsSave = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockBlueprintsClear = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockInitProjectDb = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockSyncWithServer = vi.fn<(...args: unknown[]) => Promise<SyncResult>>(() =>
  Promise.resolve({ addedLocally: [], pushedToServer: [] })
);

vi.mock('../tauri/blueprints', () => ({
  blueprintsLoad: (...args: unknown[]) => mockBlueprintsLoad(...args),
  blueprintsSave: (...args: unknown[]) => mockBlueprintsSave(...args),
  blueprintsClear: (...args: unknown[]) => mockBlueprintsClear(...args),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: (...args: unknown[]) => mockInitProjectDb(...args),
}));

vi.mock('../blueprints/serverSync', () => ({
  syncWithServer: (...args: unknown[]) => mockSyncWithServer(...args),
}));

function createTestStore() {
  return create<BlueprintsSlice>()((...a) => ({ ...createBlueprintsSlice(...a) }));
}

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'bp1',
    name: 'Test Blueprint',
    techStack: 'React, TypeScript',
    goal: 'Build a test app',
    complexity: 'MEDIUM',
    category: 'architectures',
    description: '# Test\nSome description',
    spec: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('blueprintsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // --- UI state ---

  it('setBlueprintsModalOpen toggles modal', () => {
    const store = createTestStore();
    expect(store.getState().blueprintsModalOpen).toBe(false);
    store.getState().setBlueprintsModalOpen(true);
    expect(store.getState().blueprintsModalOpen).toBe(true);
  });

  it('setBlueprintsGalleryOpen opens and closes the gallery', () => {
    const store = createTestStore();
    expect(store.getState().blueprintsGalleryOpen).toBe(false);
    store.getState().setBlueprintsGalleryOpen(true);
    expect(store.getState().blueprintsGalleryOpen).toBe(true);
    store.getState().setBlueprintsGalleryOpen(false);
    expect(store.getState().blueprintsGalleryOpen).toBe(false);
  });

  it('setSelectedBlueprintId updates selected blueprint', () => {
    const store = createTestStore();
    expect(store.getState().selectedBlueprintId).toBeNull();
    store.getState().setSelectedBlueprintId('bp1');
    expect(store.getState().selectedBlueprintId).toBe('bp1');
  });

  // --- Add / Update / Delete ---

  it('addBlueprint adds to draft and sets dirty', () => {
    const store = createTestStore();
    const bp = makeBlueprint();
    store.getState().addBlueprint(bp);
    expect(store.getState().blueprintsDraft).toHaveLength(1);
    expect(store.getState().blueprintsDraft[0].id).toBe('bp1');
    expect(store.getState().blueprintsDirty).toBe(true);
  });

  it('updateBlueprint updates the correct draft', () => {
    const store = createTestStore();
    store.getState().addBlueprint(makeBlueprint({ id: 'bp1' }));
    store.getState().addBlueprint(makeBlueprint({ id: 'bp2', name: 'Other' }));
    store.getState().updateBlueprint('bp1', { name: 'Updated' });
    expect(store.getState().blueprintsDraft.find((b) => b.id === 'bp1')?.name).toBe('Updated');
    expect(store.getState().blueprintsDraft.find((b) => b.id === 'bp2')?.name).toBe('Other');
  });

  it('deleteBlueprint removes from draft and sets dirty', () => {
    const store = createTestStore();
    store.getState().addBlueprint(makeBlueprint({ id: 'bp1' }));
    store.getState().addBlueprint(makeBlueprint({ id: 'bp2' }));
    store.getState().deleteBlueprint('bp1');
    expect(store.getState().blueprintsDraft).toHaveLength(1);
    expect(store.getState().blueprintsDraft[0].id).toBe('bp2');
    expect(store.getState().blueprintsDirty).toBe(true);
  });

  // --- Load / Save / Discard ---

  it('loadBlueprints populates both persisted and draft', async () => {
    const bp = makeBlueprint();
    mockBlueprintsLoad.mockResolvedValueOnce({ blueprints: [bp] });

    const store = createTestStore();
    await store.getState().loadBlueprints('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(store.getState().blueprints).toHaveLength(1);
    expect(store.getState().blueprintsDraft).toHaveLength(1);
    expect(store.getState().blueprintsDirty).toBe(false);
    expect(store.getState().currentBlueprintsProject).toBe('/project');
  });

  it('loadBlueprints preserves dirty draft when reloading the same project', async () => {
    const persistedBp = makeBlueprint({ id: 'persisted' });
    const draftOnlyBp = makeBlueprint({ id: 'draft-only', name: 'Unsaved Blueprint' });
    mockBlueprintsLoad.mockResolvedValueOnce({ blueprints: [persistedBp] });

    const store = createTestStore();
    store.setState({
      blueprints: [persistedBp],
      blueprintsDraft: [persistedBp, draftOnlyBp],
      blueprintsDirty: true,
      currentBlueprintsProject: '/project',
    });

    await store.getState().loadBlueprints('/project');

    expect(store.getState().blueprintsDraft).toContainEqual(draftOnlyBp);
    expect(store.getState().blueprintsDirty).toBe(true);
    // Persisted snapshot is updated from IPC
    expect(store.getState().blueprints).toEqual([persistedBp]);
    expect(store.getState().currentBlueprintsProject).toBe('/project');
  });

  it('loadBlueprints resets dirty draft when switching to a different project', async () => {
    const newProjectBp = makeBlueprint({ id: 'new-project-bp', name: 'New Project Blueprint' });
    const draftOnlyBp = makeBlueprint({ id: 'draft-only', name: 'Unsaved Blueprint' });
    mockBlueprintsLoad.mockResolvedValueOnce({ blueprints: [newProjectBp] });

    const store = createTestStore();
    store.setState({
      blueprints: [],
      blueprintsDraft: [draftOnlyBp],
      blueprintsDirty: true,
      currentBlueprintsProject: '/old-project',
    });

    await store.getState().loadBlueprints('/new-project');

    expect(store.getState().blueprintsDraft).toEqual([newProjectBp]);
    expect(store.getState().blueprintsDirty).toBe(false);
    expect(store.getState().currentBlueprintsProject).toBe('/new-project');
  });

  it('saveBlueprints calls IPC and syncs state', async () => {
    const store = createTestStore();
    store.getState().addBlueprint(makeBlueprint());
    expect(store.getState().blueprintsDirty).toBe(true);

    await store.getState().saveBlueprints('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(mockBlueprintsSave).toHaveBeenCalledWith('/project', {
      blueprints: store.getState().blueprints,
    });
    expect(store.getState().blueprintsDirty).toBe(false);
    expect(store.getState().blueprints).toEqual(store.getState().blueprintsDraft);
  });

  it('clearBlueprints calls IPC and resets state', async () => {
    const store = createTestStore();
    store.getState().addBlueprint(makeBlueprint());

    await store.getState().clearBlueprints('/project');

    expect(mockInitProjectDb).toHaveBeenCalledWith('/project');
    expect(mockBlueprintsClear).toHaveBeenCalledWith('/project');
    expect(store.getState().blueprints).toHaveLength(0);
    expect(store.getState().blueprintsDraft).toHaveLength(0);
    expect(store.getState().blueprintsDirty).toBe(false);
  });

  it('discardBlueprintChanges restores persisted state', () => {
    const store = createTestStore();
    const bp = makeBlueprint();

    store.setState({
      blueprints: [bp],
      blueprintsDraft: [bp],
      blueprintsDirty: false,
    });

    store.getState().addBlueprint(makeBlueprint({ id: 'bp2', name: 'New' }));
    expect(store.getState().blueprintsDraft).toHaveLength(2);
    expect(store.getState().blueprintsDirty).toBe(true);

    store.getState().discardBlueprintChanges();
    expect(store.getState().blueprintsDraft).toHaveLength(1);
    expect(store.getState().blueprintsDraft[0].id).toBe('bp1');
    expect(store.getState().blueprintsDirty).toBe(false);
  });

  // --- Server URL persistence ---

  it('loadBlueprintServerUrl reads from localStorage', () => {
    localStorage.setItem('auric-blueprint-server-url', 'https://blueprints.example.com');
    const store = createTestStore();
    store.getState().loadBlueprintServerUrl();
    expect(store.getState().blueprintServerUrl).toBe('https://blueprints.example.com');
  });

  it('setBlueprintServerUrl writes to localStorage', () => {
    const store = createTestStore();
    store.getState().setBlueprintServerUrl('https://my-server.com');
    expect(store.getState().blueprintServerUrl).toBe('https://my-server.com');
    expect(localStorage.getItem('auric-blueprint-server-url')).toBe('https://my-server.com');
  });

  it('loadBlueprintServerUrl does nothing when key is absent', () => {
    const store = createTestStore();
    store.getState().loadBlueprintServerUrl();
    expect(store.getState().blueprintServerUrl).toBe('');
  });

  // --- syncWithBlueprintServer ---

  it('syncWithBlueprintServer sets status to syncing then success', async () => {
    mockSyncWithServer.mockResolvedValueOnce({ addedLocally: [], pushedToServer: [] });
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintSyncStatus).toBe('success');
  });

  it('syncWithBlueprintServer calls addBlueprint for each item in addedLocally', async () => {
    const serverBp = makeBlueprint({ id: 'server-new' });
    mockSyncWithServer.mockResolvedValueOnce({
      addedLocally: [serverBp],
      pushedToServer: [],
    });
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintsDraft).toContainEqual(serverBp);
  });

  it('syncWithBlueprintServer calls saveBlueprints when blueprints were added locally', async () => {
    const serverBp = makeBlueprint({ id: 'server-new' });
    mockSyncWithServer.mockResolvedValueOnce({
      addedLocally: [serverBp],
      pushedToServer: [],
    });
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(mockBlueprintsSave).toHaveBeenCalled();
  });

  it('syncWithBlueprintServer does not call saveBlueprints when nothing was added', async () => {
    mockSyncWithServer.mockResolvedValueOnce({ addedLocally: [], pushedToServer: [] });
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(mockBlueprintsSave).not.toHaveBeenCalled();
  });

  it('syncWithBlueprintServer sets unreachable on network error', async () => {
    mockSyncWithServer.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintSyncStatus).toBe('unreachable');
  });

  it('syncWithBlueprintServer sets unreachable on AbortError', async () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    mockSyncWithServer.mockRejectedValueOnce(err);
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintSyncStatus).toBe('unreachable');
  });

  it('syncWithBlueprintServer sets error status on non-network failure', async () => {
    mockSyncWithServer.mockRejectedValueOnce(new Error('Server returned 500'));
    const store = createTestStore();
    store.setState({ blueprintServerUrl: 'https://example.com' });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintSyncStatus).toBe('error');
    expect(store.getState().blueprintSyncError).toBe('Server returned 500');
  });

  it('syncWithBlueprintServer preserves locally-created blueprints when server adds new ones', async () => {
    const localBp = makeBlueprint({ id: 'local-only', name: 'Local Blueprint' });
    const serverBp = makeBlueprint({ id: 'server-only', name: 'Server Blueprint' });
    mockSyncWithServer.mockResolvedValueOnce({
      addedLocally: [serverBp],
      pushedToServer: [localBp],
    });

    const store = createTestStore();
    store.setState({
      blueprints: [localBp],
      blueprintsDraft: [localBp],
      blueprintsDirty: false,
      blueprintServerUrl: 'https://example.com',
    });

    await store.getState().syncWithBlueprintServer('/project');

    expect(store.getState().blueprintsDraft).toContainEqual(localBp);
    expect(store.getState().blueprintsDraft).toContainEqual(serverBp);
    expect(mockBlueprintsSave).toHaveBeenCalled();
    expect(store.getState().blueprintSyncStatus).toBe('success');
  });
});
