/**
 * Where an arrow/Home/End keystroke moves the Agent Console's card focus.
 *
 * Split out from the component because the interesting part is pure index
 * arithmetic over a flat, DOM-ordered card list, and it has to hold two
 * promises that are easy to break by accident: the grid never wraps (so
 * "am I at the end" stays answerable without counting), and left/right jump
 * whole projects rather than single cards, matching how the grid reads.
 */

/** One navigable card, in the order it appears in the DOM. */
export interface ConsoleCardRef {
  agentId: string;
  /** The project this card belongs to — the unit left/right steps over. */
  repoPath: string;
}

export type ConsoleNavKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

const NAV_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
]);

export function isConsoleNavKey(key: string): key is ConsoleNavKey {
  return NAV_KEYS.has(key);
}

/** The index of the first card belonging to the project `from` sits in. */
function sectionStart(cards: ConsoleCardRef[], from: number): number {
  const repoPath = cards[from].repoPath;
  let i = from;
  while (i > 0 && cards[i - 1].repoPath === repoPath) i--;
  return i;
}

/**
 * The first card of the neighbouring project, or `null` at either end.
 * Steps by project rather than by card so left/right cross the grid's
 * columns the way the eye does.
 */
function neighbouringSection(cards: ConsoleCardRef[], from: number, step: 1 | -1): number | null {
  const start = sectionStart(cards, from);
  if (step === -1) {
    if (start === 0) return null;
    return sectionStart(cards, start - 1);
  }
  const repoPath = cards[start].repoPath;
  for (let i = start; i < cards.length; i++) {
    if (cards[i].repoPath !== repoPath) return i;
  }
  return null;
}

/**
 * The index focus should move to, or `null` to leave it where it is — which
 * is what every edge returns, deliberately: focus stops at the ends instead
 * of wrapping around.
 */
export function nextCardIndex(
  cards: ConsoleCardRef[],
  current: number,
  key: ConsoleNavKey
): number | null {
  if (cards.length === 0) return null;
  // No card focused yet (current === -1): any navigation key enters the grid
  // at the top, which is where a fresh reader would start anyway.
  if (current < 0 || current >= cards.length) return 0;

  switch (key) {
    case 'ArrowDown':
      return current + 1 < cards.length ? current + 1 : null;
    case 'ArrowUp':
      return current > 0 ? current - 1 : null;
    case 'ArrowRight':
      return neighbouringSection(cards, current, 1);
    case 'ArrowLeft':
      return neighbouringSection(cards, current, -1);
    case 'Home':
      return current === 0 ? null : 0;
    case 'End':
      return current === cards.length - 1 ? null : cards.length - 1;
  }
}

/**
 * Whether a keystroke should be read as a console shortcut at all. A letter
 * typed into the reply box on a waiting card is text, not a command, and a
 * modified keystroke belongs to the OS or the app's own command palette.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
