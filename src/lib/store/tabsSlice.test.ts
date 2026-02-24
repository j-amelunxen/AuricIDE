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
