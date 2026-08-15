import { PROMPT_PATTERNS } from '../../awaitingInput';
import { extractPath } from './shared';
import type { LineMatcher } from './index';

const RUN_LINE = /^[$>]\s+(.+)$/;
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
  const run = RUN_LINE.exec(line);
  if (run) return { kind: 'run', label: `Ran ${run[1].trim()}` };

  const edit = EDIT_LINE.exec(line);
  if (edit) {
    const path = extractPath(edit[1]) ?? edit[1].trim();
    return { kind: 'edit', label: `Edited ${path}`, path };
  }

  const read = READ_LINE.exec(line);
  if (read) {
    const path = extractPath(read[1]) ?? read[1].trim();
    return { kind: 'read', label: `Read ${path}`, path };
  }

  if (PROMPT_PATTERNS.some((pattern) => pattern.test(line))) {
    return { kind: 'ask', label: `Permission requested: ${line.trim()}` };
  }

  return null;
};
