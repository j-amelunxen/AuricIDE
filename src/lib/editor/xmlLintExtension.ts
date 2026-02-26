import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { useStore } from '@/lib/store';

export const currentFilePathFacetXml = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

export interface XmlParseError {
  line: number;
  column: number;
  message: string;
}

export function parseXmlErrors(text: string): XmlParseError[] {
  if (!text.trim()) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');
  const errorNode = doc.querySelector('parsererror');
  if (!errorNode) return [];

  const errorText = errorNode.textContent ?? '';
  const lineMatch = errorText.match(/line\s+(\d+)/i);
  const colMatch = errorText.match(/column\s+(\d+)/i);
  const line = lineMatch ? parseInt(lineMatch[1], 10) : 1;
  const column = colMatch ? parseInt(colMatch[1], 10) : 1;
  const message =
    errorText
      .replace(/Below is a rendering of the page.*$/s, '')
      .replace(/This page contains the following errors:?\s*/i, '')
      .trim() || 'XML parse error';

  return [{ line, column, message }];
}

export function xmlLintSource(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  const errors = parseXmlErrors(text);
  const filePath = view.state.facet(currentFilePathFacetXml);

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
      source: 'xml',
    };
  });

  if (filePath) {
    useStore.getState().setDiagnostics(
      filePath,
      errors.map((e) => ({
        line: e.line,
        column: e.column,
        message: e.message,
        ruleId: 'xml',
        severity: 'error' as const,
      }))
    );
  }

  return diagnostics;
}

export const xmlLintExtension: Extension = [linter(xmlLintSource, { delay: 300 }), lintGutter()];
