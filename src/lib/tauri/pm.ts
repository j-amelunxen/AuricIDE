export interface PmEpic {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmContextItem {
  id: string;
  type: 'snippet' | 'file';
  value: string;
}

export interface PmTicket {
  id: string;
  epicId: string;
  name: string;
  description: string;
  status: 'open' | 'in_progress' | 'done' | 'archived';
  statusUpdatedAt: string;
  sortOrder: number;
  workingDirectory?: string;
  context?: PmContextItem[];
  modelPower?: 'low' | 'medium' | 'high';
  priority: 'low' | 'normal' | 'high' | 'critical';
  needsHumanSupervision?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PmTestCase {
  id: string;
  ticketId: string;
  title: string;
  body: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmDependency {
  id: string;
  sourceType: 'epic' | 'ticket';
  sourceId: string;
  targetType: 'epic' | 'ticket';
  targetId: string;
}

import { invoke } from './invoke';

export interface PmState {
  epics: PmEpic[];
  tickets: PmTicket[];
  testCases: PmTestCase[];
  dependencies: PmDependency[];
}

export async function pmLoad(projectPath: string): Promise<PmState> {
  return await invoke<PmState>('pm_load', { projectPath });
}

export async function pmSave(projectPath: string, payload: PmState): Promise<void> {
  await invoke('pm_save', { projectPath, payload });
}

export async function pmClear(projectPath: string): Promise<void> {
  await invoke('pm_clear', { projectPath });
}

export interface PmStatusHistoryEntry {
  id: string;
  ticketId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  source: string;
}

export async function pmLoadHistory(projectPath: string): Promise<PmStatusHistoryEntry[]> {
  return await invoke<PmStatusHistoryEntry[]>('pm_load_history', { projectPath });
}
