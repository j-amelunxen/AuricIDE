import type { AgentInfo } from '../tauri/agents';
import { UNGROUPED_REPO_KEY } from '../store/agentSlice';

/** One repository's worth of agent tabs, with the name to print above them. */
export interface AgentTabGroup {
  /** The repository these agents run in, or null when they carry no path. */
  repoPath: string | null;
  /** Folder name — widened to `parent/name` where that would be ambiguous. */
  label: string;
  agents: AgentInfo[];
}

function segments(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0);
}

/**
 * The shortest tail of a path that still tells the repositories apart. A bare
 * folder name is what a person recognises, so it stays the default and only
 * widens where two checkouts would otherwise print the same word.
 */
function shortestDistinctLabels(paths: string[]): string[] {
  const parts = paths.map(segments);
  const depth = parts.map(() => 1);

  for (let round = 0; round < Math.max(...parts.map((p) => p.length), 1); round++) {
    const labels = parts.map((p, i) => p.slice(-depth[i]).join('/') || paths[i]);
    const seen = new Map<string, number>();
    for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);

    let widened = false;
    labels.forEach((label, i) => {
      if ((seen.get(label) ?? 0) > 1 && depth[i] < parts[i].length) {
        depth[i]++;
        widened = true;
      }
    });
    if (!widened) break;
  }

  return parts.map((p, i) => p.slice(-depth[i]).join('/') || paths[i]);
}

/**
 * Splits a fleet into one group per repository, so a strip of tabs from four
 * projects reads as four projects instead of one undifferentiated row.
 *
 * Groups keep the order their first agent appears in — the tab under the
 * cursor must not move because an unrelated agent somewhere else finished.
 * Agents without a repo path collect into a single trailing group.
 */
export function groupAgentTabs(agents: AgentInfo[]): AgentTabGroup[] {
  const byRepo = new Map<string, AgentInfo[]>();
  const ungrouped: AgentInfo[] = [];

  for (const agent of agents) {
    if (!agent.repoPath) {
      ungrouped.push(agent);
      continue;
    }
    const existing = byRepo.get(agent.repoPath);
    if (existing) existing.push(agent);
    else byRepo.set(agent.repoPath, [agent]);
  }

  const paths = [...byRepo.keys()];
  const labels = shortestDistinctLabels(paths);
  const groups: AgentTabGroup[] = paths.map((repoPath, i) => ({
    repoPath,
    label: labels[i],
    agents: byRepo.get(repoPath) ?? [],
  }));

  if (ungrouped.length > 0) {
    groups.push({ repoPath: null, label: UNGROUPED_REPO_KEY, agents: ungrouped });
  }

  return groups;
}
