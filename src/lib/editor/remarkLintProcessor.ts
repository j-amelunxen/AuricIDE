import { unified, type Processor } from 'unified';
import remarkParse from 'remark-parse';
import remarkPresetLintConsistent from 'remark-preset-lint-consistent';
import remarkPresetLintRecommended from 'remark-preset-lint-recommended';
import { remarkLintBrokenLinks } from './remarkLintBrokenLinks';
import type { LintConfig } from '@/lib/store/diagnosticsSlice';

export interface LintDiagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  message: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
}

// Rules that should be reported as errors rather than warnings
const ERROR_RULES = new Set(['remark-lint:broken-links', 'remark-lint:no-undefined-references']);

function mapSeverity(ruleId: string, severity: 1 | 2): 'error' | 'warning' | 'info' {
  if (ERROR_RULES.has(ruleId)) return 'error';
  if (severity === 2) return 'error';
  return 'warning';
}

// Lint findings are collected while the tree is transformed; the serialized
// Markdown `process()` would return is never read. A compiler that produces
// nothing keeps `process()` usable and skips re-printing the whole document
// (~15 % of a lint pass on a 50 KB file).
function discardOutput(this: Processor) {
  this.compiler = () => '';
}

export async function runRemarkLint(
  text: string,
  config: LintConfig,
  fileList: string[],
  headingIndex: Map<string, string[]>,
  currentFilePath: string
): Promise<LintDiagnostic[]> {
  if (!config.enabled || !text) return [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkPresetLintConsistent)
    .use(remarkPresetLintRecommended)
    .use(remarkLintBrokenLinks, { fileList, headingIndex, currentFilePath })
    .use(discardOutput);

  const file = await processor.process(text);

  const diagnostics: LintDiagnostic[] = [];

  for (const msg of file.messages) {
    const ruleId = msg.ruleId ? `remark-lint:${msg.ruleId}` : 'remark-lint:unknown';

    // Filter disabled rules
    if (config.disabledRules.has(ruleId)) continue;

    const line = msg.line ?? 1;
    const column = msg.column ?? 1;

    diagnostics.push({
      line,
      column,
      message: msg.message,
      ruleId,
      severity: mapSeverity(ruleId, msg.fatal ? 2 : 1),
    });
  }

  return diagnostics;
}
