import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariant: the colours a custom theme is allowed to move are read from the
 * token, never written into a component.
 *
 * A panel that paints itself `#0a0a10` looks correct under the built-in theme
 * and stays black under every other one — the theme moves the surface out from
 * under it and the panel does not follow. That is invisible in review and
 * invisible in a test that only renders the default theme, so the check lives
 * here instead.
 *
 * Only the *chrome* tokens are guarded. Status and git colours (amber, emerald,
 * red) are deliberately literal: "the red one" has to stay red whatever accent
 * the user picked, so a theme must NOT be able to move them.
 */

const SRC = join(__dirname, '..', '..', '..');
const GLOBALS = join(SRC, 'app', 'globals.css');

/** Tokens whose value belongs to the theme, keyed by the `--color-*` name. */
const GUARDED = ['surface', 'background'] as const;

/**
 * `var(--color-surface, #0a0a10)` is the correct shape — the literal is the
 * fallback, not the value — so a hex inside a `var(...)` is not a finding.
 */
function stripVarFallbacks(text: string): string {
  return text.replace(/var\(\s*--[a-z0-9-]+\s*,[^)]*\)/gi, 'var(…)');
}

function guardedHexes(): Map<string, string> {
  const css = readFileSync(GLOBALS, 'utf8');
  const theme = css.slice(css.indexOf('@theme'), css.indexOf('\n}\n', css.indexOf('@theme')));
  const found = new Map<string, string>();
  for (const token of GUARDED) {
    const match = theme.match(new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, 'i'));
    if (match) found.set(match[1].toLowerCase(), token);
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

describe('theme chrome colours', () => {
  it('names every guarded token in globals.css', () => {
    expect([...guardedHexes().values()].sort()).toEqual([...GUARDED].sort());
  });

  it('is never hardcoded in a component', () => {
    const hexes = guardedHexes();
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      const text = stripVarFallbacks(readFileSync(file, 'utf8')).toLowerCase();
      for (const [hex, token] of hexes) {
        if (!text.includes(hex)) continue;
        offenders.push(`${file.slice(SRC.length + 1)} hardcodes ${hex} — use the ${token} token`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
