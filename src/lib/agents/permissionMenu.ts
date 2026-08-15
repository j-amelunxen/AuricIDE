import { cleanOutputLines } from './awaitingInput';

/** How many trailing lines a permission menu's options can spread across. */
const MENU_SCAN_LINES = 10;

/** How many trailing lines the console card shows in its prompt-tail preview. */
const DEFAULT_TAIL_LINES = 6;

/** "❯ 1. Yes", "  2. No" — a CLI's numbered permission-menu option line. */
const NUMBERED_OPTION = /^❯?\s*(\d+)\.\s+(.+)$/;

/** "? (y/n)", "? [Y/n]", "? (yes/no)" — a plain confirmation question. */
const YES_NO_QUESTION = /\?\s*[([](?:y(?:es)?\s*\/\s*no?)[)\]]/i;

export interface PermissionMenuOption {
  /** Exact bytes typed before Enter — a menu digit, or "y"/"n" for a confirmation. */
  send: string;
  label: string;
}

/**
 * Reads a menu out of an agent's raw output tail, so the console can offer
 * one-click answers instead of sending a human into the terminal for a
 * decision the CLI already spelled out. Two shapes only, both explicit on
 * purpose (like `detectAwaitingInput`'s patterns) — a guess at a third shape
 * would risk sending the wrong bytes to a process waiting on exact input.
 */
export function parsePermissionMenu(chunks: string[]): PermissionMenuOption[] | null {
  const lines = cleanOutputLines(chunks, MENU_SCAN_LINES);

  const numbered = lines
    .map((line) => line.match(NUMBERED_OPTION))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ send: match[1], label: match[2].trim() }));
  if (numbered.length > 0) return numbered;

  if (lines.some((line) => YES_NO_QUESTION.test(line))) {
    return [
      { send: 'y', label: 'Yes' },
      { send: 'n', label: 'No' },
    ];
  }

  return null;
}

/** The trailing meaningful lines of an agent's output, for display in the console card. */
export function promptTailLines(chunks: string[], maxLines = DEFAULT_TAIL_LINES): string[] {
  return cleanOutputLines(chunks).slice(-maxLines);
}
