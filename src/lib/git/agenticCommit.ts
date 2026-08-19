import { resolveCommandTemplate } from './branchTicket';

/**
 * The project prompt says *how* to write the commit (ticket prefix, stay on
 * the branch). Whether the agent also pushes is the button that was clicked,
 * not a setting — one click, one promise.
 *
 * The push/no-push sentence is appended last so it still wins when an older
 * saved prompt itself says "commit and push".
 */
export function buildAgenticCommitTask(
  prompt: string,
  branchName: string,
  ticketPattern: string,
  options: { push: boolean }
): string {
  const filled = resolveCommandTemplate(prompt, branchName, ticketPattern);
  if (options.push) {
    return `${filled}\n\nAfter committing, push the current branch to origin.`;
  }
  return `${filled}\n\nCommit only. Do not push. Do not run git push.`;
}
