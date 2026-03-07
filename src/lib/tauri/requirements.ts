export interface PmRequirement {
  id: string;
  reqId: string;
  title: string;
  description: string;
  type: 'functional' | 'non_functional';
  category: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'draft' | 'active' | 'implemented' | 'verified' | 'deprecated';
  rationale: string;
  acceptanceCriteria: string;
  source: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

import { invoke } from './invoke';

export interface RequirementsState {
  requirements: PmRequirement[];
}

export async function requirementsLoad(projectPath: string): Promise<RequirementsState> {
  return await invoke<RequirementsState>('requirements_load', { projectPath });
}

export async function requirementsSave(
  projectPath: string,
  payload: RequirementsState
): Promise<void> {
  await invoke('requirements_save', { projectPath, payload });
}

export async function requirementsClear(projectPath: string): Promise<void> {
  await invoke('requirements_clear', { projectPath });
}
