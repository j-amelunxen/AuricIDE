import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createBlueprintsSlice, type BlueprintsSlice } from './blueprintsSlice';
import type { Blueprint, BlueprintState } from '../tauri/blueprints';

const mockBlueprintsLoad = vi.fn<(...args: unknown[]) => Promise<BlueprintState>>(() =>
  Promise.resolve({ blueprints: [] })
);
const mockBlueprintsSave = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockBlueprintsClear = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
const mockInitProjectDb = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());

vi.mock('../tauri/blueprints', () => ({
  blueprintsLoad: (...args: unknown[]) => mockBlueprintsLoad(...args),
  blueprintsSave: (...args: unknown[]) => mockBlueprintsSave(...args),
  blueprintsClear: (...args: unknown[]) => mockBlueprintsClear(...args),
}));

vi.mock('../tauri/db', () => ({
  initProjectDb: (...args: unknown[]) => mockInitProjectDb(...args),
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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('blueprintsSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- UI state ---

  it('setBlueprintsModalOpen toggles modal', () => {
    const store = createTestStore();
    expect(store.getState().blueprintsModalOpen).toBe(false);
    store.getState().setBlueprintsModalOpen(true);
    expect(store.getState().blueprintsModalOpen).toBe(true);
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
});
