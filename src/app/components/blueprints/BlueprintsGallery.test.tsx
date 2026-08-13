import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlueprintsGallery } from './BlueprintsGallery';
import type { Blueprint } from '@/lib/tauri/blueprints';

const mockDeleteBlueprint = vi.fn();
const mockSetSelectedBlueprintId = vi.fn();
const mockSaveBlueprints = vi.fn();

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'bp1',
    name: 'Auth Service',
    techStack: 'React, TypeScript',
    goal: 'Build a test app',
    complexity: 'MEDIUM',
    category: 'architectures',
    description: '# Test',
    spec: '# Spec',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

const defaultStoreState = {
  blueprintsGalleryOpen: true,
  setBlueprintsGalleryOpen: vi.fn(),
  blueprintsDraft: [] as Blueprint[],
  blueprintsDirty: false,
  blueprintsModalOpen: false,
  selectedBlueprintId: null as string | null,
  blueprintServerUrl: null,
  blueprintSyncStatus: 'idle',
  blueprintSyncError: null,
  rootPath: '/project',
  addBlueprint: vi.fn(),
  updateBlueprint: vi.fn(),
  deleteBlueprint: mockDeleteBlueprint,
  discardBlueprintChanges: vi.fn(),
  saveBlueprints: mockSaveBlueprints,
  setBlueprintsModalOpen: vi.fn(),
  setSelectedBlueprintId: mockSetSelectedBlueprintId,
  overlayStack: { layers: [] as { id: string; kind: string }[] },
  pushOverlay: (entry: { id: string; kind: string }) => {
    if (storeState.overlayStack.layers.some((layer) => layer.id === entry.id)) return;
    storeState.overlayStack = { layers: [...storeState.overlayStack.layers, entry] };
  },
  removeOverlay: (id: string) => {
    storeState.overlayStack = {
      layers: storeState.overlayStack.layers.filter((layer) => layer.id !== id),
    };
  },
  ownsEscape: (id: string) => storeState.overlayStack.layers.at(-1)?.id === id,
};

let storeState = { ...defaultStoreState };

vi.mock('@/lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}));

describe('BlueprintsGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = { ...defaultStoreState };
  });

  afterEach(() => {
    storeState.overlayStack = { layers: [] };
  });

  it('exposes an accessible dialog', () => {
    render(<BlueprintsGallery />);
    expect(screen.getByRole('dialog', { name: /blueprints/i })).toBeInTheDocument();
  });

  it('closes the gallery on Escape', () => {
    render(<BlueprintsGallery />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(storeState.setBlueprintsGalleryOpen).toHaveBeenCalledWith(false);
  });

  it('closes the reader only when Escape is pressed while reading', async () => {
    const user = userEvent.setup();
    storeState.blueprintsDraft = [makeBlueprint()];
    storeState.selectedBlueprintId = 'bp1';
    render(<BlueprintsGallery />);

    await user.click(screen.getByRole('button', { name: /read/i }));
    expect(screen.getByRole('dialog', { name: 'Auth Service' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Auth Service' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /blueprints/i })).toBeInTheDocument();
    expect(storeState.setBlueprintsGalleryOpen).not.toHaveBeenCalledWith(false);
  });

  describe('deleting a blueprint', () => {
    beforeEach(() => {
      storeState.blueprintsDraft = [makeBlueprint()];
      storeState.selectedBlueprintId = 'bp1';
    });

    it('does not close the gallery when Escape is pressed during delete confirm', async () => {
      const user = userEvent.setup();
      render(<BlueprintsGallery />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByRole('dialog', { name: 'Delete this blueprint?' });

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(storeState.setBlueprintsGalleryOpen).not.toHaveBeenCalledWith(false);
      expect(mockDeleteBlueprint).not.toHaveBeenCalled();
    });

    it('does not delete the blueprint while the confirmation is still open', async () => {
      const user = userEvent.setup();
      render(<BlueprintsGallery />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      await screen.findByRole('dialog', { name: 'Delete this blueprint?' });
      expect(mockDeleteBlueprint).not.toHaveBeenCalled();
      expect(mockSetSelectedBlueprintId).not.toHaveBeenCalledWith(null);
    });

    it('names the blueprint and says the delete is permanent', async () => {
      const user = userEvent.setup();
      render(<BlueprintsGallery />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this blueprint?' });

      expect(dialog.textContent).toContain('Auth Service');
      expect(dialog.textContent).toMatch(/permanent/i);
    });

    it('deletes the blueprint once the delete is confirmed', async () => {
      const user = userEvent.setup();
      render(<BlueprintsGallery />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this blueprint?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockDeleteBlueprint).toHaveBeenCalledWith('bp1');
        expect(mockSetSelectedBlueprintId).toHaveBeenCalledWith(null);
      });
    });

    it('keeps the blueprint when the delete is declined', async () => {
      const user = userEvent.setup();
      render(<BlueprintsGallery />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this blueprint?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Delete this blueprint?' })
        ).not.toBeInTheDocument()
      );
      expect(mockDeleteBlueprint).not.toHaveBeenCalled();
      expect(mockSetSelectedBlueprintId).not.toHaveBeenCalledWith(null);
    });
  });
});
