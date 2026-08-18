import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewCommentsPrompt,
  openReviewCommentsSpawn,
  reviewCommentId,
  sortReviewComments,
  type ReviewComment,
} from './reviewComments';

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'id',
    repoPath: '/repo',
    filePath: 'src/a.ts',
    lineNo: 4,
    side: 'new',
    lineContent: 'const x = 1',
    body: 'rename x',
    createdAt: 1,
    ...overrides,
  };
}

describe('reviewCommentId', () => {
  it('is stable for the same line identity', () => {
    const a = reviewCommentId({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      side: 'new',
      lineNo: 4,
    });
    const b = reviewCommentId({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      side: 'new',
      lineNo: 4,
    });
    expect(a).toBe(b);
  });

  it('differs across file, side, or line', () => {
    const base = { repoPath: '/repo', filePath: 'src/a.ts', side: 'new' as const, lineNo: 4 };
    expect(reviewCommentId({ ...base, filePath: 'src/b.ts' })).not.toBe(reviewCommentId(base));
    expect(reviewCommentId({ ...base, side: 'old' })).not.toBe(reviewCommentId(base));
    expect(reviewCommentId({ ...base, lineNo: 5 })).not.toBe(reviewCommentId(base));
  });
});

describe('sortReviewComments', () => {
  it('orders by file, then line, then old before new', () => {
    const comments = [
      comment({ id: 'c', filePath: 'src/b.ts', lineNo: 1 }),
      comment({ id: 'b', filePath: 'src/a.ts', lineNo: 8, side: 'new' }),
      comment({ id: 'a', filePath: 'src/a.ts', lineNo: 8, side: 'old' }),
      comment({ id: 'd', filePath: 'src/a.ts', lineNo: 2 }),
    ];
    expect(sortReviewComments(comments).map((c) => c.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('buildReviewCommentsPrompt', () => {
  it('asks the agent to work the list in order, one comment at a time', () => {
    const prompt = buildReviewCommentsPrompt([
      comment({ filePath: 'src/b.ts', lineNo: 1, lineContent: 'foo()', body: 'extract this' }),
      comment({
        filePath: 'src/a.ts',
        lineNo: 4,
        lineContent: 'const x = 1',
        body: 'rename x',
        side: 'new',
      }),
    ]);

    expect(prompt).toMatch(/checklist/i);
    expect(prompt).toMatch(/in this exact order/i);
    expect(prompt).toMatch(/do not skip/i);
    expect(prompt.indexOf('src/a.ts:4')).toBeLessThan(prompt.indexOf('src/b.ts:1'));
    expect(prompt).toContain('const x = 1');
    expect(prompt).toContain('rename x');
    expect(prompt).toContain('extract this');
    expect(prompt).toMatch(/1\. `src\/a\.ts:4` \(new file\)/);
    expect(prompt).toMatch(/2\. `src\/b\.ts:1` \(new file\)/);
  });

  it('labels removed-side comments as old file', () => {
    const prompt = buildReviewCommentsPrompt([
      comment({ side: 'old', lineNo: 9, lineContent: 'dead()', body: 'keep this' }),
    ]);
    expect(prompt).toContain('src/a.ts:9');
    expect(prompt).toContain('(old file)');
    expect(prompt).toContain('keep this');
  });
});

describe('openReviewCommentsSpawn', () => {
  function spawnStore() {
    return {
      setSpawnAgentTicketId: vi.fn(),
      setSpawnAgentGoalId: vi.fn(),
      setSpawnAgentPreset: vi.fn(),
      setInitialAgentTask: vi.fn(),
      setSpawnAgentRepoPath: vi.fn(),
      setSpawnDialogOpen: vi.fn(),
    };
  }

  it('opens the spawn dialog with the checklist prompt for that repo', () => {
    const store = spawnStore();
    const opened = openReviewCommentsSpawn(store, [comment()], '/repo');

    expect(opened).toBe(true);
    expect(store.setSpawnAgentTicketId).toHaveBeenCalledWith(null);
    expect(store.setSpawnAgentGoalId).toHaveBeenCalledWith(null);
    expect(store.setSpawnAgentPreset).toHaveBeenCalledWith(null);
    expect(store.setSpawnAgentRepoPath).toHaveBeenCalledWith('/repo');
    expect(store.setSpawnDialogOpen).toHaveBeenCalledWith(true);
    expect(store.setInitialAgentTask).toHaveBeenCalledWith(expect.stringContaining('rename x'));
  });

  it('ignores comments from other repos and blank bodies', () => {
    const store = spawnStore();
    const opened = openReviewCommentsSpawn(
      store,
      [
        comment({ repoPath: '/other', body: 'nope' }),
        comment({ body: '   ' }),
        comment({ body: 'do this' }),
      ],
      '/repo'
    );

    expect(opened).toBe(true);
    const task = store.setInitialAgentTask.mock.calls[0][0] as string;
    expect(task).toContain('do this');
    expect(task).not.toContain('nope');
  });

  it('does not open the dialog when nothing is sendable', () => {
    const store = spawnStore();
    expect(openReviewCommentsSpawn(store, [comment({ body: '  ' })], '/repo')).toBe(false);
    expect(store.setSpawnDialogOpen).not.toHaveBeenCalled();
  });
});
