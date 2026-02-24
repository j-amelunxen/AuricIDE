import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { runRemarkLint, type LintDiagnostic } from './remarkLintProcessor';
import type { LintConfig } from '@/lib/store/diagnosticsSlice';
import { useStore } from '@/lib/store';

// Facets for data injection from React
export const lintConfigFacet = Facet.define<LintConfig, LintConfig>({
  combine: (values) => values[0] ?? { enabled: true, disabledRules: new Set<string>() },
});

export const fileListForLintFacet = Facet.define<string[], string[]>({
  combine: (values) => values[0] ?? [],
});

export const headingIndexForLintFacet = Facet.define<Map<string, string[]>, Map<string, string[]>>({
  combine: (values) => values[0] ?? new Map(),
});

export const currentFilePathFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

function mapSeverity(severity: LintDiagnostic['severity']): Diagnostic['severity'] {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
  }
}

async function markdownLintSource(view: EditorView): Promise<Diagnostic[]> {
  const text = view.state.doc.toString();
  if (!text) return [];

  const config = view.state.facet(lintConfigFacet);
  const fileList = view.state.facet(fileListForLintFacet);
  const headingIndex = view.state.facet(headingIndexForLintFacet);
  const currentFilePath = view.state.facet(currentFilePathFacet);

  const results = await runRemarkLint(text, config, fileList, headingIndex, currentFilePath);

  const diagnostics: Diagnostic[] = [];

  for (const result of results) {
    const lineCount = view.state.doc.lines;
    if (result.line < 1 || result.line > lineCount) continue;

    const line = view.state.doc.line(result.line);
    const from = line.from + Math.max(0, result.column - 1);
    const to = result.endLine
      ? view.state.doc.line(Math.min(result.endLine, lineCount)).from +
        Math.max(0, (result.endColumn ?? result.column) - 1)
      : line.to;

    diagnostics.push({
      from: Math.min(from, view.state.doc.length),
      to: Math.min(Math.max(to, from), view.state.doc.length),
      severity: mapSeverity(result.severity),
      message: result.message,
      source: result.ruleId,
    });
  }

  // Side effect: push diagnostics to Zustand store for ProblemsPanel
  if (currentFilePath) {
    useStore.getState().setDiagnostics(
      currentFilePath,
      results.map((r) => ({
        line: r.line,
        column: r.column,
        endLine: r.endLine,
        endColumn: r.endColumn,
        message: r.message,
        ruleId: r.ruleId,
        severity: r.severity,
      }))
    );
  }

  return diagnostics;
}

export const markdownLintExtension: Extension = [
  linter(markdownLintSource, { delay: 500 }),
  lintGutter(),
];
