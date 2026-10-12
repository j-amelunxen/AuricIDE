/**
 * A working-tree review shows the combined patch (HEAD → work tree), but
 * accepting a hunk means staging it and discarding one means dropping its lines, and
 * both act on the unstaged patch (index → work tree). The two only agree hunk
 * for hunk while nothing is staged, so each combined hunk is looked up by its
 * exact body in the unstaged patch, and an accepted one in the staged patch.
 *
 * Exact or nothing: a body that matches no hunk, or more than one, gets no
 * per-hunk action and the reviewer is offered the whole file instead. A fuzzy
 * match would stage or discard lines the reviewer was not looking at.
 */
import { hunkActionsFor } from '../hunkPatch';

export type WorktreeHunkTarget =
  | { kind: 'unstaged'; index: number }
  | { kind: 'staged'; index: number }
  | { kind: 'none'; reason: string };

/** Why a hunk has no action of its own. The UI adds what the reviewer can do instead. */
export const WHOLE_FILE_REASON =
  'New, deleted, renamed and binary files are handled as a whole, not per hunk.';

export const SIDES_UNREADABLE_REASON =
  'The staged and unstaged parts of this file could not be read, so its hunks cannot be matched.';

export const PARTIAL_STAGE_REASON =
  'Part of this file is already staged, so its hunks no longer line up one to one.';

/** Each hunk's lines after its `@@` header, so a shift in line numbers does not matter. */
function hunkBodies(patch: string): string[] {
  const bodies: string[][] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) bodies.push([]);
    else if (bodies.length > 0) bodies[bodies.length - 1].push(line);
  }
  return bodies.map((body) => {
    while (body.length > 0 && body[body.length - 1] === '') body.pop();
    return body.join('\n');
  });
}

function uniqueIndex(bodies: readonly string[], body: string): number | null {
  const first = bodies.indexOf(body);
  if (first === -1 || bodies.indexOf(body, first + 1) !== -1) return null;
  return first;
}

/** Every hunk of the combined patch, without an action, when the side patches failed to load. */
export function unreadableSideTargets(combinedPatch: string): WorktreeHunkTarget[] {
  return hunkBodies(combinedPatch).map(() => ({ kind: 'none', reason: SIDES_UNREADABLE_REASON }));
}

export function mapWorktreeHunks(
  combinedPatch: string,
  unstagedPatch: string,
  stagedPatch: string
): WorktreeHunkTarget[] {
  const combined = hunkBodies(combinedPatch);
  if (combined.length === 0) return [];
  const unstagedActionable = hunkActionsFor({ kind: 'unstaged' }, unstagedPatch).length > 0;
  const stagedActionable = hunkActionsFor({ kind: 'staged' }, stagedPatch).length > 0;
  if (!unstagedActionable && !stagedActionable) {
    return combined.map(() => ({ kind: 'none', reason: WHOLE_FILE_REASON }));
  }
  const unstaged = unstagedActionable ? hunkBodies(unstagedPatch) : [];
  const staged = stagedActionable ? hunkBodies(stagedPatch) : [];
  return combined.map((body): WorktreeHunkTarget => {
    const inUnstaged = uniqueIndex(unstaged, body);
    if (inUnstaged !== null) return { kind: 'unstaged', index: inUnstaged };
    const inStaged = uniqueIndex(staged, body);
    if (inStaged !== null) return { kind: 'staged', index: inStaged };
    return { kind: 'none', reason: PARTIAL_STAGE_REASON };
  });
}
