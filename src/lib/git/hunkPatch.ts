/**
 * Cuts one hunk out of the patch the diff viewer shows, so it can be staged,
 * unstaged or discarded on its own. The patch text is git's own (from
 * `git_diff`); we only slice it and, for unstage and discard, reverse it.
 * The backend applies it with `git2::Repository::apply` and refuses rather
 * than fuzz when it no longer fits. See `docs/design-merge-panel.md`.
 */
import type { DiffSource } from './diffTab';

export type HunkAction = 'stage' | 'unstage' | 'discard';
export type PatchTarget = 'index' | 'workdir';

const NO_NEWLINE = '\\';

/** Header lines that make a per-hunk action meaningless or unsafe. */
const REFUSED_HEADER = [
  'new file mode',
  'deleted file mode',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'similarity index',
  'dissimilarity index',
  'Binary files',
  'GIT binary patch',
  '--- /dev/null',
  '+++ /dev/null',
];

/**
 * A mode change belongs to whole-file staging, never to one hunk. The lines
 * are dropped, and the mode the target already has moves onto the `index`
 * line instead: without one libgit2 writes 100644 and a hunk action on an
 * executable file would quietly drop its +x.
 */
const OLD_MODE = 'old mode ';
const NEW_MODE = 'new mode ';

/** Which side's mode a cut hunk carries: the one its target already has. */
export type KeptMode = 'old' | 'new';

interface SplitPatch {
  header: string[];
  hunks: string[][];
}

function splitPatch(raw: string): SplitPatch {
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const header: string[] = [];
  const hunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) hunks.push([line]);
    else if (hunks.length > 0) hunks[hunks.length - 1].push(line);
    else header.push(line);
  }
  return { header, hunks };
}

function join(lines: readonly string[]): string {
  return lines.join('\n') + '\n';
}

function headerWithMode(header: readonly string[], keep: KeptMode): string[] {
  const prefix = keep === 'old' ? OLD_MODE : NEW_MODE;
  const mode = header.find((l) => l.startsWith(prefix))?.slice(prefix.length);
  return header
    .filter((l) => !l.startsWith(OLD_MODE) && !l.startsWith(NEW_MODE))
    .map((l) => (mode && /^index [0-9a-f]+\.\.[0-9a-f]+$/.test(l) ? `${l} ${mode}` : l));
}

/**
 * The file header plus hunk `hunkIndex`, ready for `git_apply_patch`. `null`
 * for new, deleted, renamed or binary files, and when the hunk does not exist.
 * `keepMode` names the side whose file mode the target has (`old` when the
 * patch is applied forward, `new` when it will be reversed).
 */
export function hunkPatchFor(
  rawPatch: string,
  hunkIndex: number,
  keepMode: KeptMode = 'old'
): string | null {
  const { header, hunks } = splitPatch(rawPatch);
  const hunk = hunks[hunkIndex];
  if (!hunk) return null;
  if (header.some((l) => REFUSED_HEADER.some((p) => l.startsWith(p)))) return null;
  if (!header.some((l) => l.startsWith('--- ')) || !header.some((l) => l.startsWith('+++ '))) {
    return null;
  }
  return join([...headerWithMode(header, keepMode), ...hunk]);
}

const RANGE = /^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@(.*)$/;

/**
 * A path as git prints it on `---`/`+++`, moved to another `a/`/`b/` prefix.
 * git quotes a path with non-ASCII bytes or specials (`"a/\\303\\274.txt"`);
 * the prefix then sits inside the quotes and the escapes stay as they are.
 */
function withPrefix(token: string, prefix: 'a' | 'b'): string {
  if (token.startsWith('"')) return `"${prefix}/${token.slice(1).replace(/^[ab]\//, '')}`;
  return `${prefix}/${token.replace(/^[ab]\//, '')}`;
}

/**
 * Swaps the two sides of the header. The `diff --git` line is rebuilt from
 * `---`/`+++` rather than split on spaces, since an unquoted path may
 * contain them.
 */
function reverseHeader(header: readonly string[]): string[] {
  const oldPath = header.find((l) => l.startsWith('--- '))?.slice(4);
  const newPath = header.find((l) => l.startsWith('+++ '))?.slice(4);
  return header.map((line) => {
    if (oldPath !== undefined && newPath !== undefined) {
      if (line.startsWith('--- ')) return `--- ${withPrefix(newPath, 'a')}`;
      if (line.startsWith('+++ ')) return `+++ ${withPrefix(oldPath, 'b')}`;
      if (line.startsWith('diff --git ')) {
        return `diff --git ${withPrefix(newPath, 'a')} ${withPrefix(oldPath, 'b')}`;
      }
    }
    const index = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(.*)$/.exec(line);
    if (index) return `index ${index[2]}..${index[1]}${index[3]}`;
    return line;
  });
}

/**
 * Swaps each changed line's side, keeping a `\ No newline` marker with the
 * line it belongs to, and orders every change run removals first.
 */
function reverseHunk(hunk: readonly string[]): string[] {
  const range = RANGE.exec(hunk[0]);
  const out = [range ? `@@ -${range[2]} +${range[1]} @@${range[3]}` : hunk[0]];
  let removed: string[] = [];
  let added: string[] = [];
  let last: string[] | null = null;
  const flush = () => {
    out.push(...removed, ...added);
    removed = [];
    added = [];
  };
  for (const line of hunk.slice(1)) {
    if (line.startsWith(NO_NEWLINE)) {
      (last ?? out).push(line);
      continue;
    }
    if (line.startsWith('+')) {
      removed.push('-' + line.slice(1));
      last = removed;
    } else if (line.startsWith('-')) {
      added.push('+' + line.slice(1));
      last = added;
    } else {
      flush();
      out.push(line);
      last = out;
    }
  }
  flush();
  return out;
}

/** The patch that undoes `patch`. Applying both in turn is a no-op. */
export function reversePatch(patch: string): string {
  const { header, hunks } = splitPatch(patch);
  return join([...reverseHeader(header), ...hunks.flatMap(reverseHunk)]);
}

/** Which per-hunk actions the viewer offers for this diff. */
export function hunkActionsFor(source: Pick<DiffSource, 'kind'>, rawPatch: string): HunkAction[] {
  if (hunkPatchFor(rawPatch, 0) === null) return [];
  if (source.kind === 'unstaged') return ['stage', 'discard'];
  if (source.kind === 'staged') return ['unstage'];
  return [];
}

/** The patch and target `git_apply_patch` needs for one action on one hunk. */
export function patchForHunkAction(
  rawPatch: string,
  hunkIndex: number,
  action: HunkAction
): { patch: string; target: PatchTarget } | null {
  if (action === 'stage') {
    const cut = hunkPatchFor(rawPatch, hunkIndex, 'old');
    return cut === null ? null : { patch: cut, target: 'index' };
  }
  const cut = hunkPatchFor(rawPatch, hunkIndex, 'new');
  if (cut === null) return null;
  return { patch: reversePatch(cut), target: action === 'unstage' ? 'index' : 'workdir' };
}
