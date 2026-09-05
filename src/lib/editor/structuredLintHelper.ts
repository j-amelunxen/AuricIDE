import type { Facet } from '@codemirror/state';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { useStore } from '@/lib/store';

export interface StructuredParseError {
  line: number;
  column: number;
  message: string;
}

/**
 * Creates a CodeMirror lint source for structured parsers (e.g. XML, YAML)
 * that produce line/column/message errors, mapping them to diagnostics and syncing
 * them with the global store diagnostics for the file.
 */
export function createStructuredLinterSource<T extends StructuredParseError>(
  parseErrors: (text: string) => T[],
  filePathFacet: Facet<string, string>,
  sourceName: string
): (view: EditorView) => Diagnostic[] {
  return (view: EditorView): Diagnostic[] => {
    const text = view.state.doc.toString();
    const errors = parseErrors(text);
    const filePath = view.state.facet(filePathFacet);

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
        source: sourceName,
      };
    });

    if (filePath) {
      useStore.getState().setDiagnostics(
        filePath,
        errors.map((e) => ({
          line: e.line,
          column: e.column,
          message: e.message,
          ruleId: sourceName,
          severity: 'error' as const,
        }))
      );
    }

    return diagnostics;
  };
}
