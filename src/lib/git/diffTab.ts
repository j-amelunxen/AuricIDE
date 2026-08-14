export type DiffSource =
  | { kind: 'combined' }
  | { kind: 'staged' }
  | { kind: 'unstaged' }
  | { kind: 'revision'; oid: string; summary: string }
  | { kind: 'ref'; ref: string };

export interface DiffTabState {
  patch: string;
  /** Repo-relative. Never parse this out of the tab id. */
  filePath: string;
  source: DiffSource;
}
