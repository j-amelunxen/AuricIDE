import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useStore } from './index';

const mockStorage: Record<string, string> = {};

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => mockStorage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      mockStorage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete mockStorage[key];
    }),
  });
});

describe('starredProjectsSlice', () => {
  beforeEach(() => {
    useStore.setState({ starredProjects: [], recentProjects: [] });
  });

  it('starts with an empty list', () => {
    expect(useStore.getState().starredProjects).toEqual([]);
  });

  it('stars a project and derives its name', () => {
    useStore.getState().addStarredProject('/Users/jen/apps');
    const [first] = useStore.getState().starredProjects;
    expect(first.path).toBe('/Users/jen/apps');
    expect(first.name).toBe('apps');
    expect(first.starredAt).toBeGreaterThan(0);
  });

  it('is idempotent — starring an already-starred project does not duplicate it', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/a');
    expect(useStore.getState().starredProjects).toHaveLength(1);
  });

  it('unstars a project', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().removeStarredProject('/a');
    expect(useStore.getState().starredProjects).toHaveLength(0);
  });

  it('toggles a project on and off', () => {
    useStore.getState().toggleStarredProject('/a');
    expect(useStore.getState().isProjectStarred('/a')).toBe(true);
    useStore.getState().toggleStarredProject('/a');
    expect(useStore.getState().isProjectStarred('/a')).toBe(false);
  });

  // The locality invariant: Quick Access must NOT reorder by recency.
  it('keeps stable insertion order regardless of which project was opened last', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/b');
    // Re-opening A must not move B — opening touches recents, not stars.
    useStore.getState().addRecentProject('/a');
    // Re-starring A is a no-op and must not move it either.
    useStore.getState().addStarredProject('/a');
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/a', '/b']);
  });

  it('appends new stars to the end so existing tiles never shift', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/b');
    useStore.getState().addStarredProject('/c');
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/a', '/b', '/c']);
  });

  it('persists to localStorage on star and unstar', () => {
    useStore.getState().addStarredProject('/a');
    expect(JSON.parse(mockStorage['auric-starred-projects'])).toHaveLength(1);
    useStore.getState().removeStarredProject('/a');
    expect(JSON.parse(mockStorage['auric-starred-projects'])).toHaveLength(0);
  });

  it('loads starred projects from localStorage', () => {
    mockStorage['auric-starred-projects'] = JSON.stringify([
      { path: '/x', name: 'x', starredAt: 1 },
      { path: '/y', name: 'y', starredAt: 2 },
    ]);
    useStore.getState().loadStarredProjects();
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/x', '/y']);
  });

  it('handles corrupted localStorage data gracefully', () => {
    mockStorage['auric-starred-projects'] = 'not-json';
    useStore.getState().loadStarredProjects();
    expect(useStore.getState().starredProjects).toEqual([]);
  });
});
