import type { AgentInfo } from '../tauri/agents';
import { UNGROUPED_REPO_KEY } from '../store/agentSlice';
import { supervisorFamilyRoots } from './supervisorFamily';

/**
 * One repository's — or one supervisor family's — worth of agent tabs, with
 * the name to print above them.
 */
export interface AgentTabGroup {
  /** Stable identity: the repo path, `UNGROUPED_REPO_KEY`, or `supervisor:<id>`. */
  key: string;
  /**
   * The repository these agents run in, or null when they carry no path or
   * the group is a supervisor family (which spans repositories).
   */
  repoPath: string | null;
  /** The family's supervisor, or null for a repository group. */
  supervisorId: string | null;
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

export interface GroupAgentTabsOptions {
  /** Group supervisor families together (default). False groups by repository only. */
  families?: boolean;
}

/**
 * Splits a fleet into one group per repository, so a strip of tabs from four
 * projects reads as four projects instead of one undifferentiated row.
 *
 * A supervisor and everything it started (`supervisorFamilyRoots`) form one
 * group instead, whatever repository each runs in: supervisor first, then its
 * descendants in list order, labelled with the supervisor's key or name.
 *
 * Groups keep the order their first agent appears in — the tab under the
 * cursor must not move because an unrelated agent somewhere else finished.
 * Agents without a repo path collect into a single trailing group.
 */
export function groupAgentTabs(
  agents: AgentInfo[],
  options: GroupAgentTabsOptions = {}
): AgentTabGroup[] {
  const roots =
    options.families === false ? new Map<string, string>() : supervisorFamilyRoots(agents);
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  // Insertion order is the order of first appearance, families and repos alike.
  const buckets = new Map<string, AgentInfo[]>();
  const repoPaths: string[] = [];
  const ungrouped: AgentInfo[] = [];

  for (const agent of agents) {
    const rootId = roots.get(agent.id);
    const key = rootId ? `supervisor:${rootId}` : agent.repoPath;
    if (!key) {
      ungrouped.push(agent);
      continue;
    }
    const existing = buckets.get(key);
    if (existing) existing.push(agent);
    else {
      buckets.set(key, [agent]);
      if (!rootId) repoPaths.push(key);
    }
  }

  const repoLabels = new Map(
    shortestDistinctLabels(repoPaths).map((label, i) => [repoPaths[i], label])
  );
  const groups: AgentTabGroup[] = [...buckets].map(([key, members]) => {
    const rootId = roots.get(members[0].id);
    if (!rootId) {
      return {
        key,
        repoPath: key,
        supervisorId: null,
        label: repoLabels.get(key) ?? key,
        agents: members,
      };
    }
    const supervisor = byId.get(rootId);
    return {
      key,
      repoPath: null,
      supervisorId: rootId,
      label: supervisor?.supervisorKey || supervisor?.name || rootId,
      agents: [
        ...members.filter((agent) => agent.id === rootId),
        ...members.filter((agent) => agent.id !== rootId),
      ],
    };
  });

  if (ungrouped.length > 0) {
    groups.push({
      key: UNGROUPED_REPO_KEY,
      repoPath: null,
      supervisorId: null,
      label: UNGROUPED_REPO_KEY,
      agents: ungrouped,
    });
  }

  return groups;
}
