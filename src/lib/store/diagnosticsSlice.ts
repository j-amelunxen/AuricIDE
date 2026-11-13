import { loadAppConfig, setAppConfigValue } from '@/lib/config/appConfig';
import type { StoreState } from '@/lib/store/types';
import type { StateCreator } from 'zustand';

export interface StoreDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LintConfig {
  enabled: boolean;
  disabledRules: Set<string>;
}

export interface DiagnosticsSlice {
  diagnostics: Map<string, StoreDiagnostic[]>;
  lintConfig: LintConfig;
  setDiagnostics: (filePath: string, diags: StoreDiagnostic[]) => void;
  clearDiagnostics: (filePath: string) => void;
  getDiagnosticCounts: (filePath: string) => { errors: number; warnings: number };
  /** Markdown linting on or off; an application setting, so it is remembered. */
  setLintEnabled: (enabled: boolean) => void;
}

function sameDiagnostic(a: StoreDiagnostic, b: StoreDiagnostic): boolean {
  return (
    a.line === b.line &&
    a.column === b.column &&
    a.endLine === b.endLine &&
    a.endColumn === b.endColumn &&
    a.message === b.message &&
    a.ruleId === b.ruleId &&
    a.severity === b.severity
  );
}

export const createDiagnosticsSlice: StateCreator<StoreState, [], [], DiagnosticsSlice> = (
  set,
  get
) => ({
  diagnostics: new Map(),
  lintConfig: { enabled: loadAppConfig().markdownLintEnabled, disabledRules: new Set() },

  setDiagnostics: (filePath: string, diags: StoreDiagnostic[]) => {
    const prev = get().diagnostics.get(filePath);
    if (prev && prev.length === diags.length && prev.every((d, i) => sameDiagnostic(d, diags[i]))) {
      return;
    }
    const newMap = new Map(get().diagnostics);
    newMap.set(filePath, diags);
    set({ diagnostics: newMap });
  },

  clearDiagnostics: (filePath: string) => {
    if (!get().diagnostics.has(filePath)) return;
    const newMap = new Map(get().diagnostics);
    newMap.delete(filePath);
    set({ diagnostics: newMap });
  },

  getDiagnosticCounts: (filePath: string) => {
    const diags = get().diagnostics.get(filePath) ?? [];
    let errors = 0;
    let warnings = 0;
    for (const d of diags) {
      if (d.severity === 'error') errors++;
      else if (d.severity === 'warning') warnings++;
    }
    return { errors, warnings };
  },

  setLintEnabled: (enabled: boolean) => {
    setAppConfigValue('markdownLintEnabled', enabled);
    set({ lintConfig: { ...get().lintConfig, enabled } });
  },
});
