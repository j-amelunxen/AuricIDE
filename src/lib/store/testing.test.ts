import { describe, expect, it, vi } from 'vitest';
import { createTestStore } from './testing';

describe('complete isolated test stores', () => {
  it('keeps instances separate while retaining real sibling slice actions', () => {
    const first = createTestStore();
    const second = createTestStore();
    first.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });
    first
      .getState()
      .setDiagnostics('/a.md', [
        { line: 1, column: 1, message: 'Missing title', ruleId: 'title', severity: 'warning' },
      ]);
    expect(first.getState().diagnostics.has('/a.md')).toBe(true);

    first.getState().closeTab('/a.md');

    expect(first.getState().diagnostics.has('/a.md')).toBe(false);
    expect(second.getState().openTabs).toEqual([]);
    expect(second.getState().diagnostics.size).toBe(0);
    expect(typeof first.getState().applyAgentWaiting).toBe('function');
  });

  it('applies explicit dependency overrides without dropping the other slices', () => {
    const clearDiagnostics = vi.fn();
    const store = createTestStore({ clearDiagnostics });
    store.getState().openTab({ id: '/a.md', path: '/a.md', name: 'a.md' });

    store.getState().closeTab('/a.md');

    expect(clearDiagnostics).toHaveBeenCalledWith('/a.md');
    expect(store.getState().openTabs).toEqual([]);
    expect(typeof store.getState().updateTicket).toBe('function');
  });
});
