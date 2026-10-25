/**
 * Formatting on ⌘S and on focus loss — decided here, carried out by Rust.
 *
 * One rule shapes every function in this file: a formatter never decides
 * whether a save happens. The caller writes the unformatted text first, then
 * asks for formatting; a missing tool, a syntax error or a timeout costs the
 * formatting and earns one short notice, never the save.
 */

import { APP_CONFIG_KEYS, loadAppConfig, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { formatDocument, type FormatOutcome } from '@/lib/tauri/formatter';
import { useStore } from '@/lib/store';
import { FORMAT_LANGUAGES, formatLanguageFor, type FormatLanguageId } from './formatLanguages';

export type FormatTrigger = 'save' | 'blur';

/** Only the switches the user changed; everything else follows its default. */
function readLanguageOverrides(): Partial<Record<FormatLanguageId, boolean>> {
  const raw = readAppPref(APP_CONFIG_KEYS.formatLanguages);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'boolean')
    ) as Partial<Record<FormatLanguageId, boolean>>;
  } catch {
    return {};
  }
}

export function loadFormatLanguageSwitches(): Record<FormatLanguageId, boolean> {
  const overrides = readLanguageOverrides();
  return Object.fromEntries(
    FORMAT_LANGUAGES.map((language) => [
      language.id,
      overrides[language.id] ?? language.defaultEnabled,
    ])
  ) as Record<FormatLanguageId, boolean>;
}

export function setFormatLanguageEnabled(id: FormatLanguageId, enabled: boolean): void {
  writeAppPref(
    APP_CONFIG_KEYS.formatLanguages,
    JSON.stringify({ ...readLanguageOverrides(), [id]: enabled })
  );
}

/** The language to format `path` as for this trigger, or null to leave it alone. */
export function formatLanguageForTrigger(
  path: string,
  trigger: FormatTrigger
): FormatLanguageId | null {
  const config = loadAppConfig();
  if (trigger === 'save' ? !config.formatOnSave : !config.formatOnBlur) return null;
  const language = formatLanguageFor(path);
  if (!language) return null;
  return loadFormatLanguageSwitches()[language.id] ? language.id : null;
}

/**
 * Notices already shown this session. A missing tool is said once per
 * language and reason — repeating it on every ⌘S trains the reader to dismiss
 * it. A failure is said once per file until that file formats again: a syntax
 * error's message carries a line and column, which move as the person types.
 */
const shownNotices = new Set<string>();

export function resetFormatNotices(): void {
  shownNotices.clear();
}

function noticeFor(path: string, language: string, outcome: FormatOutcome): string | null {
  const name = path.split('/').pop() ?? path;
  if (outcome.status !== 'failed') shownNotices.delete(`failed:${path}`);
  if (outcome.status === 'unavailable') {
    const key = `unavailable:${language}:${outcome.reason}`;
    if (shownNotices.has(key)) return null;
    shownNotices.add(key);
    return `Saved ${name} unformatted. ${outcome.reason}`;
  }
  if (outcome.status === 'failed') {
    const key = `failed:${path}`;
    if (shownNotices.has(key)) return null;
    shownNotices.add(key);
    return `Saved ${name} unformatted — ${outcome.formatter}: ${outcome.message}`;
  }
  return null;
}

export interface FormatDeps {
  format?: typeof formatDocument;
  notify?: (message: string) => void;
}

/**
 * The formatted text for `content`, or null when there is nothing to apply
 * (switched off, no language, already formatted, tool missing or failing).
 */
export async function formatForSave(
  path: string,
  content: string,
  trigger: FormatTrigger,
  deps: FormatDeps = {}
): Promise<string | null> {
  const language = formatLanguageForTrigger(path, trigger);
  if (!language) return null;
  const format = deps.format ?? formatDocument;
  const notify = deps.notify ?? ((message) => useStore.getState().showToast(message, 'info'));

  let outcome: FormatOutcome;
  try {
    outcome = await format(path, content, language);
  } catch {
    // No backend (browser mode, tests) is not something to tell the user about.
    return null;
  }
  const notice = noticeFor(path, language, outcome);
  if (notice) notify(notice);
  if (outcome.status !== 'formatted' || outcome.content === content) return null;
  return outcome.content;
}

/** How far ahead an inserted or dropped character is looked for. */
const ALIGN_LOOKAHEAD = 3;

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

/**
 * Where the cursor goes after formatting: walk both texts side by side,
 * skipping whitespace on either side, and step over a character the
 * formatter added (a semicolon, a trailing comma) or dropped. Formatters
 * mostly move whitespace and add punctuation, so this keeps the cursor on the
 * token it was on; a replaced character (quote style) advances both sides.
 */
export function mapCursorThroughFormat(before: string, after: string, cursor: number): number {
  const stop = Math.min(cursor, before.length);
  let i = 0;
  let j = 0;
  while (i < stop && j < after.length) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (isSpace(before[i])) {
      i++;
    } else if (isSpace(after[j])) {
      j++;
    } else if (after.slice(j + 1, j + 1 + ALIGN_LOOKAHEAD).includes(before[i])) {
      j++; // added by the formatter
    } else if (before.slice(i + 1, i + 1 + ALIGN_LOOKAHEAD).includes(after[j])) {
      i++; // dropped by the formatter
    } else {
      i++;
      j++;
    }
  }
  return Math.min(j, after.length);
}

/** The smallest single replacement that turns `before` into `after`. */
export function minimalReplacement(
  before: string,
  after: string
): { from: number; to: number; insert: string } {
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
