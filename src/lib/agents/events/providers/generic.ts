import { PROMPT_PATTERNS } from '../../awaitingInput';
import { extractPath, isCommandShaped } from './shared';
import type { LineMatcher } from './index';

const DOLLAR_RUN_LINE = /^\$\s+(.+)$/;
const CARET_RUN_LINE = /^>\s+(.+)$/;
const EDIT_LINE = /^(?:Edited|Wrote|Updated|Created|Modified)\s+(.+)$/i;
const READ_LINE = /^(?:Reading|Read)\s+(.+)$/i;

/**
 * The provider-agnostic fallback for any CLI without a dedicated matcher
 * (crush, gemini, grok, opencode, …). Recognises the shell-prompt and
 * plain-English conventions most agent TUIs share, and reuses
 * `detectAwaitingInput`'s own prompt patterns so "is this a question" is
 * decided in exactly one place.
 */
export const matchGenericLine: LineMatcher = (line) => {
  const dollarRun = DOLLAR_RUN_LINE.exec(line);
  if (dollarRun) return { kind: 'run', label: `Ran ${dollarRun[1].trim()}` };

  // A `>`-prefixed line is a real command only when it looks like one — the
  // Claude Code TUI echoes the user's own prompt back the same way, and that
  // echo must not be reported as something the agent ran.
  const caretRun = CARET_RUN_LINE.exec(line);
  if (caretRun && isCommandShaped(caretRun[1])) {
    return { kind: 'run', label: `Ran ${caretRun[1].trim()}` };
  }

  const edit = EDIT_LINE.exec(line);
  if (edit) {
    const path = extractPath(edit[1]);
    if (path) return { kind: 'edit', label: `Edited ${path}`, path };
  }

  const read = READ_LINE.exec(line);
  if (read) {
    const path = extractPath(read[1]);
    if (path) return { kind: 'read', label: `Read ${path}`, path };
  }

  if (PROMPT_PATTERNS.some((pattern) => pattern.test(line))) {
    return { kind: 'ask', label: `Permission requested: ${line.trim()}` };
  }

  return null;
};
