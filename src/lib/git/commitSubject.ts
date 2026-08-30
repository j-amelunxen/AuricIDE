import type { GitFileStatus } from '@/lib/tauri/git';

/** How much of the change reaches the model. A subject line needs the shape of
 * the diff, not all of it, and the call happens while the user waits. */
const MAX_FILES = 12;
const MAX_CHARS_PER_FILE = 4000;
const MAX_CHARS_TOTAL = 16_000;

/** Git's own soft limit for a subject line. */
const MAX_SUBJECT_CHARS = 72;

export type ChangedFile = Pick<GitFileStatus, 'path' | 'status'>;

export interface CommitSubjectPromptInput {
  files: readonly ChangedFile[];
  diff: string;
  /** What the agent was originally asked to do — context, never the answer. */
  task?: string;
}

export interface GenerateCommitSubjectInput extends Pick<CommitSubjectPromptInput, 'task'> {
  listChanges: () => Promise<readonly ChangedFile[]>;
  diffFor: (filePath: string) => Promise<string>;
  askLlm: (prompt: string) => Promise<string>;
}

const INSTRUCTION = [
  'Write the git commit subject line for the change below.',
  'Rules: exactly one line, five to eight words, imperative mood ("Add", "Fix", "Move"),',
  'no quotes, no type prefix, no trailing period. Say what the change does, not which files it touched.',
  'Answer with the line and nothing else.',
].join(' ');

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function verbFor(files: readonly ChangedFile[]): string {
  if (files.every((f) => f.status === 'added' || f.status === 'untracked')) return 'Add';
  if (files.every((f) => f.status === 'deleted')) return 'Remove';
  return 'Update';
}

/**
 * The message when no model answers: the file list, said plainly. Not clever,
 * but it describes the commit instead of repeating the prompt that caused it.
 */
export function fallbackCommitSubject(files: readonly ChangedFile[]): string {
  if (files.length === 0) return 'Update working tree';
  const verb = verbFor(files);
  const first = basename(files[0].path);
  if (files.length === 1) return `${verb} ${first}`;
  const rest = files.length - 1;
  return `${verb} ${first} and ${rest} more file${rest === 1 ? '' : 's'}`;
}

/**
 * Models answer with quotes, bullets, a "Commit message:" label or a whole
 * paragraph. Take the first real line and strip the decoration off it.
 * Null means the answer held no usable subject.
 */
export function cleanCommitSubject(raw: string): string | null {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('```'));
  if (!firstLine) return null;

  let line = firstLine
    .replace(/^(?:subject|title|commit(?:\s+message)?)\s*:\s*/i, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^#+\s*/, '')
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/, '')
    .trim();
  if (!line) return null;

  if (line.length > MAX_SUBJECT_CHARS) {
    const cut = line.slice(0, MAX_SUBJECT_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    line = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return line || null;
}

/** Patches for the changed files, capped so a huge change still fits a prompt. */
export async function collectWorktreeDiff(
  files: readonly ChangedFile[],
  diffFor: (filePath: string) => Promise<string>
): Promise<string> {
  const parts: string[] = [];
  let total = 0;
  for (const file of files.slice(0, MAX_FILES)) {
    if (total >= MAX_CHARS_TOTAL) break;
    let patch: string;
    try {
      patch = await diffFor(file.path);
    } catch {
      continue; // a file we cannot read is one the model does without
    }
    if (!patch.trim()) continue;
    const room = Math.min(MAX_CHARS_PER_FILE, MAX_CHARS_TOTAL - total);
    const clipped = patch.length > room ? `${patch.slice(0, room)}\n…` : patch;
    parts.push(clipped);
    total += clipped.length;
  }
  return parts.join('\n');
}

export function buildCommitSubjectPrompt(input: CommitSubjectPromptInput): string {
  const list = input.files.map((f) => `${f.status}: ${f.path}`).join('\n');
  const sections = [INSTRUCTION, `Changed files:\n${list}`];
  if (input.task?.trim()) {
    sections.push(`The agent was asked to: ${input.task.trim()}`);
  }
  if (input.diff.trim()) {
    sections.push(`Diff:\n${input.diff}`);
  }
  return sections.join('\n\n');
}

/**
 * A subject line for the leftover work in a worktree. Asks the model, and
 * answers from the file list when there is no model to ask.
 */
export async function generateCommitSubject(input: GenerateCommitSubjectInput): Promise<string> {
  let files: readonly ChangedFile[] = [];
  try {
    files = (await input.listChanges()).filter((f) => f.status !== 'ignored');
  } catch {
    files = [];
  }

  const fallback = fallbackCommitSubject(files);
  if (files.length === 0) return fallback;

  const diff = await collectWorktreeDiff(files, input.diffFor);
  try {
    const answer = await input.askLlm(buildCommitSubjectPrompt({ files, diff, task: input.task }));
    return cleanCommitSubject(answer) ?? fallback;
  } catch {
    return fallback;
  }
}
