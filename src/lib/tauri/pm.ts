import type {
  PmDependency,
  PmEpic,
  PmStatusHistoryEntry,
  PmTestCase,
  PmTicket,
} from '@/lib/pm/types';
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

export async function pmLoadHistory(projectPath: string): Promise<PmStatusHistoryEntry[]> {
  return await invoke<PmStatusHistoryEntry[]>('pm_load_history', { projectPath });
}
