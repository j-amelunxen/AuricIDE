/**
 * Deterministic, dependency-free "app icon" for a project, derived purely from
 * its identity (the project path). Same input always yields the same icon, so a
 * workspace keeps a stable visual fingerprint across sessions — think GitHub
 * identicons / Linear's generated workspace avatars, tuned for AuricIDE's dark
 * theme.
 *
 * Hues come from a curated wheel rather than the full 0–360 range: a row of
 * tiles with arbitrary neon hues at varying perceived brightness reads as
 * noise. Quantizing to designed hues at uniform saturation/lightness keeps
 * every tile distinct in hue but identical in visual weight, so the set reads
 * as one family (macOS Finder tags, iOS folder colors).
 */
export interface ProjectIcon {
  /** 1–2 uppercase letters shown on the tile. */
  initials: string;
  /** Base hue in [0, 360). */
  hue: number;
  /** CSS `hsl(...)` gradient start. */
  gradientFrom: string;
  /** CSS `hsl(...)` gradient end. */
  gradientTo: string;
}

// djb2 — small, fast, well-distributed string hash. Kept unsigned.
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

function lastSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.split('/').pop() ?? '';
}

function deriveInitials(name: string): string {
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Curated tile hues: brand-magenta neighborhood plus calm, dark-theme-safe
 * accents. Deliberately skips muddy yellows and chartreuse. */
export const PALETTE_HUES = [259, 285, 316, 350, 24, 152, 190, 210] as const;

export function generateProjectIcon(identity: string): ProjectIcon {
  const normalized = identity.replace(/\/+$/, '');
  const h = hash(normalized);
  const hue = PALETTE_HUES[h % PALETTE_HUES.length];
  const name = lastSegment(normalized);
  const initials = deriveInitials(name);
  const gradientFrom = `hsl(${hue}, 46%, 44%)`;
  const gradientTo = `hsl(${(hue + 14) % 360}, 52%, 54%)`;
  return { initials, hue, gradientFrom, gradientTo };
}
