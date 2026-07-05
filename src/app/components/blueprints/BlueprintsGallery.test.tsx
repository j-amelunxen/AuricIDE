import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlueprintsGallery } from './BlueprintsGallery';

const storeState = {
  blueprintsGalleryOpen: true,
  setBlueprintsGalleryOpen: vi.fn(),
  blueprintsDraft: [],
  blueprintsDirty: false,
  blueprintsModalOpen: false,
  selectedBlueprintId: null,
  blueprintServerUrl: null,
  blueprintSyncStatus: 'idle',
  blueprintSyncError: null,
  rootPath: '/project',
  addBlueprint: vi.fn(),
  updateBlueprint: vi.fn(),
  deleteBlueprint: vi.fn(),
  discardBlueprintChanges: vi.fn(),
  saveBlueprints: vi.fn(),
  setBlueprintsModalOpen: vi.fn(),
  setSelectedBlueprintId: vi.fn(),
};

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

describe('BlueprintsGallery', () => {
  it('exposes an accessible dialog', () => {
    render(<BlueprintsGallery />);
    expect(screen.getByRole('dialog', { name: /blueprints/i })).toBeInTheDocument();
  });
});
