export interface AgentInfo {
  id: string;
  name: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  model: string;
  provider: string;
  currentTask?: string;
  startedAt: number;
  lastActivityAt?: number;
  repoPath?: string;
  spawnedByTicketId?: string;
}

export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'plan' | 'default';

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

export async function killAgentsForRepo(repoPath: string): Promise<number> {
  return await invoke<number>('kill_agents_for_repo', { repoPath });
}

export async function sendToAgent(agentId: string, message: string): Promise<void> {
  // Wir nutzen hier denselben Mechanismus wie beim Terminal,
  // um Daten an den Stdin des Agenten-Prozesses zu senden.
  await invoke('shell_write', { id: `agent-${agentId}`, data: message });
}
