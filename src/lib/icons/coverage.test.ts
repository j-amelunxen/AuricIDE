import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getGlyph } from './registry';

/**
 * Invariant: every icon name the app references resolves to a glyph.
 * A new `<AuricIcon name="…">` (or `icon: '…'` prop) with no registered
 * glyph would render an empty box — this test turns that into a red build.
 */

const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

function collectUsedNames(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const patterns = [
    // <AuricIcon name="folder" />
    /\bname="([a-z0-9_]+)"/g,
    // iconSvgMarkup('folder')
    /iconSvgMarkup\(\s*'([a-z0-9_]+)'/g,
    // icon: 'folder' / icon="folder" props feeding AuricIcon indirectly
    /\bicon[:=]\s*\{?\s*'([a-z0-9_]+)'/g,
  ];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const name = match[1];
        if (!used.has(name)) used.set(name, []);
        used.get(name)!.push(file);
      }
    }
    // ternaries inside name={...}: the first pattern only catches the first
    // quoted string; sweep the full attribute expression for the rest.
    for (const attr of text.matchAll(/\bname=\{([^}]+)\}/g)) {
      // drop comparison operands (`viewMode === 'unified'`) — they are
      // state values, not icon names
      const expr = attr[1].replace(/[=!]==?\s*'[a-z0-9_]+'/g, '');
      for (const quoted of expr.matchAll(/'([a-z0-9_]+)'/g)) {
        const name = quoted[1];
        if (!used.has(name)) used.set(name, []);
        used.get(name)!.push(file);
      }
    }
  }
  return used;
}

describe('icon coverage', () => {
  it('every referenced icon name has a registered glyph', () => {
    const used = collectUsedNames();
    expect(used.size).toBeGreaterThan(50);
    const missing = [...used.entries()]
      .filter(([name]) => !getGlyph(name))
      .map(([name, files]) => `${name} (${files[0].replace(SRC, 'src')})`);
    expect(missing, `missing glyphs:\n${missing.join('\n')}`).toEqual([]);
  });
});
