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

describe('recentProjectsSlice', () => {
  beforeEach(() => {
    useStore.setState({ recentProjects: [] });
  });

  it('starts with an empty list', () => {
    expect(useStore.getState().recentProjects).toEqual([]);
  });

  it('adds a recent project', () => {
    useStore.getState().addRecentProject('/Users/jen/my-app');
    const projects = useStore.getState().recentProjects;
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe('/Users/jen/my-app');
    expect(projects[0].name).toBe('my-app');
    expect(projects[0].openedAt).toBeGreaterThan(0);
  });

  it('moves an existing project to the top', () => {
    useStore.getState().addRecentProject('/a');
    useStore.getState().addRecentProject('/b');
    useStore.getState().addRecentProject('/a');
    const projects = useStore.getState().recentProjects;
    expect(projects).toHaveLength(2);
    expect(projects[0].path).toBe('/a');
    expect(projects[1].path).toBe('/b');
  });

  it('caps the list at 5 projects', () => {
    for (let i = 1; i <= 7; i++) {
      useStore.getState().addRecentProject(`/project-${i}`);
    }
    const projects = useStore.getState().recentProjects;
    expect(projects).toHaveLength(5);
    expect(projects[0].path).toBe('/project-7');
    expect(projects[4].path).toBe('/project-3');
  });

  it('removes a recent project', () => {
    useStore.getState().addRecentProject('/a');
    useStore.getState().addRecentProject('/b');
    useStore.getState().removeRecentProject('/a');
    const projects = useStore.getState().recentProjects;
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe('/b');
  });

  it('persists to localStorage on add', () => {
    useStore.getState().addRecentProject('/my-project');
    expect(localStorage.setItem).toHaveBeenCalledWith('auric-recent-projects', expect.any(String));
    const stored = JSON.parse(mockStorage['auric-recent-projects']);
    expect(stored).toHaveLength(1);
    expect(stored[0].path).toBe('/my-project');
  });

  it('persists to localStorage on remove', () => {
    useStore.getState().addRecentProject('/a');
    useStore.getState().removeRecentProject('/a');
    const stored = JSON.parse(mockStorage['auric-recent-projects']);
    expect(stored).toHaveLength(0);
  });

  it('loads projects from localStorage', () => {
    const saved = [
      { path: '/saved-1', name: 'saved-1', openedAt: 1000 },
      { path: '/saved-2', name: 'saved-2', openedAt: 900 },
    ];
    mockStorage['auric-recent-projects'] = JSON.stringify(saved);

    useStore.getState().loadRecentProjects();
    const projects = useStore.getState().recentProjects;
    expect(projects).toHaveLength(2);
    expect(projects[0].path).toBe('/saved-1');
    expect(projects[1].path).toBe('/saved-2');
  });

  it('handles invalid localStorage data gracefully', () => {
    mockStorage['auric-recent-projects'] = 'not-json';
    useStore.getState().loadRecentProjects();
    expect(useStore.getState().recentProjects).toEqual([]);
  });

  it('derives the project name from the last path segment', () => {
    useStore.getState().addRecentProject('/Users/jen/projects/cool-app');
    expect(useStore.getState().recentProjects[0].name).toBe('cool-app');
  });
});
