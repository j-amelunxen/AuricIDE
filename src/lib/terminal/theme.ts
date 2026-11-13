import type { ITheme } from '@xterm/xterm';
import { accentColor, accentRgb } from '@/lib/theme/accent';

export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', monospace";

/** Lines every IDE terminal keeps, and the agent mirror a view is replayed from. */
export const TERMINAL_SCROLLBACK = 1000;

/**
 * The palette every IDE terminal draws with; only the background differs by
 * surface. Cursor and selection follow the accent the user picked, read when
 * the terminal is created.
 */
export function terminalTheme(background: string): ITheme {
  return {
    background,
    foreground: '#ffffff',
    cursor: accentColor(),
    selectionBackground: `rgba(${accentRgb()}, 0.4)`,
    black: '#000000',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#ffffff',
  };
}
