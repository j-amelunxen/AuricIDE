/** The header line: everything running, where, and what still wants a human. */
export function consoleSummaryLine({
  running,
  projects,
  needing,
  doneUnreviewed,
}: {
  running: number;
  projects: number;
  needing: number;
  doneUnreviewed: number;
}): string {
  const projectWord = projects === 1 ? 'project' : 'projects';
  const needWord = needing === 1 ? 'needs' : 'need';
  return `${running} running across ${projects} ${projectWord} · ${needing} ${needWord} you · ${doneUnreviewed} done, unreviewed`;
}

/** The header's attention pill — the one-glance answer to "do I need to look". */
export function consoleAttentionBadge(needing: number): string {
  if (needing === 0) return 'All clear';
  return `${needing} ${needing === 1 ? 'needs' : 'need'} you`;
}
