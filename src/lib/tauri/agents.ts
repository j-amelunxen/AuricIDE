export interface AgentInfo {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  model: string;
  provider: string;
  /** The instruction the agent was started with — set once, never changes. */
  currentTask?: string;
  /**
   * What the agent is doing right now, distilled from its newest output.
   * Frontend-only: derived in the store as output streams in, so the backend
   * never sends it.
   */
  currentActivity?: string;
  /**
   * True when the newest output looks like a prompt waiting on the user
   * (permission menu, y/n question). Frontend-only, derived alongside
   * `currentActivity`.
   */
  awaitingInput?: boolean;
  startedAt: number;
  lastActivityAt?: number;
  /**
   * When the agent stopped (done or failed). Frontend-only, stamped once on
   * the first stop signal — the review list sorts by it.
   */
  finishedAt?: number;
  repoPath?: string;
  spawnedByTicketId?: string;
  spawnedByGoalId?: string;
  /** Set when this agent was spawned to REVIEW a ticket (conductor judge, agent
   * form). Frontend-only provenance, distinct from spawnedByTicketId so a
   * reviewer is never mistaken for the implementer of the ticket. */
  spawnedForReviewOfTicketId?: string;
}

export type PermissionMode =
  'bypassPermissions' | 'acceptEdits' | 'plan' | 'auto' | 'default' | 'yolo';

import { invoke } from './invoke';

export interface AgentConfig {
  name: string;
  model: string;
  task: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  dangerouslyIgnorePermissions?: boolean;
  autoAcceptEdits?: boolean;
  provider?: string;
  headless?: boolean;
  spawnedByTicketId?: string;
  spawnedByGoalId?: string;
  /** Frontend-only provenance hint for goal runs; ignored by the Rust backend. */
  runSource?: 'ui' | 'conductor';
  /**
   * What to remember in the project's prompt history instead of `task`.
   * Frontend-only. A combo step's task carries the previous session's output
   * appended to it; recall is a list of things a person typed, and a terminal
   * tail in there would bury every real entry.
   */
  historyPrompt?: string;
  /** Frontend-only: the ticket this agent was spawned to review. */
  spawnedForReviewOfTicketId?: string;
  /**
   * Frontend-only: create a linked git worktree and run the agent there.
   * Consumed by `spawnNewAgent` before the Rust spawn — the backend never
   * sees this flag.
   */
  useWorktree?: boolean;
  /**
   * Frontend-only: git repo to create the worktree from when `cwd` itself is
   * not a repository (a workspace with nested checkouts or submodules).
   */
  worktreeRepoPath?: string;
}

/** One remembered agent start prompt in the per-project history (capped at 100). */
export interface AgentPromptHistoryEntry {
  id: string;
  prompt: string;
  agentName: string;
  model: string;
  provider: string;
  cwd?: string | null;
  source: string;
  createdAt?: string;
}

export async function recordAgentPromptHistory(
  projectPath: string,
  entry: AgentPromptHistoryEntry
): Promise<void> {
  await invoke('agent_prompt_history_add', { projectPath, entry });
}

export async function listAgentPromptHistory(
  projectPath: string,
  limit?: number
): Promise<AgentPromptHistoryEntry[]> {
  return await invoke<AgentPromptHistoryEntry[]>('agent_prompt_history_list', {
    projectPath,
    limit: limit ?? null,
  });
}

export async function checkCliStatus(providerId?: string): Promise<boolean> {
  return await invoke<boolean>('check_cli_status', { providerId: providerId ?? null });
}

export async function listAgents(): Promise<AgentInfo[]> {
  return await invoke<AgentInfo[]>('list_agents');
}

export async function spawnAgent(config: AgentConfig): Promise<AgentInfo> {
  return await invoke<AgentInfo>('spawn_agent', { config });
}

export async function killAgent(agentId: string): Promise<void> {
  await invoke('kill_agent', { agentId });
}

/** Gives a running agent a human-chosen name; survives a restart-and-resume. */
export async function renameAgent(agentId: string, name: string): Promise<AgentInfo> {
  return await invoke<AgentInfo>('rename_agent', { agentId, name });
}

export async function killAgentsForRepo(repoPath: string): Promise<number> {
  return await invoke<number>('kill_agents_for_repo', { repoPath });
}

/** An agent that was running when the app last quit — its process died with
 * the app, but its spawn config survived and it can be resumed or discarded. */
export interface InterruptedAgent {
  id: string;
  name: string;
  model: string;
  provider: string;
  task: string;
  cwd?: string | null;
  permissionMode?: string | null;
  dangerouslyIgnorePermissions: boolean;
  autoAcceptEdits: boolean;
  headless: boolean;
  startedAt: number;
  spawnedByTicketId?: string | null;
  spawnedByGoalId?: string | null;
}

export async function listInterruptedAgents(): Promise<InterruptedAgent[]> {
  return await invoke<InterruptedAgent[]>('list_interrupted_agents');
}

/** Re-spawns an interrupted agent with a continuation task and returns the new agent. */
export async function resumeInterruptedAgent(agentId: string): Promise<AgentInfo> {
  return await invoke<AgentInfo>('resume_interrupted_agent', { agentId });
}

export async function discardInterruptedAgent(agentId: string): Promise<void> {
  await invoke('discard_interrupted_agent', { agentId });
}

export async function sendToAgent(agentId: string, message: string): Promise<void> {
  // Wir nutzen hier denselben Mechanismus wie beim Terminal,
  // um Daten an den Stdin des Agenten-Prozesses zu senden.
  await invoke('shell_write', { id: `agent-${agentId}`, data: message });
}
