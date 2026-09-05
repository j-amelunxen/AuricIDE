import { Facet, type Extension } from '@codemirror/state';
import { linter, lintGutter } from '@codemirror/lint';
import * as yaml from 'js-yaml';
import { createStructuredLinterSource } from './structuredLintHelper';

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

export const yamlLintSource = createStructuredLinterSource(
  parseYamlErrors,
  currentFilePathFacetYaml,
  'yaml'
);

export const yamlLintExtension: Extension = [linter(yamlLintSource, { delay: 300 }), lintGutter()];
