import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import type { FormatOutcome } from '@/lib/tauri/formatter';
import {
  formatForSave,
  formatLanguageForTrigger,
  loadFormatLanguageSwitches,
  mapCursorThroughFormat,
  minimalReplacement,
  resetFormatNotices,
  setFormatLanguageEnabled,
} from './formatOnSave';
import { formatLanguageFor } from './formatLanguages';

const answer = (outcome: FormatOutcome) => vi.fn(async () => outcome);

beforeEach(() => {
  localStorage.clear();
  resetFormatNotices();
});

describe('formatLanguageFor', () => {
  it('maps the standard extensions, case-insensitively', () => {
    expect(formatLanguageFor('/p/src/App.TSX')?.id).toBe('typescript');
    expect(formatLanguageFor('/p/main.go')?.id).toBe('go');
    expect(formatLanguageFor('/p/lib.rs')?.id).toBe('rust');
    expect(formatLanguageFor('/p/tool.py')?.id).toBe('python');
    expect(formatLanguageFor('/p/package.json')?.id).toBe('json');
  });

  it('formats nothing it does not know, and no dotfile by its name alone', () => {
    expect(formatLanguageFor('/p/notes.txt')).toBeNull();
    expect(formatLanguageFor('/p/Makefile')).toBeNull();
    expect(formatLanguageFor('/p/.json')).toBeNull();
  });
});

describe('the switches', () => {
  it('formats on ⌘S by default, not on blur, and leaves Markdown alone', () => {
    expect(formatLanguageForTrigger('/p/a.ts', 'save')).toBe('typescript');
    expect(formatLanguageForTrigger('/p/a.ts', 'blur')).toBeNull();
    expect(formatLanguageForTrigger('/p/README.md', 'save')).toBeNull();
  });

  it('follows the global switches', () => {
    localStorage.setItem(APP_CONFIG_KEYS.formatOnSave, 'false');
    localStorage.setItem(APP_CONFIG_KEYS.formatOnBlur, 'true');
    expect(formatLanguageForTrigger('/p/a.ts', 'save')).toBeNull();
    expect(formatLanguageForTrigger('/p/a.ts', 'blur')).toBe('typescript');
  });

  it('stores only the languages the user changed', () => {
    setFormatLanguageEnabled('python', false);
    setFormatLanguageEnabled('markdown', true);
    expect(JSON.parse(localStorage.getItem(APP_CONFIG_KEYS.formatLanguages)!)).toEqual({
      python: false,
      markdown: true,
    });
    expect(formatLanguageForTrigger('/p/a.py', 'save')).toBeNull();
    expect(formatLanguageForTrigger('/p/a.md', 'save')).toBe('markdown');
  });

  it('falls back to the defaults when the stored value is not an object of booleans', () => {
    localStorage.setItem(APP_CONFIG_KEYS.formatLanguages, '{"go":"no","rust":false');
    expect(loadFormatLanguageSwitches().go).toBe(true);
    localStorage.setItem(APP_CONFIG_KEYS.formatLanguages, '{"go":"no","rust":false}');
    expect(loadFormatLanguageSwitches()).toMatchObject({ go: true, rust: false });
  });
});

describe('formatForSave', () => {
  it('returns the formatted text', async () => {
    const format = answer({ status: 'formatted', content: 'a;\n', formatter: 'prettier' });
    expect(await formatForSave('/p/a.ts', 'a', 'save', { format, notify: vi.fn() })).toBe('a;\n');
    expect(format).toHaveBeenCalledWith('/p/a.ts', 'a', 'typescript');
  });

  it('does not ask the formatter when the trigger is switched off', async () => {
    const format = answer({ status: 'unchanged', formatter: 'prettier' });
    expect(await formatForSave('/p/a.ts', 'a', 'blur', { format })).toBeNull();
    expect(format).not.toHaveBeenCalled();
  });

  it('names a missing formatter once per language, not on every save', async () => {
    const notify = vi.fn();
    const format = answer({ status: 'unavailable', reason: 'No Go formatter found.' });
    expect(await formatForSave('/p/a.go', 'x', 'save', { format, notify })).toBeNull();
    await formatForSave('/p/b.go', 'x', 'save', { format, notify });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Saved a.go unformatted. No Go formatter found.');
  });

  it('says a failure once per file, and again only after the file formatted', async () => {
    const notify = vi.fn();
    const failing = (message: string) => answer({ status: 'failed', formatter: 'ruff', message });
    const fine = answer({ status: 'unchanged', formatter: 'ruff' });
    await formatForSave('/p/a.py', 'x', 'save', { format: failing('line 1: bad'), notify });
    await formatForSave('/p/a.py', 'x', 'save', { format: failing('line 2: bad'), notify });
    expect(notify).toHaveBeenCalledTimes(1);
    await formatForSave('/p/a.py', 'x', 'save', { format: fine, notify });
    await formatForSave('/p/a.py', 'x', 'save', { format: failing('line 3: bad'), notify });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith('Saved a.py unformatted — ruff: line 3: bad');
  });

  it('treats a missing backend as nothing to do, without a notice', async () => {
    const notify = vi.fn();
    const format = vi.fn(async () => {
      throw new Error('Tauri IPC is unavailable (format_document)');
    });
    expect(await formatForSave('/p/a.ts', 'a', 'save', { format, notify })).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('applying the result', () => {
  it('replaces only the span that changed', () => {
    expect(minimalReplacement('const a=1\nconst b=2\n', 'const a = 1\nconst b=2\n')).toEqual({
      from: 7,
      to: 8,
      insert: ' = ',
    });
    expect(minimalReplacement('same', 'same')).toEqual({ from: 4, to: 4, insert: '' });
  });

  it('keeps the cursor on the token it was on when whitespace moves', () => {
    const before = 'f(a,b)\n{x}';
    const after = 'f(a, b)\n{\n  x\n}';
    // Cursor right after "b".
    const cursor = mapCursorThroughFormat(before, after, before.indexOf('b') + 1);
    expect(after.slice(0, cursor)).toBe('f(a, b');
    // Cursor right after "x".
    const inside = mapCursorThroughFormat(before, after, before.indexOf('x') + 1);
    expect(after.slice(0, inside)).toBe('f(a, b)\n{\n  x');
  });

  it('never maps the cursor past the end of the new text', () => {
    expect(mapCursorThroughFormat('abc  ', 'ab', 5)).toBe(2);
    expect(mapCursorThroughFormat('   ', '', 2)).toBe(0);
  });
});
