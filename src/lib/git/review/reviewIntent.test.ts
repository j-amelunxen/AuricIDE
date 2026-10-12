import { describe, expect, it } from 'vitest';
import { reviewIntentFor } from './reviewIntent';

const WT = '/work/app.auric-wt/fix-login';
const tickets = [{ id: 't1', name: 'Fix the login redirect' }];

describe('reviewIntentFor', () => {
  it('names the first agent of an agent worktree as the author, with its ticket and task', () => {
    const intent = reviewIntentFor(
      WT,
      [
        { id: 'b', name: 'follow-up', repoPath: WT, startedAt: 20, currentTask: 'Address review' },
        {
          id: 'a',
          name: 'fix-login',
          repoPath: WT,
          startedAt: 10,
          currentTask: 'Fix the redirect after login',
          spawnedByTicketId: 't1',
        },
      ],
      tickets
    );
    expect(intent).toEqual({
      relation: 'author',
      agentName: 'fix-login',
      ticketName: 'Fix the login redirect',
      task: 'Fix the redirect after login',
    });
  });

  it('names only the latest agent in a plain repo, and says it is only the latest', () => {
    const intent = reviewIntentFor(
      '/work/app',
      [
        { id: 'a', name: 'older', repoPath: '/work/app', startedAt: 10 },
        { id: 'b', name: 'newer', repoPath: '/work/app', startedAt: 20, currentTask: 'Tidy' },
      ],
      tickets
    );
    expect(intent).toMatchObject({ relation: 'latest', agentName: 'newer', ticketName: null });
  });

  it('skips reviewer agents, which did not write the change', () => {
    expect(
      reviewIntentFor(
        WT,
        [{ id: 'r', name: 'judge', repoPath: WT, startedAt: 1, reviewOfTicketId: 't1' }],
        tickets
      )
    ).toBeNull();
  });

  it('knows nothing when no agent ran there', () => {
    expect(
      reviewIntentFor(WT, [{ id: 'x', name: 'x', repoPath: '/elsewhere', startedAt: 1 }], [])
    ).toBeNull();
  });

  it('keeps an unknown ticket id out of the header', () => {
    const intent = reviewIntentFor(
      WT,
      [{ id: 'a', name: 'a', repoPath: WT, startedAt: 1, spawnedByTicketId: 'gone' }],
      tickets
    );
    expect(intent?.ticketName).toBeNull();
  });
});
