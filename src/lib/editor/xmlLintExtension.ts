import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter } from '@codemirror/lint';
import { createStructuredLinterSource } from './structuredLintHelper';

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
      .replace(/Below is a rendering of the page[\s\S]*$/, '')
      .replace(/This page contains the following errors:?\s*/i, '')
      .trim() || 'XML parse error';

  return [{ line, column, message }];
}

export const xmlLintSource = createStructuredLinterSource(
  parseXmlErrors,
  currentFilePathFacetXml,
  'xml'
);

export const xmlLintExtension: Extension = [linter(xmlLintSource, { delay: 300 }), lintGutter()];
