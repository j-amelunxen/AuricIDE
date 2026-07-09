import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { jsonParseLinter } from '@codemirror/lang-json';
import { useStore } from '@/lib/store';

export const currentFilePathFacetJson = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
});

// Instantiated once at module level — jsonParseLinter() returns a linter source function
const jsonParseSource = jsonParseLinter();

export function jsonLintSource(view: EditorView): Diagnostic[] {
  const diagnostics = jsonParseSource(view);
  const filePath = view.state.facet(currentFilePathFacetJson);

  if (filePath) {
    useStore.getState().setDiagnostics(
      filePath,
      diagnostics.map((d) => ({
        line: view.state.doc.lineAt(d.from).number,
        column: d.from - view.state.doc.lineAt(d.from).from + 1,
        message: d.message,
        ruleId: d.source ?? 'json',
        // CodeMirror's 'hint' severity has no store equivalent — treat as info.
        severity: d.severity === 'hint' ? 'info' : d.severity,
      }))
    );
  }

  return diagnostics;
}

export const jsonLintExtension: Extension = [linter(jsonLintSource, { delay: 300 }), lintGutter()];
