interface PathStatus {
  path: string;
  status: string;
}

/**
 * Selects the git status of one file as a short string ("modified", "added,
 * modified", or "" when clean) — a primitive, so a zustand selector returning
 * it never loops, and an effect keyed on it refetches only when the file's
 * status really changes.
 *
 * A selector runs on every store write, and filtering a repo's full status
 * list each time is wasted work: the list only changes on a git refresh. The
 * returned function remembers its last list and path, so a write elsewhere
 * costs two reference checks. One per hook instance — each watches its own
 * file.
 */
export function createStatusSignatureSelector(): (
  statuses: readonly PathStatus[],
  path: string
) => string {
  let last: { statuses: readonly PathStatus[]; path: string; signature: string } | null = null;
  return (statuses, path) => {
    if (last && last.statuses === statuses && last.path === path) return last.signature;
    const signature = statuses
      .filter((f) => f.path === path)
      .map((f) => f.status)
      .join(',');
    last = { statuses, path, signature };
    return signature;
  };
}
