import type { DiffSource } from './diffTab';

export function diffTabId(source: DiffSource, filePath: string): string {
  switch (source.kind) {
    case 'unstaged':
      return `diff:unstaged:${filePath}`;
    case 'staged':
      return `diff:staged:${filePath}`;
    case 'combined':
      return `diff:combined:${filePath}`;
    case 'revision':
      return `diff:rev:${source.oid}:${filePath}`;
    case 'ref':
      return `diff:ref:${encodeURIComponent(source.ref)}:${filePath}`;
  }
}

export function isDiffTabId(id: string): boolean {
  return id.startsWith('diff:');
}
