import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlueprintsPanel } from './BlueprintsPanel';
import type { Blueprint } from '@/lib/tauri/blueprints';

const mockLoadBlueprints = vi.fn();
const mockSaveBlueprints = vi.fn();
const mockAddBlueprint = vi.fn();
const mockDeleteBlueprint = vi.fn();
const mockDiscardBlueprintChanges = vi.fn();
const mockSetBlueprintsModalOpen = vi.fn();
const mockSetSelectedBlueprintId = vi.fn();

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'bp1',
    name: 'Test Blueprint',
    techStack: 'React, TypeScript',
    goal: 'Build a test app',
    complexity: 'MEDIUM',
    category: 'architectures',
    description: '# Test',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

const defaultStoreState = {
  blueprintsDraft: [] as Blueprint[],
  blueprintsDirty: false,
  blueprintsModalOpen: false,
  selectedBlueprintId: null as string | null,
  rootPath: '/project',
  loadBlueprints: mockLoadBlueprints,
  saveBlueprints: mockSaveBlueprints,
  addBlueprint: mockAddBlueprint,
  deleteBlueprint: mockDeleteBlueprint,
  discardBlueprintChanges: mockDiscardBlueprintChanges,
  setBlueprintsModalOpen: mockSetBlueprintsModalOpen,
  setSelectedBlueprintId: mockSetSelectedBlueprintId,
};

let storeState = { ...defaultStoreState };

vi.mock('@/lib/store', () => ({
  useStore: (selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState,
}));

describe('BlueprintsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = { ...defaultStoreState };
  });

  it('renders header with title', () => {
    render(<BlueprintsPanel />);
    expect(screen.getByText('Blueprints')).toBeDefined();
  });

  it('renders empty state when no blueprints', () => {
    render(<BlueprintsPanel />);
    expect(screen.getByText('No blueprints yet')).toBeDefined();
  });

  it('renders create button in empty state', () => {
    render(<BlueprintsPanel />);
    expect(screen.getByText('Create Blueprint')).toBeDefined();
  });

  it('loads blueprints on mount when rootPath is set', () => {
    render(<BlueprintsPanel />);
    expect(mockLoadBlueprints).toHaveBeenCalledWith('/project');
  });

  it('renders blueprints grouped by category', () => {
    storeState = {
      ...defaultStoreState,
      blueprintsDraft: [
        makeBlueprint({ id: 'bp1', name: 'Arch BP', category: 'architectures' }),
        makeBlueprint({ id: 'bp2', name: 'Opt BP', category: 'optimizations' }),
      ],
    };
    render(<BlueprintsPanel />);
    expect(screen.getByText('Architectures')).toBeDefined();
    expect(screen.getByText('Optimizations')).toBeDefined();
    expect(screen.getByText('Arch BP')).toBeDefined();
    expect(screen.getByText('Opt BP')).toBeDefined();
  });

  it('shows + button that opens modal', async () => {
    render(<BlueprintsPanel />);
    const user = userEvent.setup();
    const addBtn = screen.getByTitle('New blueprint');
    await user.click(addBtn);
    expect(mockSetBlueprintsModalOpen).toHaveBeenCalledWith(true);
  });

  it('shows save/discard buttons when dirty', () => {
    storeState = {
      ...defaultStoreState,
      blueprintsDirty: true,
      blueprintsDraft: [makeBlueprint()],
    };
    render(<BlueprintsPanel />);
    expect(screen.getByText('Save')).toBeDefined();
    expect(screen.getByText('Discard')).toBeDefined();
  });

  it('does not show save/discard when not dirty and no selection', () => {
    storeState = {
      ...defaultStoreState,
      blueprintsDirty: false,
      selectedBlueprintId: null,
    };
    render(<BlueprintsPanel />);
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Discard')).toBeNull();
  });

  it('shows delete button when a blueprint is selected', () => {
    storeState = {
      ...defaultStoreState,
      blueprintsDraft: [makeBlueprint()],
      selectedBlueprintId: 'bp1',
    };
    render(<BlueprintsPanel />);
    expect(screen.getByText('Delete')).toBeDefined();
  });
});
