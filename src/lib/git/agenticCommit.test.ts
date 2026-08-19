import { describe, expect, it } from 'vitest';
import { buildAgenticCommitTask } from './agenticCommit';

const PROMPT = 'commit on the current branch. Prefix: {ticket}: ({branch})';
const PATTERN = '([A-Z]+-\\d+)';

describe('buildAgenticCommitTask', () => {
  it('fills {ticket} and {branch}, then tells the agent not to push', () => {
    const task = buildAgenticCommitTask(PROMPT, 'feature/AUR-42-thing', PATTERN, { push: false });

    expect(task).toContain('Prefix: AUR-42: (feature/AUR-42-thing)');
    expect(task).toMatch(/do not push/i);
    expect(task).not.toMatch(/push the current branch to origin/i);
  });

  it('fills placeholders, then tells the agent to push after the commit', () => {
    const task = buildAgenticCommitTask(PROMPT, 'feature/AUR-42-thing', PATTERN, { push: true });

    expect(task).toContain('Prefix: AUR-42: (feature/AUR-42-thing)');
    expect(task).toMatch(/push the current branch to origin/i);
  });

  it('still forbids push when the stored prompt itself asks to push', () => {
    // Projects that saved the old default still say "commit and push". The
    // button is the decision, so the last instruction has to override it.
    const task = buildAgenticCommitTask(
      'commit and push. Prefix: {ticket}:',
      'feature/AUR-9-thing',
      PATTERN,
      { push: false }
    );

    expect(task.endsWith('Commit only. Do not push. Do not run git push.')).toBe(true);
  });

  it('leaves an empty ticket when the branch has none', () => {
    const task = buildAgenticCommitTask(PROMPT, 'main', PATTERN, { push: false });

    expect(task).toContain('Prefix: : (main)');
  });
});
