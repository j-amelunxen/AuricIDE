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
  problemsPanelOpen: boolean;
  setDiagnostics: (filePath: string, diags: StoreDiagnostic[]) => void;
  clearDiagnostics: (filePath: string) => void;
  getDiagnosticCounts: (filePath: string) => { errors: number; warnings: number };
  toggleRule: (ruleId: string, enabled: boolean) => void;
  setProblemsPanelOpen: (open: boolean) => void;
}

export const createDiagnosticsSlice: StateCreator<DiagnosticsSlice> = (set, get) => ({
  diagnostics: new Map(),
  lintConfig: { enabled: true, disabledRules: new Set() },
  problemsPanelOpen: false,

  setDiagnostics: (filePath: string, diags: StoreDiagnostic[]) => {
    const newMap = new Map(get().diagnostics);
    newMap.set(filePath, diags);
    set({ diagnostics: newMap });
  },

  clearDiagnostics: (filePath: string) => {
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

  toggleRule: (ruleId: string, enabled: boolean) => {
    const config = get().lintConfig;
    const newDisabled = new Set(config.disabledRules);
    if (enabled) {
      newDisabled.delete(ruleId);
    } else {
      newDisabled.add(ruleId);
    }
    set({ lintConfig: { ...config, disabledRules: newDisabled } });
  },

  setProblemsPanelOpen: (open: boolean) => {
    set({ problemsPanelOpen: open });
  },
});
