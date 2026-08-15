import { extractPath } from './shared';
import type { LineMatcher } from './index';

/** Codex bullets a top-level action with `•`, though `⚬` and `-` show up too. */
const BULLET = '[•⚬-]';

const EXPLORED_LINE = new RegExp(`^${BULLET}\\s+Explored\\b`);
const SUB_READ_LINE = /^└\s+Read\s+(.+)$/;
const SUB_SEARCH_LINE = /^└\s+Search\s+(.+)$/;
const SUB_LIST_LINE = /^└\s+List\s+(.+)$/;
const SUB_EDIT_LINE = /^└\s+Edited\s+(.+)$/;
const BULLET_EDITED_LINE = new RegExp(`^${BULLET}\\s+Edited\\s+(.+)$`);
const BULLET_ADDED_LINE = new RegExp(`^${BULLET}\\s+Added\\s+(.+)$`);
const BULLET_DELETED_LINE = new RegExp(`^${BULLET}\\s+Deleted\\s+(.+)$`);
const BULLET_RAN_LINE = new RegExp(`^${BULLET}\\s+Ran\\s+(.+)$`);
const EXEC_LINE = /^exec\s+bash\s+-lc\s+"(.+)"\s*$/;
const SHELL_LINE = /^\$\s+(.+)$/;
const APPROVAL_PATTERNS = [/\ballow command\?/i, /\bapprove\b.*\?/i, /\by\/n\b/i];
const FINISHED_LINE = new RegExp(`^(${BULLET}\\s+Finished\\b|Done)\\s*$`, 'i');

function pathEvent(kind: 'read' | 'edit', verb: string, arg: string) {
  const path = extractPath(arg) ?? arg.trim();
  return { kind, label: `${verb} ${path}`, path };
}

/** Codex CLI's TUI transcript, e.g. `codex exec` in a PTY. Stateless — every
 * line carries enough context (the leading verb) to classify on its own. */
export const matchCodexLine: LineMatcher = (line) => {
  if (EXPLORED_LINE.test(line)) return { kind: 'read', label: 'Explored' };

  const read = SUB_READ_LINE.exec(line);
  if (read) return pathEvent('read', 'Read', read[1]);

  const search = SUB_SEARCH_LINE.exec(line);
  if (search) return { kind: 'read', label: `Searched ${search[1].trim()}` };

  const list = SUB_LIST_LINE.exec(line);
  if (list) return { kind: 'read', label: `Listed ${list[1].trim()}` };

  const subEdit = SUB_EDIT_LINE.exec(line);
  if (subEdit) return pathEvent('edit', 'Edited', subEdit[1]);

  const edited = BULLET_EDITED_LINE.exec(line);
  if (edited) return pathEvent('edit', 'Edited', edited[1]);

  const added = BULLET_ADDED_LINE.exec(line);
  if (added) return pathEvent('edit', 'Added', added[1]);

  const deleted = BULLET_DELETED_LINE.exec(line);
  if (deleted) return pathEvent('edit', 'Deleted', deleted[1]);

  const ran = BULLET_RAN_LINE.exec(line);
  if (ran) return { kind: 'run', label: `Ran ${ran[1].trim()}` };

  const exec = EXEC_LINE.exec(line);
  if (exec) return { kind: 'run', label: `Ran ${exec[1].trim()}` };

  const shell = SHELL_LINE.exec(line);
  if (shell) return { kind: 'run', label: `Ran ${shell[1].trim()}` };

  if (APPROVAL_PATTERNS.some((pattern) => pattern.test(line))) {
    return { kind: 'ask', label: `Permission requested: ${line.trim()}` };
  }

  if (FINISHED_LINE.test(line)) return { kind: 'done', label: 'Finished' };

  return null;
};
