import { describe, expect, it, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createDiagnosticsSlice, type DiagnosticsSlice } from './diagnosticsSlice';

function createTestStore() {
  return create<DiagnosticsSlice>()((...a) => ({
    ...createDiagnosticsSlice(...a),
  }));
}

describe('diagnosticsSlice', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('initial state', () => {
    it('has empty diagnostics map', () => {
      expect(store.getState().diagnostics.size).toBe(0);
    });

    it('has lint enabled by default', () => {
      expect(store.getState().lintConfig.enabled).toBe(true);
    });

    it('has no disabled rules by default', () => {
      expect(store.getState().lintConfig.disabledRules.size).toBe(0);
    });

    it('has problems panel closed by default', () => {
      expect(store.getState().problemsPanelOpen).toBe(false);
    });
  });

  describe('setDiagnostics', () => {
    it('sets diagnostics for a file', () => {
      store.getState().setDiagnostics('/project/doc.md', [
        {
          line: 5,
          column: 1,
          message: 'Missing final newline',
          ruleId: 'remark-lint:final-newline',
          severity: 'warning',
        },
      ]);
      const diags = store.getState().diagnostics.get('/project/doc.md');
      expect(diags).toHaveLength(1);
      expect(diags![0].message).toBe('Missing final newline');
    });

    it('replaces diagnostics on second call', () => {
      store
        .getState()
        .setDiagnostics('/project/doc.md', [
          { line: 1, column: 1, message: 'Old', ruleId: 'r1', severity: 'warning' },
        ]);
      store
        .getState()
        .setDiagnostics('/project/doc.md', [
          { line: 2, column: 1, message: 'New', ruleId: 'r2', severity: 'error' },
        ]);
      const diags = store.getState().diagnostics.get('/project/doc.md');
      expect(diags).toHaveLength(1);
      expect(diags![0].message).toBe('New');
    });

    it('stores diagnostics with all fields', () => {
      store.getState().setDiagnostics('/project/doc.md', [
        {
          line: 10,
          column: 5,
          endLine: 10,
          endColumn: 20,
          message: 'Broken link',
          ruleId: 'remark-lint:broken-links',
          severity: 'error',
        },
      ]);
      const diag = store.getState().diagnostics.get('/project/doc.md')![0];
      expect(diag.endLine).toBe(10);
      expect(diag.endColumn).toBe(20);
      expect(diag.severity).toBe('error');
    });
  });

  describe('clearDiagnostics', () => {
    it('removes diagnostics for a file', () => {
      store
        .getState()
        .setDiagnostics('/project/doc.md', [
          { line: 1, column: 1, message: 'Test', ruleId: 'r1', severity: 'warning' },
        ]);
      expect(store.getState().diagnostics.size).toBe(1);

      store.getState().clearDiagnostics('/project/doc.md');
      expect(store.getState().diagnostics.size).toBe(0);
    });

    it('does nothing for unknown file', () => {
      store.getState().clearDiagnostics('/project/unknown.md');
      expect(store.getState().diagnostics.size).toBe(0);
    });
  });

  describe('getDiagnosticCounts', () => {
    it('returns zero counts for unknown file', () => {
      const counts = store.getState().getDiagnosticCounts('/project/unknown.md');
      expect(counts).toEqual({ errors: 0, warnings: 0 });
    });

    it('counts errors and warnings separately', () => {
      store.getState().setDiagnostics('/project/doc.md', [
        { line: 1, column: 1, message: 'Error 1', ruleId: 'r1', severity: 'error' },
        { line: 2, column: 1, message: 'Warning 1', ruleId: 'r2', severity: 'warning' },
        { line: 3, column: 1, message: 'Warning 2', ruleId: 'r3', severity: 'warning' },
        { line: 4, column: 1, message: 'Info 1', ruleId: 'r4', severity: 'info' },
      ]);
      const counts = store.getState().getDiagnosticCounts('/project/doc.md');
      expect(counts.errors).toBe(1);
      expect(counts.warnings).toBe(2);
    });
  });

  describe('toggleRule', () => {
    it('disables a rule', () => {
      store.getState().toggleRule('final-newline', false);
      expect(store.getState().lintConfig.disabledRules.has('final-newline')).toBe(true);
    });

    it('re-enables a rule', () => {
      store.getState().toggleRule('final-newline', false);
      store.getState().toggleRule('final-newline', true);
      expect(store.getState().lintConfig.disabledRules.has('final-newline')).toBe(false);
    });
  });

  describe('setProblemsPanelOpen', () => {
    it('opens the problems panel', () => {
      store.getState().setProblemsPanelOpen(true);
      expect(store.getState().problemsPanelOpen).toBe(true);
    });

    it('closes the problems panel', () => {
      store.getState().setProblemsPanelOpen(true);
      store.getState().setProblemsPanelOpen(false);
      expect(store.getState().problemsPanelOpen).toBe(false);
    });
  });
});
