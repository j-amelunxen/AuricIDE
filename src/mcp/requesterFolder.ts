import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * Sub-goal 09, directory rule: an agent started through MCP runs in the
 * requesting agent's own working directory (or, only via
 * `request_agent_launch`, a fresh IDE worktree of that repository). The IDE
 * hands that folder to the MCP server it starts for the agent as
 * `AURIC_AGENT_CWD`.
 *
 * Threat model (notes 2026-09-26-09-bedrohungsmodell-und-verzeichnis.md and
 * -antwort-nach-r3.md): in scope are races, several app instances, failures,
 * and requests forged through the MCP tools. Out of scope is an agent with a
 * shell: it can write SQLite or prefs directly, and it can just as well start
 * a second MCP server process of its own with a forged `AURIC_AGENT_CWD`
 * pointing at another existing repository (review r3, blocker 1). The folder
 * read here is only as trustworthy as the process environment the IDE set;
 * binding it cryptographically to the IDE-started session is a separate topic.
 */

/**
 * The folder a request starts in: the requesting agent's own, as the IDE
 * passed it. Checked here so a bad value never reaches the inbox, and checked
 * again natively at spawn (`agents/launch_dir.rs`). `realpath === value`
 * refuses relative spellings, `..` and symlinks in one comparison.
 */
export function requestingAgentFolder(agentCwd: string | undefined): string {
  if (!agentCwd) {
    throw new Error(
      "A launch needs the requesting agent's working directory, and the IDE did not pass one " +
        '(AURIC_AGENT_CWD)'
    );
  }
  if (!isAbsolute(agentCwd)) {
    throw new Error(`The requesting agent's working directory '${agentCwd}' is not absolute`);
  }
  let real: string;
  try {
    real = realpathSync(agentCwd);
  } catch {
    throw new Error(`The requesting agent's working directory '${agentCwd}' does not exist`);
  }
  if (real !== agentCwd) {
    throw new Error(
      `The requesting agent's working directory '${agentCwd}' is not canonical (resolves to '${real}')`
    );
  }
  if (!statSync(real).isDirectory()) {
    throw new Error(`The requesting agent's working directory '${agentCwd}' is not a directory`);
  }
  return real;
}

/**
 * Mirrors `REQUESTER_PLACEMENT` in `src-tauri/src/agents/launch_dir.rs`: the
 * stamp this server puts on every agent-written spawn-agent action after it
 * checked the folder. The native spawn refuses an agent-written Start button
 * without it, so a row written before the rule (or by anything else) starts
 * nowhere.
 */
export const REQUESTER_PLACEMENT = 'requester';

interface SpawnActionInput {
  kind: string;
  repoPath?: string;
}

/**
 * Places every spawn-agent action an agent writes (`notify`,
 * `schedule_create`) in the requesting agent's own folder. A named folder
 * must be exactly that folder; anything else is refused before a row exists.
 * Worktrees are not offered here: `request_agent_launch` is the path for
 * those, with its own native check.
 */
export function placeSpawnActions<T extends SpawnActionInput>(
  actions: T[] | undefined,
  agentCwd: string | undefined
): T[] | undefined {
  if (!actions?.some((action) => action.kind === 'spawn-agent')) return actions;
  const folder = requestingAgentFolder(agentCwd);
  return actions.map((action) => {
    if (action.kind !== 'spawn-agent') return action;
    if (action.repoPath !== undefined && action.repoPath !== folder) {
      throw new Error(
        `A Start button may only start in your own working directory '${folder}', not ` +
          `'${action.repoPath}'. Leave repoPath out; for a fresh worktree use request_agent_launch.`
      );
    }
    return { ...action, repoPath: folder, placement: REQUESTER_PLACEMENT };
  });
}
