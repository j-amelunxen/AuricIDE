import type { GitFileStatus } from '@/lib/tauri/git';

/**
 * The mode half of a git patch. Git records one permission fact per file —
 * whether it is executable — so a patch can change a file's mode without
 * touching a byte of it. The diff viewer needs to say that in words, because
 * a patch like that has no hunk to show.
 */
export interface GitModeChange {
  oldMode: string;
  newMode: string;
}

const OLD_MODE = /^old mode (\d+)$/;
const NEW_MODE = /^new mode (\d+)$/;

const MODE_LABELS: Record<string, string> = {
  '100644': 'regular file',
  '100755': 'executable',
  '120000': 'symlink',
  '160000': 'submodule',
};

/** The mode pair of a patch, or null when the patch does not change a mode. */
export function parseModeChange(raw: string): GitModeChange | null {
  let oldMode: string | null = null;
  let newMode: string | null = null;
  for (const line of raw.split('\n')) {
    oldMode ??= OLD_MODE.exec(line)?.[1] ?? null;
    newMode ??= NEW_MODE.exec(line)?.[1] ?? null;
    if (oldMode && newMode) break;
  }
  if (!oldMode || !newMode || oldMode === newMode) return null;
  return { oldMode, newMode };
}

export function describeGitMode(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

/** Regular file ↔ executable: the one flip a filesystem can cause on its own. */
export function isExecutableBitFlip({ oldMode, newMode }: GitModeChange): boolean {
  const pair = [oldMode, newMode].sort().join('-');
  return pair === '100644-100755';
}

/**
 * Below this, a mode change is most likely a chmod someone meant. Nobody flips
 * ten files by hand without knowing it; a share that does not keep the
 * executable bit flips every file in the repository.
 */
export const MODE_CHANGE_HINT_THRESHOLD = 10;

export function countModeChanged(statuses: GitFileStatus[]): number {
  return statuses.filter((s) => s.modeChanged === true).length;
}
