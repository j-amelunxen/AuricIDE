import { describe, expect, it } from 'vitest';
import {
  mapWorktreeHunks,
  PARTIAL_STAGE_REASON,
  SIDES_UNREADABLE_REASON,
  unreadableSideTargets,
  WHOLE_FILE_REASON,
} from './worktreeHunkMap';

const header =
  'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n';
const hunkA = '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n';
const hunkB = '@@ -40,3 +40,3 @@ fn main\n forty\n-old\n+new\n forty-two\n';
// Same body as hunkB, shifted: what the unstaged patch shows once hunk A is staged.
const hunkBShifted = '@@ -40,3 +40,3 @@ fn main\n forty\n-old\n+new\n forty-two\n';

const newFile =
  'diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+hello\n';

describe('unreadableSideTargets', () => {
  it('says the hunks could not be read rather than blaming the kind of file', () => {
    expect(unreadableSideTargets(header + hunkA + hunkB)).toEqual([
      { kind: 'none', reason: SIDES_UNREADABLE_REASON },
      { kind: 'none', reason: SIDES_UNREADABLE_REASON },
    ]);
    expect(SIDES_UNREADABLE_REASON).not.toBe(WHOLE_FILE_REASON);
  });

  it('has nothing to say for a patch without hunks', () => {
    expect(unreadableSideTargets(header)).toEqual([]);
  });
});

describe('mapWorktreeHunks', () => {
  it('maps every hunk one to one when nothing is staged', () => {
    const patch = header + hunkA + hunkB;
    expect(mapWorktreeHunks(patch, patch, '')).toEqual([
      { kind: 'unstaged', index: 0 },
      { kind: 'unstaged', index: 1 },
    ]);
  });

  it('finds an accepted hunk in the staged patch and the rest in the unstaged one', () => {
    const combined = header + hunkA + hunkB;
    expect(mapWorktreeHunks(combined, header + hunkBShifted, header + hunkA)).toEqual([
      { kind: 'staged', index: 0 },
      { kind: 'unstaged', index: 0 },
    ]);
  });

  it('refuses when a hunk matches nothing exactly', () => {
    const combined = header + hunkA;
    const unstaged = header + '@@ -1,3 +1,3 @@\n one\n-TWO\n+2\n three\n';
    const staged = header + hunkA.replace('+TWO', '+Two');
    expect(mapWorktreeHunks(combined, unstaged, staged)).toEqual([
      { kind: 'none', reason: PARTIAL_STAGE_REASON },
    ]);
  });

  it('refuses when a body matches twice, rather than guessing which one', () => {
    const combined = header + hunkA;
    const unstaged = header + hunkA + hunkA.replace('-1,3 +1,3', '-90,3 +90,3');
    expect(mapWorktreeHunks(combined, unstaged, '')[0].kind).toBe('none');
  });

  it('sends new, deleted and binary files to whole-file actions', () => {
    expect(mapWorktreeHunks(newFile, newFile, '')).toEqual([
      { kind: 'none', reason: WHOLE_FILE_REASON },
    ]);
  });

  it('returns nothing for a patch without hunks', () => {
    expect(mapWorktreeHunks('', '', '')).toEqual([]);
  });
});
