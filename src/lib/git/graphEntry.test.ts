import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { graphTabId } from './graphTabId';
import { openGraphTab, repoForGraph, showGraph } from './graphEntry';

const repo = (path: string, name: string) => ({
  path,
  name,
  relativePath: '',
  kind: 'root' as const,
});

describe('repoForGraph', () => {
  it('prefers the repo of an open graph tab', () => {
    expect(
      repoForGraph({
        activeTabId: graphTabId('/work/b'),
        repos: [repo('/work/a', 'a'), repo('/work/b', 'b')],
        activeRepoPath: '/work/a',
      })
    ).toBe('/work/b');
  });

  it('falls back to the active repo, then to the only repo', () => {
    const repos = [repo('/work/a', 'a'), repo('/work/b', 'b')];
    expect(repoForGraph({ activeTabId: null, repos, activeRepoPath: '/work/b' })).toBe('/work/b');
    expect(repoForGraph({ activeTabId: null, repos: [repos[0]], activeRepoPath: null })).toBe(
      '/work/a'
    );
  });

  it('has no answer for several repos and none active', () => {
    expect(
      repoForGraph({
        activeTabId: null,
        repos: [repo('/work/a', 'a'), repo('/work/b', 'b')],
        activeRepoPath: null,
      })
    ).toBeNull();
  });
});

describe('openGraphTab', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      repos: [repo('/work/app', 'app')],
      activeRepoPath: '/work/app',
      toasts: [],
      openGraph: vi.fn(async () => undefined),
    });
  });

  it('opens one tab named after the repo folder, and a second call only focuses it', () => {
    openGraphTab('/work/app');
    openGraphTab('/work/app');
    const { openTabs, activeTabId } = useStore.getState();
    expect(openTabs).toEqual([
      { id: graphTabId('/work/app'), path: '/work/app', name: 'app Graph', isDirty: false },
    ]);
    expect(activeTabId).toBe(graphTabId('/work/app'));
  });

  it('starts loading the graph', () => {
    openGraphTab('/work/app');
    expect(useStore.getState().openGraph).toHaveBeenCalledWith('/work/app');
  });

  it('names the tab from the path when the repo is not in the list', () => {
    openGraphTab('/elsewhere/lib');
    expect(useStore.getState().openTabs[0].name).toBe('lib Graph');
  });
});

describe('showGraph', () => {
  beforeEach(() => {
    useStore.setState({
      openTabs: [],
      activeTabId: null,
      repos: [],
      activeRepoPath: null,
      toasts: [],
      openGraph: vi.fn(async () => undefined),
    });
  });

  it('tells the user when there is no repository to show', () => {
    showGraph();
    expect(useStore.getState().openTabs).toEqual([]);
    expect(useStore.getState().toasts[0].message).toBe(
      'Open a folder with a git repository first.'
    );
  });

  it('opens the graph of the resolved repo', () => {
    useStore.setState({ repos: [repo('/work/app', 'app')] });
    showGraph();
    expect(useStore.getState().activeTabId).toBe(graphTabId('/work/app'));
  });
});
