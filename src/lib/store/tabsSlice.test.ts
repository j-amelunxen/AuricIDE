import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from './index';

describe('tabsSlice', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
    });
  });

  it('starts with no tabs', () => {
    const state = useStore.getState();
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it('opens a tab and makes it active', () => {
    useStore.getState().openTab({ id: '/README.md', path: '/README.md', name: 'README.md' });
    const state = useStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0].id).toBe('/README.md');
    expect(state.activeTabId).toBe('/README.md');
  });

  it('does not duplicate an already open tab', () => {
    useStore.getState().openTab({ id: '/README.md', path: '/README.md', name: 'README.md' });
    useStore.getState().openTab({ id: '/README.md', path: '/README.md', name: 'README.md' });
    expect(useStore.getState().openTabs).toHaveLength(1);
    expect(useStore.getState().activeTabId).toBe('/README.md');
  });

  it('closes a tab', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().closeTab('/a.md');
    expect(useStore.getState().openTabs).toHaveLength(1);
    expect(useStore.getState().openTabs[0].id).toBe('/b.md');
  });

  it('activates the previous tab when closing active tab', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    // b.md is now active
    useStore.getState().closeTab('/b.md');
    expect(useStore.getState().activeTabId).toBe('/a.md');
  });

  it('marks a tab as dirty', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().markDirty('/a.md', true);
    expect(useStore.getState().openTabs[0].isDirty).toBe(true);
  });

  it('clears dirty flag', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().markDirty('/a.md', true);
    useStore.getState().markDirty('/a.md', false);
    expect(useStore.getState().openTabs[0].isDirty).toBe(false);
  });

  it('closeOtherTabs keeps only the specified tab', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().openTab({ id: '/c.md', path: '/c.md', name: 'c.md' });
    useStore.getState().closeOtherTabs('/b.md');
    expect(useStore.getState().openTabs).toHaveLength(1);
    expect(useStore.getState().openTabs[0].id).toBe('/b.md');
    expect(useStore.getState().activeTabId).toBe('/b.md');
  });

  it('closeAllTabs removes all tabs', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().closeAllTabs();
    expect(useStore.getState().openTabs).toHaveLength(0);
    expect(useStore.getState().activeTabId).toBeNull();
  });

  it('closeTabsToRight closes tabs to the right of the specified tab', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().openTab({ id: '/c.md', path: '/c.md', name: 'c.md' });
    useStore.getState().closeTabsToRight('/a.md');
    expect(useStore.getState().openTabs).toHaveLength(1);
    expect(useStore.getState().openTabs[0].id).toBe('/a.md');
  });

  it('closeTabsToRight activates the target tab if active was to the right', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().openTab({ id: '/c.md', path: '/c.md', name: 'c.md' });
    // c.md is active
    useStore.getState().closeTabsToRight('/a.md');
    expect(useStore.getState().activeTabId).toBe('/a.md');
  });
});

describe('tabsSlice - diagnostics cleanup on tab close', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      diagnostics: new Map(),
    });
  });

  const sampleDiag = {
    line: 1,
    column: 1,
    message: 'oops',
    ruleId: 'rule',
    severity: 'error' as const,
  };

  it('closeTab clears diagnostics for the closed file', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().setDiagnostics('/a.md', [sampleDiag]);
    expect(useStore.getState().diagnostics.get('/a.md')).toHaveLength(1);

    useStore.getState().closeTab('/a.md');
    expect(useStore.getState().diagnostics.has('/a.md')).toBe(false);
  });

  it('closeAllTabs clears diagnostics for every open file', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().setDiagnostics('/a.md', [sampleDiag]);
    useStore.getState().setDiagnostics('/b.md', [sampleDiag]);

    useStore.getState().closeAllTabs();
    expect(useStore.getState().diagnostics.size).toBe(0);
  });

  it('closeOtherTabs clears diagnostics for the closed files but keeps the kept one', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().setDiagnostics('/a.md', [sampleDiag]);
    useStore.getState().setDiagnostics('/b.md', [sampleDiag]);

    useStore.getState().closeOtherTabs('/b.md');
    expect(useStore.getState().diagnostics.has('/a.md')).toBe(false);
    expect(useStore.getState().diagnostics.has('/b.md')).toBe(true);
  });

  it('closeTabsToRight clears diagnostics for the closed files', () => {
    useStore.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/b.md', path: '/b.md', name: 'b.md' });
    useStore.getState().openTab({ id: '/c.md', path: '/c.md', name: 'c.md' });
    useStore.getState().setDiagnostics('/c.md', [sampleDiag]);

    useStore.getState().closeTabsToRight('/a.md');
    expect(useStore.getState().diagnostics.has('/c.md')).toBe(false);
  });

  it('renamePath re-points an open tab (id, path, name, active) when its file moves', () => {
    useStore.getState().openTab({ id: '/note.md', path: '/note.md', name: 'note.md' });
    useStore.getState().renamePath('/note.md', '/docs/note.md');

    const state = useStore.getState();
    expect(state.openTabs).toHaveLength(1);
    expect(state.openTabs[0]).toMatchObject({
      id: '/docs/note.md',
      path: '/docs/note.md',
      name: 'note.md',
    });
    expect(state.activeTabId).toBe('/docs/note.md');
  });

  it('renamePath follows tabs for files under a moved folder', () => {
    useStore.getState().openTab({ id: '/src/a.md', path: '/src/a.md', name: 'a.md' });
    useStore.getState().openTab({ id: '/other.md', path: '/other.md', name: 'other.md' });

    useStore.getState().renamePath('/src', '/lib/src');

    const paths = useStore.getState().openTabs.map((t) => t.path);
    expect(paths).toContain('/lib/src/a.md');
    expect(paths).toContain('/other.md'); // unrelated tab untouched
  });

  it('renamePath drops stale diagnostics keyed by the old path', () => {
    useStore.getState().openTab({ id: '/note.md', path: '/note.md', name: 'note.md' });
    useStore.getState().setDiagnostics('/note.md', [sampleDiag]);

    useStore.getState().renamePath('/note.md', '/docs/note.md');

    expect(useStore.getState().diagnostics.has('/note.md')).toBe(false);
  });
});

describe('tabsSlice - diff payload cleanup on tab close', () => {
  const sample = {
    patch: 'diff --git a/a.ts b/a.ts\n+one',
    filePath: 'src/a.ts',
    source: { kind: 'unstaged' as const },
    repoPath: '/repo',
  };

  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      diffByTabId: {},
    });
  });

  it('closeTab on a diff: id calls clearDiffTab via the combined store', () => {
    const id = 'diff:unstaged:src/a.ts';
    useStore.getState().setDiffTab(id, sample);
    useStore.getState().openTab({ id, path: 'src/a.ts', name: 'a.ts (diff)' });

    useStore.getState().closeTab(id);

    expect(useStore.getState().diffByTabId[id]).toBeUndefined();
  });

  it('closeAllTabs clears every stored diff payload', () => {
    useStore.getState().setDiffTab('diff:unstaged:src/a.ts', sample);
    useStore.getState().setDiffTab('diff:unstaged:src/b.ts', { ...sample, filePath: 'src/b.ts' });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/a.ts',
      path: 'src/a.ts',
      name: 'a.ts (diff)',
    });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/b.ts',
      path: 'src/b.ts',
      name: 'b.ts (diff)',
    });

    useStore.getState().closeAllTabs();

    expect(useStore.getState().diffByTabId).toEqual({});
  });

  it('closeOtherTabs keeps the remaining tab payload', () => {
    useStore.getState().setDiffTab('diff:unstaged:src/a.ts', sample);
    useStore.getState().setDiffTab('diff:unstaged:src/b.ts', { ...sample, filePath: 'src/b.ts' });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/a.ts',
      path: 'src/a.ts',
      name: 'a.ts (diff)',
    });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/b.ts',
      path: 'src/b.ts',
      name: 'b.ts (diff)',
    });

    useStore.getState().closeOtherTabs('diff:unstaged:src/b.ts');

    expect(useStore.getState().diffByTabId['diff:unstaged:src/a.ts']).toBeUndefined();
    expect(useStore.getState().diffByTabId['diff:unstaged:src/b.ts']?.filePath).toBe('src/b.ts');
  });

  it('closeTabsToRight clears payloads for the closed tabs', () => {
    useStore.getState().setDiffTab('diff:unstaged:src/a.ts', sample);
    useStore.getState().setDiffTab('diff:unstaged:src/c.ts', { ...sample, filePath: 'src/c.ts' });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/a.ts',
      path: 'src/a.ts',
      name: 'a.ts (diff)',
    });
    useStore.getState().openTab({
      id: 'diff:unstaged:src/c.ts',
      path: 'src/c.ts',
      name: 'c.ts (diff)',
    });

    useStore.getState().closeTabsToRight('diff:unstaged:src/a.ts');

    expect(useStore.getState().diffByTabId['diff:unstaged:src/c.ts']).toBeUndefined();
    expect(useStore.getState().diffByTabId['diff:unstaged:src/a.ts']).toEqual(sample);
  });
});
