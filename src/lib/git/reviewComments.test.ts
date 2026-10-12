import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewCommentsPrompt,
  markCommentsSent,
  nextReviewRound,
  newReviewCommentId,
  openReviewCommentsSpawn,
  reviewLineKey,
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

describe('reviewLineKey', () => {
  it('is stable for the same line identity', () => {
    const a = reviewLineKey({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      side: 'new',
      lineNo: 4,
    });
    const b = reviewLineKey({
      repoPath: '/repo',
      filePath: 'src/a.ts',
      side: 'new',
      lineNo: 4,
    });
    expect(a).toBe(b);
  });

  it('differs across file, side, or line', () => {
    const base = { repoPath: '/repo', filePath: 'src/a.ts', side: 'new' as const, lineNo: 4 };
    expect(reviewLineKey({ ...base, filePath: 'src/b.ts' })).not.toBe(reviewLineKey(base));
    expect(reviewLineKey({ ...base, side: 'old' })).not.toBe(reviewLineKey(base));
    expect(reviewLineKey({ ...base, lineNo: 5 })).not.toBe(reviewLineKey(base));
  });

  it('is what records written before threads used as their id', () => {
    const base = { repoPath: '/repo', filePath: 'src/a.ts', side: 'new' as const, lineNo: 4 };
    expect(reviewLineKey(base)).toBe('/repo\u0000src/a.ts\u0000new\u00004');
  });
});

describe('newReviewCommentId', () => {
  it('gives every comment its own id, never shaped like a line key', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newReviewCommentId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).not.toContain('\u0000');
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

  it('keeps a thread in the order it was written', () => {
    const comments = [
      comment({ id: 'later', createdAt: 5 }),
      comment({ id: 'first', createdAt: 1 }),
      comment({ id: 'middle', createdAt: 3 }),
    ];
    expect(sortReviewComments(comments).map((c) => c.id)).toEqual(['first', 'middle', 'later']);
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

  it('lists every open comment of a thread as its own item, each quoting the line', () => {
    const prompt = buildReviewCommentsPrompt([
      comment({ id: 'b', body: 'also add a test', createdAt: 2 }),
      comment({ id: 'a', body: 'rename x', createdAt: 1 }),
      comment({ id: 's', body: 'sent before', createdAt: 0, sentInRound: 1 }),
    ]);
    expect(prompt).toMatch(
      /1\. `src\/a\.ts:4` \(new file\)\n {3}Code: `const x = 1`\n {3}Comment: rename x/
    );
    expect(prompt).toMatch(
      /2\. `src\/a\.ts:4` \(new file\)\n {3}Code: `const x = 1`\n {3}Comment: also add a test/
    );
    expect(prompt).not.toContain('sent before');
    expect(prompt).not.toMatch(/3\. /);
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

describe('sent rounds', () => {
  it('leaves comments that were already sent out of the prompt', () => {
    const prompt = buildReviewCommentsPrompt([
      comment({ id: 'a', body: 'already done', sentInRound: 1 }),
      comment({ id: 'b', lineNo: 9, body: 'still open' }),
    ]);
    expect(prompt).toContain('still open');
    expect(prompt).not.toContain('already done');
    expect(prompt).toMatch(/1\. `src\/a\.ts:9`/);
  });

  it('marks the open comments of one repo as sent in that round', () => {
    const open = comment({ id: 'open' });
    const sent = comment({ id: 'sent', sentInRound: 1 });
    const other = comment({ id: 'other', repoPath: '/other' });
    const blank = comment({ id: 'blank', body: '  ' });
    const next = markCommentsSent([open, sent, other, blank], '/repo', 2);

    expect(next.find((c) => c.id === 'open')?.sentInRound).toBe(2);
    expect(next.find((c) => c.id === 'sent')?.sentInRound).toBe(1);
    expect(next.find((c) => c.id === 'other')?.sentInRound).toBeUndefined();
    expect(next.find((c) => c.id === 'blank')?.sentInRound).toBeUndefined();
    expect(next.find((c) => c.id === 'sent')).toBe(sent);
    expect(open.sentInRound).toBeUndefined();
  });

  it('returns the same array when nothing was open', () => {
    const comments = [comment({ sentInRound: 1 })];
    expect(markCommentsSent(comments, '/repo', 2)).toBe(comments);
  });

  it('numbers the next round per repo', () => {
    expect(nextReviewRound([], '/repo')).toBe(1);
    expect(
      nextReviewRound(
        [comment({ sentInRound: 2 }), comment({ sentInRound: 5, repoPath: '/other' })],
        '/repo'
      )
    ).toBe(3);
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

  it('sends only comments that were not sent in an earlier round', () => {
    const store = spawnStore();
    const opened = openReviewCommentsSpawn(
      store,
      [
        comment({ id: 'a', body: 'old round', sentInRound: 1 }),
        comment({ id: 'b', lineNo: 7, body: 'new' }),
      ],
      '/repo'
    );
    expect(opened).toBe(true);
    const task = store.setInitialAgentTask.mock.calls[0][0] as string;
    expect(task).toContain('new');
    expect(task).not.toContain('old round');
  });

  it('does not open the dialog when every comment was already sent', () => {
    const store = spawnStore();
    expect(openReviewCommentsSpawn(store, [comment({ sentInRound: 1 })], '/repo')).toBe(false);
    expect(store.setSpawnDialogOpen).not.toHaveBeenCalled();
  });

  it('does not open the dialog when nothing is sendable', () => {
    const store = spawnStore();
    expect(openReviewCommentsSpawn(store, [comment({ body: '  ' })], '/repo')).toBe(false);
    expect(store.setSpawnDialogOpen).not.toHaveBeenCalled();
  });
});
