import { Facet } from '@codemirror/state';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';

export const filePathsFacet = Facet.define<string[], string[]>({
  combine: (values: readonly string[][]): string[] => values.flat(),
});

const LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'html',
  'css',
  'scss',
  'json',
  'yaml',
  'toml',
  'xml',
  'sql',
  'bash',
  'shell',
  'dockerfile',
  'markdown',
  'mermaid',
  'graphql',
  'lua',
  'r',
  'perl',
  'elixir',
  'haskell',
  'zig',
  'wasm',
];

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|bmp|tiff?)$/i;

/**
 * Offer language names on the ``` info-string line.
 */
export function codeFenceLanguageSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/^```\w*$/);
  if (!match) return null;

  const from = match.from + 3; // after ```
  const typed = match.text.slice(3).toLowerCase();

  const options = LANGUAGES.filter((lang) => lang.startsWith(typed)).map((lang) => ({
    label: lang,
  }));

  if (options.length === 0) return null;

  return { from, options, filter: false };
}

/**
 * After # at line start, offer heading levels # through ######.
 */
export function headingLevelSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/^#{1,6}\s?$/);
  if (!match) return null;

  const typed = match.text.replace(/\s$/, '');
  const from = match.from;

  const levels = ['# ', '## ', '### ', '#### ', '##### ', '###### '];
  const descriptions = [
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Heading 4',
    'Heading 5',
    'Heading 6',
  ];

  const options = levels
    .map((level, i) => ({
      label: level,
      detail: descriptions[i],
    }))
    .filter((opt) => opt.label.startsWith(typed));

  if (options.length === 0) return null;

  return { from, options, filter: false };
}

/**
 * After unmatched `[` (not `![`), suggest file paths.
 */
export function linkTargetSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/(?<!!)\[\w*/);
  if (!match) return null;

  const from = match.from + 1; // after [
  const typed = match.text.slice(1).toLowerCase();

  const filePaths = ctx.state.facet(filePathsFacet);
  const options = filePaths
    .filter((p) => p.toLowerCase().includes(typed))
    .map((p) => ({ label: p }));

  if (options.length === 0) return null;

  return { from, options, filter: false };
}

/**
 * After `![...](`, suggest image file paths.
 */
export function imageTargetSource(ctx: CompletionContext): CompletionResult | null {
  const match = ctx.matchBefore(/!\[[^\]]*\]\(\w*/);
  if (!match) return null;

  const parenIdx = match.text.lastIndexOf('(');
  const from = match.from + parenIdx + 1;
  const typed = match.text.slice(parenIdx + 1).toLowerCase();

  const filePaths = ctx.state.facet(filePathsFacet);
  const options = filePaths
    .filter((p) => IMAGE_EXTENSIONS.test(p))
    .filter((p) => p.toLowerCase().includes(typed))
    .map((p) => ({ label: p }));

  if (options.length === 0) return null;

  return { from, options, filter: false };
}
