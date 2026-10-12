/**
 * The start instruction for an agent CLI that resolves a whole merge. The
 * agent does the edits and stages them; committing stays with the human, who
 * concludes the merge in the panel after reading what the agent did.
 */

export interface ResolveAllInput {
  repoPath: string;
  oursLabel: string;
  theirsLabel: string;
  conflicts: readonly { path: string; kind: string }[];
}

const KIND_TEXT: Record<string, string> = {
  content: 'both sides edited the same lines',
  'both-added': 'both sides added this file',
  'deleted-by-us': `deleted on our side, edited on theirs`,
  'deleted-by-them': 'deleted by them, edited on our side',
  binary: 'binary file, pick one side',
  symlink: 'both sides changed the link target, pick one side',
};

export function buildResolveAllPrompt(input: ResolveAllInput): string {
  const { repoPath, oursLabel, theirsLabel, conflicts } = input;
  const files = conflicts.map((c) => `- ${c.path} (${KIND_TEXT[c.kind] ?? c.kind})`);
  return [
    `A git merge is in progress in ${repoPath}: branch "${theirsLabel}" is being merged into "${oursLabel}".`,
    `These ${conflicts.length} files have conflicts:`,
    ...files,
    '',
    'For each file:',
    `1. Read both sides and the common ancestor (git show :1:<path>, :2:<path>, :3:<path>) and work out what each side intended.`,
    '2. Write the file so that both intents hold. Where they truly cannot, keep the one that fits the rest of the code and note it.',
    '3. Leave no conflict marker lines (<<<<<<<, |||||||, =======, >>>>>>>) in the file.',
    '4. For a file deleted on one side, decide whether it should exist, then either keep it or git rm it.',
    '5. Stage the resolved file with git add <path> (or git rm for a deletion).',
    '',
    'Rules:',
    '- Do not commit. The human concludes the merge after reviewing your work.',
    '- Do not abort the merge, and do not run git reset, git checkout or git stash.',
    '- Do not touch files that are not in the list above.',
    '- If a file cannot be resolved with confidence, leave it conflicted and say why.',
    '',
    'Finish with a summary: one line per file saying how it was resolved, and which files, if any, you left for the human.',
  ].join('\n');
}
