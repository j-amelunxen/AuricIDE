/**
 * What a terminal sends for the Enter key. Claude Code (and other TUIs in raw
 * mode) submit only on `\r`; a `\n` inserts a line break in their input box
 * and never sends. Every path that types into an agent appends this — the
 * console composer, the menu buttons, the Enter nudge and the control socket
 * (`agentControl.fixtures.json` → `enter`).
 */
export const TERMINAL_ENTER = '\r';
