/** Tab id of the merge view for one conflicted file. Never parse it back: the slice keeps both paths. */
export function mergeTabId(repoPath: string, filePath: string): string {
  return `merge:${repoPath}:${filePath}`;
}

export function isMergeTabId(id: string): boolean {
  return id.startsWith('merge:');
}
