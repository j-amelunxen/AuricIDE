const MAX_DISPLAY_NAME = 56;

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_DISPLAY_NAME
    ? `${normalized.slice(0, MAX_DISPLAY_NAME - 1).trimEnd()}…`
    : normalized;
}

function isOpaqueName(name: string): boolean {
  const normalized = name.trim();
  return (
    !normalized || /^(?:\.{3}|…|\/(?:\.{3}|…)?)$/.test(normalized) || /^\/\S+\/\S+/.test(normalized)
  );
}

export interface AgentDisplayIdentity {
  displayName: string;
  taskSummary?: string;
}

/** Builds the scan label and the one non-redundant context line for an agent. */
export function agentDisplayIdentity(name: string, currentTask?: string): AgentDisplayIdentity {
  if (!isOpaqueName(name)) return { displayName: name, taskSummary: currentTask };

  const task = currentTask?.trim();
  if (!task) return { displayName: name };

  const goal = task.match(/#\s*Goal:\s*([^\r\n]+)/i)?.[1];
  if (goal) {
    return {
      displayName: compact(goal.replace(/\s*\(goalId(?::|\b)[^)]*\)\s*$/i, '')),
    };
  }

  const meaningful = task
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('/') && !/^#+(?:\s|$)/.test(line));

  return {
    displayName: meaningful ? compact(meaningful) : name,
    taskSummary: meaningful === task ? undefined : meaningful,
  };
}

/** Turns generated path-like identities into a label a person can scan. */
export function agentDisplayName(name: string, currentTask?: string): string {
  return agentDisplayIdentity(name, currentTask).displayName;
}
