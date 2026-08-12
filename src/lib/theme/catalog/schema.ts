import type { ParseThemeResult, ThemeDefinition, ThemeTokens } from './types';
import { THEME_SCHEMA_VERSION } from './types';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const KNOWN_TOKEN_KEYS = new Set<string>([
  'primary',
  'primaryLight',
  'primaryForeground',
  'secondary',
  'secondaryLight',
  'background',
  'backgroundSecondary',
  'surface',
  'foreground',
  'foregroundMuted',
  'border',
  'panelBg',
  'editorBg',
  'glassBg',
  'glassPanelBg',
  'hoverBg',
  'muted',
  'gitAdded',
  'gitModified',
  'gitDeleted',
  'bodyGradientFrom',
  'bodyGradientTo',
]);

const KNOWN_TOP_LEVEL = new Set([
  'schemaVersion',
  'id',
  'name',
  'description',
  'author',
  'swatch',
  'tokens',
  'builtin',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCssColorish(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  // Accept hex, rgb/rgba, hsl/hsla, and named colours — apply does not re-parse
  // non-hex for rgb channels, but the colour itself may still be valid CSS.
  return v.length <= 128;
}

/**
 * Validate and normalise a raw JSON value into a ThemeDefinition.
 * Unknown keys produce warnings (forward-compat); hard failures return ok:false.
 */
export function parseTheme(raw: unknown): ParseThemeResult {
  const warnings: string[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Theme must be a JSON object', warnings };
  }

  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      warnings.push(`Unknown top-level key "${key}" (ignored)`);
    }
  }

  const schemaVersion = obj.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    return { ok: false, error: 'schemaVersion must be a number', warnings };
  }
  if (schemaVersion > THEME_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported schemaVersion ${schemaVersion} (max ${THEME_SCHEMA_VERSION})`,
      warnings,
    };
  }
  if (schemaVersion < 1) {
    return { ok: false, error: 'schemaVersion must be >= 1', warnings };
  }

  if (!isNonEmptyString(obj.id)) {
    return { ok: false, error: 'id is required', warnings };
  }
  const id = obj.id.trim();
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      error: 'id must be kebab-case [a-z0-9-], 1–64 chars',
      warnings,
    };
  }

  if (!isNonEmptyString(obj.name)) {
    return { ok: false, error: 'name is required', warnings };
  }
  const name = obj.name.trim();

  if (!isCssColorish(obj.swatch)) {
    return { ok: false, error: 'swatch is required (CSS colour)', warnings };
  }
  const swatch = obj.swatch.trim();

  if (obj.tokens === null || typeof obj.tokens !== 'object' || Array.isArray(obj.tokens)) {
    return { ok: false, error: 'tokens must be an object', warnings };
  }
  const rawTokens = obj.tokens as Record<string, unknown>;

  if (!isCssColorish(rawTokens.primary)) {
    return { ok: false, error: 'tokens.primary is required (CSS colour)', warnings };
  }

  for (const key of Object.keys(rawTokens)) {
    if (!KNOWN_TOKEN_KEYS.has(key)) {
      warnings.push(`Unknown token "${key}" (ignored)`);
    }
  }

  const tokens: ThemeTokens = { primary: String(rawTokens.primary).trim() };

  const optionalKeys = [
    'primaryLight',
    'primaryForeground',
    'secondary',
    'secondaryLight',
    'background',
    'backgroundSecondary',
    'surface',
    'foreground',
    'foregroundMuted',
    'border',
    'panelBg',
    'editorBg',
    'glassBg',
    'glassPanelBg',
    'hoverBg',
    'muted',
    'gitAdded',
    'gitModified',
    'gitDeleted',
    'bodyGradientFrom',
    'bodyGradientTo',
  ] as const;

  for (const key of optionalKeys) {
    const value = rawTokens[key];
    if (value === undefined) continue;
    if (!isCssColorish(value)) {
      warnings.push(`Token "${key}" is not a valid colour (ignored)`);
      continue;
    }
    tokens[key] = value.trim();
  }

  const theme: ThemeDefinition = {
    schemaVersion,
    id,
    name,
    swatch,
    tokens,
  };

  if (isNonEmptyString(obj.description)) {
    theme.description = obj.description.trim();
  }
  if (isNonEmptyString(obj.author)) {
    theme.author = obj.author.trim();
  }
  if (obj.builtin === true) {
    theme.builtin = true;
  }

  return { ok: true, theme, warnings };
}

/** Parse a JSON string; wraps parseTheme. */
export function parseThemeJson(json: string): ParseThemeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON', warnings: [] };
  }
  return parseTheme(raw);
}
