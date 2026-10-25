export type DiffSource =
  | { kind: 'combined' }
  | { kind: 'staged' }
  | { kind: 'unstaged' }
  | { kind: 'revision'; oid: string; summary: string }
  | { kind: 'ref'; ref: string }
  /** Two files on disk, compared read-only; no repository is involved. Absolute paths. */
  | { kind: 'files'; left: string; right: string };

export interface DiffTabState {
  patch: string;
  /** Repo-relative; for a `files` comparison the header label. Never parse this out of the tab id. */
  filePath: string;
  source: DiffSource;
  /** Absolute work-tree path of the repo the diff belongs to; empty for a `files` comparison. */
  repoPath: string;
}
