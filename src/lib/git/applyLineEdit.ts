import { readFile, writeFile } from '@/lib/tauri/fs';
import { getGitDiff, getGitDiffFileRef, stageFiles } from '@/lib/tauri/git';
import type { GitFileStatus } from '@/lib/tauri/git';
import type { DiffSource } from './diffTab';

export class LineEditError extends Error {
  readonly code: 'range' | 'mismatch';

  constructor(code: 'range' | 'mismatch', message: string) {
    super(message);
    this.name = 'LineEditError';
    this.code = code;
  }
}

/** Live work-tree diffs can be edited. Historical snapshots cannot. */
export function isEditableDiffSource(source: DiffSource): boolean {
  return source.kind === 'unstaged' || source.kind === 'combined' || source.kind === 'staged';
}

/**
 * A staged patch's new-file line numbers match the worktree only when that
 * file has no extra unstaged drift. Otherwise writing at `newLineNo` would
 * land in the wrong place.
 */
export function canEditStagedAgainstWorktree(status: GitFileStatus | undefined): boolean {
  return !status || status.unstaged === null;
}

interface SplitFile {
  lines: string[];
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

function splitFileContent(content: string): SplitFile {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = content.endsWith('\n');
  const stripped = trailingNewline ? content.slice(0, content.endsWith('\r\n') ? -2 : -1) : content;
  const lines = stripped === '' ? [''] : stripped.split(eol);
  return { lines, eol, trailingNewline };
}

function joinFileContent(split: SplitFile): string {
  const body = split.lines.join(split.eol);
  return split.trailingNewline ? `${body}${split.eol}` : body;
}

export function replaceFileLine(
  content: string,
  lineNo: number,
  expected: string,
  nextText: string
): string {
  const split = splitFileContent(content);
  if (lineNo < 1 || lineNo > split.lines.length) {
    throw new LineEditError('range', `Line ${lineNo} is out of range`);
  }
  const current = split.lines[lineNo - 1];
  if (current !== expected) {
    throw new LineEditError(
      'mismatch',
      'The file changed since this review opened — refresh the diff and try again'
    );
  }
  const replacement = nextText.split(/\r?\n/);
  split.lines = [...split.lines.slice(0, lineNo - 1), ...replacement, ...split.lines.slice(lineNo)];
  return joinFileContent(split);
}

export async function applyDiffLineEdit(args: {
  repoPath: string;
  filePath: string;
  lineNo: number;
  expected: string;
  nextText: string;
  restage: boolean;
}): Promise<void> {
  const abs = `${args.repoPath}/${args.filePath}`;
  const current = await readFile(abs);
  const next = replaceFileLine(current, args.lineNo, args.expected, args.nextText);
  if (next === current) return;
  await writeFile(abs, next);
  if (args.restage) {
    await stageFiles(args.repoPath, [args.filePath]);
  }
}

export async function reloadDiffPatch(
  repoPath: string,
  filePath: string,
  source: DiffSource
): Promise<string> {
  if (source.kind === 'ref') {
    return getGitDiffFileRef(repoPath, source.ref, filePath);
  }
  return getGitDiff(
    repoPath,
    filePath,
    source.kind === 'staged' || source.kind === 'unstaged' ? source.kind : undefined
  );
}
