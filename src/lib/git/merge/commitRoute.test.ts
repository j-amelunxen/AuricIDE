import { describe, expect, it } from 'vitest';
import { commitRouteFor, operationBlocksCommitMessage } from './commitRoute';

const merge = { inProgress: true, operation: 'merge' as const };

describe('commitRouteFor', () => {
  it('commits normally when nothing is in progress', () => {
    expect(commitRouteFor(undefined, { agentic: false })).toEqual({ kind: 'commit' });
    expect(commitRouteFor({ inProgress: false, operation: 'none' }, { agentic: true })).toEqual({
      kind: 'commit',
    });
  });

  it('concludes a merge instead of making a plain commit', () => {
    expect(commitRouteFor(merge, { agentic: false })).toEqual({ kind: 'conclude-merge' });
  });

  it('refuses rebase, cherry-pick and revert', () => {
    for (const operation of ['rebase', 'cherry-pick', 'revert', 'other'] as const) {
      expect(commitRouteFor({ inProgress: true, operation }, { agentic: false })).toEqual({
        kind: 'refuse',
        message: operationBlocksCommitMessage(operation),
      });
    }
  });

  it('refuses a commit agent during any operation, a merge included', () => {
    expect(commitRouteFor(merge, { agentic: true })).toEqual({
      kind: 'refuse',
      message: operationBlocksCommitMessage('merge'),
    });
  });

  it('names the operation in the message', () => {
    expect(operationBlocksCommitMessage('cherry-pick')).toMatch(/cherry-pick is in progress/);
  });
});
