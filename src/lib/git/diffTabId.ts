import type { DiffSource } from './diffTab';

export function diffTabId(source: DiffSource, filePath: string, repoPath: string): string {
  switch (source.kind) {
    case 'unstaged':
      return `diff:unstaged:${repoPath}:${filePath}`;
    case 'staged':
      return `diff:staged:${repoPath}:${filePath}`;
    case 'combined':
      return `diff:combined:${repoPath}:${filePath}`;
    case 'revision':
      return `diff:rev:${source.oid}:${repoPath}:${filePath}`;
    case 'ref':
      return `diff:ref:${encodeURIComponent(source.ref)}:${repoPath}:${filePath}`;
  }
}

export function isDiffTabId(id: string): boolean {
  return id.startsWith('diff:');
}
