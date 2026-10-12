import { useMemo } from 'react';
import { flagsForHunk } from '@/lib/git/review/riskChips';
import type { RiskFlag } from '@/lib/git/review/riskFlags';
import type { HunkHeaderApi } from './HunkHeaderContext';
import { HunkToolbar, type HunkToolbarAction } from './HunkToolbar';

/** The diff viewer's hunk headers: the hunk's risk chips and its stage/unstage/discard actions. */
export function useHunkHeaderApi({
  focusedHunk,
  hunkCount,
  fileName,
  riskFlags,
  toolbarActions,
  busy,
}: {
  focusedHunk: number;
  hunkCount: number;
  fileName: string;
  riskFlags: readonly RiskFlag[];
  toolbarActions: (hunkIndex: number) => HunkToolbarAction[];
  busy: boolean;
}): HunkHeaderApi {
  return useMemo<HunkHeaderApi>(
    () => ({
      focusedHunk,
      renderHunkHeader: (hunkIndex) => (
        <HunkToolbar
          hunkIndex={hunkIndex}
          hunkCount={hunkCount}
          fileName={fileName}
          flags={flagsForHunk(riskFlags, hunkIndex)}
          actions={toolbarActions(hunkIndex)}
          visibility={hunkIndex === focusedHunk ? 'focused' : 'hover'}
          busy={busy}
        />
      ),
    }),
    [busy, fileName, focusedHunk, hunkCount, riskFlags, toolbarActions]
  );
}
