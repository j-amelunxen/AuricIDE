/**
 * Deterministic, dependency-free "app icon" for a project, derived purely from
 * its identity (the project path). Same input always yields the same icon, so a
 * workspace keeps a stable visual fingerprint across sessions — think GitHub
 * identicons / Linear's generated workspace avatars, tuned for AuricIDE's dark
 * theme (saturated hue, mid lightness, a subtle two-stop gradient).
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

export function generateProjectIcon(identity: string): ProjectIcon {
  const normalized = identity.replace(/\/+$/, '');
  const h = hash(normalized);
  const hue = h % 360;
  const name = lastSegment(normalized);
  const initials = deriveInitials(name);
  const gradientFrom = `hsl(${hue}, 58%, 46%)`;
  const gradientTo = `hsl(${(hue + 35) % 360}, 64%, 56%)`;
  return { initials, hue, gradientFrom, gradientTo };
}
