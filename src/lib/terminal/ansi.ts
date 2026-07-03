// CSI (colors, cursor movement), OSC (titles/links), and remaining C0
// control chars except \n and \t. Raw PTY output is full of these; plain
// HTML previews must not render them as garbage glyphs.
const ANSI_PATTERN =
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\x00-\x08\x0b-\x1f\x7f]/g;

/** Strip ANSI escape sequences and control characters for plain-text views. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}
