/**
 * Which files format on save, and under which language id.
 *
 * The frontend owns extension → language; Rust owns language → formatter
 * (`src-tauri/src/formatter/`). Splitting it that way keeps one owner per
 * question, so the per-language switches in Settings and the formatter that
 * runs cannot disagree about what a `.tsx` file is.
 */

export type FormatLanguageId =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'css'
  | 'html'
  | 'yaml'
  | 'markdown'
  | 'python'
  | 'go'
  | 'rust'
  | 'shell';

export interface FormatLanguage {
  id: FormatLanguageId;
  label: string;
  extensions: readonly string[];
  /** Which formatters Rust tries, in order — shown in Settings. */
  formatters: string;
  defaultEnabled: boolean;
}

export const FORMAT_LANGUAGES: readonly FormatLanguage[] = [
  {
    id: 'typescript',
    label: 'TypeScript',
    extensions: ['ts', 'tsx', 'mts', 'cts'],
    formatters: 'biome or prettier',
    defaultEnabled: true,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    formatters: 'biome or prettier',
    defaultEnabled: true,
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['json'],
    formatters: 'biome, prettier or built-in',
    defaultEnabled: true,
  },
  {
    id: 'css',
    label: 'CSS, SCSS, Less',
    extensions: ['css', 'scss', 'less'],
    formatters: 'biome or prettier',
    defaultEnabled: true,
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['html', 'htm'],
    formatters: 'prettier',
    defaultEnabled: true,
  },
  {
    id: 'yaml',
    label: 'YAML',
    extensions: ['yaml', 'yml'],
    formatters: 'prettier',
    defaultEnabled: true,
  },
  {
    id: 'python',
    label: 'Python',
    extensions: ['py', 'pyi'],
    formatters: 'ruff or black',
    defaultEnabled: true,
  },
  { id: 'go', label: 'Go', extensions: ['go'], formatters: 'gofmt', defaultEnabled: true },
  { id: 'rust', label: 'Rust', extensions: ['rs'], formatters: 'rustfmt', defaultEnabled: true },
  {
    id: 'shell',
    label: 'Shell',
    extensions: ['sh', 'bash'],
    formatters: 'shfmt',
    defaultEnabled: true,
  },
  // Off by default: Markdown is where people write prose here, and a
  // formatter rewriting lists and tables on every save is the surprise.
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    formatters: 'prettier',
    defaultEnabled: false,
  },
];

const BY_EXTENSION = new Map(
  FORMAT_LANGUAGES.flatMap((language) => language.extensions.map((ext) => [ext, language]))
);

/** The language a file formats as, or null when nothing formats it. */
export function formatLanguageFor(path: string): FormatLanguage | null {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}
