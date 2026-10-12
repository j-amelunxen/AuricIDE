import { describe, expect, it } from 'vitest';
import { buildResolveAllPrompt } from './resolveAllPrompt';

const prompt = buildResolveAllPrompt({
  repoPath: '/work/app',
  oursLabel: 'main',
  theirsLabel: 'feature/x',
  conflicts: [
    { path: 'src/a.ts', kind: 'content' },
    { path: 'docs/b.md', kind: 'deleted-by-them' },
  ],
});

describe('buildResolveAllPrompt', () => {
  it('names the repo, both branches and every conflicted file with its kind', () => {
    expect(prompt).toContain('/work/app');
    expect(prompt).toContain('main');
    expect(prompt).toContain('feature/x');
    expect(prompt).toContain('src/a.ts');
    expect(prompt).toContain('docs/b.md');
    expect(prompt).toMatch(/deleted by them|deleted-by-them/);
  });

  it('states the rules: keep both intents, no markers, git add, no commit, no abort, summary', () => {
    expect(prompt).toMatch(/both/i);
    expect(prompt).toMatch(/marker/i);
    expect(prompt).toContain('git add');
    expect(prompt).toMatch(/do not commit/i);
    expect(prompt).toMatch(/do not abort/i);
    expect(prompt).toMatch(/summary/i);
  });

  it('uses no em dashes', () => {
    expect(prompt).not.toContain('—');
  });
});
