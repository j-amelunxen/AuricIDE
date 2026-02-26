import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import * as yaml from 'js-yaml';
import { useStore } from '@/lib/store';

export const currentFilePathFacetYaml = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

export interface YamlParseError {
  line: number;
  column: number;
  message: string;
}

export function parseYamlErrors(text: string): YamlParseError[] {
  if (!text.trim()) return [];

  try {
    yaml.load(text);
    return [];
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      const mark = e.mark;
      return [
        {
          line: (mark?.line ?? 0) + 1,
          column: (mark?.column ?? 0) + 1,
          message: e.reason ?? e.message,
        },
      ];
    }
    return [{ line: 1, column: 1, message: String(e) }];
  }
}

export function yamlLintSource(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  const errors = parseYamlErrors(text);
  const filePath = view.state.facet(currentFilePathFacetYaml);

  const diagnostics: Diagnostic[] = errors.map((error) => {
    const lineCount = view.state.doc.lines;
    const safeLine = Math.min(Math.max(error.line, 1), lineCount);
    const line = view.state.doc.line(safeLine);
    const from = Math.min(line.from + Math.max(0, error.column - 1), view.state.doc.length);
    const to = Math.min(Math.max(from + 1, line.to), view.state.doc.length);

    return {
      from,
      to,
      severity: 'error' as const,
      message: error.message,
      source: 'yaml',
    };
  });

  if (filePath) {
    useStore.getState().setDiagnostics(
      filePath,
      errors.map((e) => ({
        line: e.line,
        column: e.column,
        message: e.message,
        ruleId: 'yaml',
        severity: 'error' as const,
      }))
    );
  }

  return diagnostics;
}

export const yamlLintExtension: Extension = [linter(yamlLintSource, { delay: 300 }), lintGutter()];
