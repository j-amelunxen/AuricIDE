import type { AgentConfig, AgentInfo } from '../agents/types';
import { TERMINAL_ENTER } from '../agents/terminalKeys';
import { invoke } from './invoke';

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

/**
 * Drops the kept results of a supervisor's children once its card is cleared;
 * until then they stay readable even after the supervisor ended. Returns how
 * many were dropped.
 */
export async function forgetSupervisorRunResults(supervisorId: string): Promise<number> {
  return await invoke<number>('agent_run_results_forget', { supervisorId });
}

/** An agent that was running when the app last quit — its process died with
 * the app, but its spawn config survived and it can be resumed or discarded. */
export interface InterruptedAgent {
  id: string;
  name: string;
  model: string;
  provider: string;
  task: string;
  projectPath?: string | null;
  cwd?: string | null;
  permissionMode?: string | null;
  dangerouslyIgnorePermissions: boolean;
  autoAcceptEdits: boolean;
  headless: boolean;
  startedAt: number;
  spawnedByTicketId?: string | null;
  spawnedByGoalId?: string | null;
  /** The launch request it served; a resume keeps reporting to it. */
  launchRequestUid?: string | null;
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

/**
 * A message typed into an agent, optionally ending in `TERMINAL_ENTER`. Rust
 * (`agents/terminal_input.rs`) writes it the way the control socket does:
 * long or multi-line text as one bracketed paste, so the TUI neither swallows
 * the Enter nor cuts the text. Raw keystrokes from a terminal view go to the
 * PTY as they are (`writeToShell`, AgentXterm).
 */
export async function sendMessageToAgent(
  agentId: string,
  message: string,
  options: { automatic?: boolean } = {}
): Promise<void> {
  const enter = message.endsWith(TERMINAL_ENTER);
  const text = enter ? message.slice(0, -TERMINAL_ENTER.length) : message;
  // `automatic`: nobody typed this (a reminder). Rust refuses it with `human_drafting`
  // while the human has unsent text in that terminal, and does not book it as theirs.
  await invoke('agent_send_message', {
    agentId,
    text,
    enter,
    ...(options.automatic ? { automatic: true } : {}),
  });
}
