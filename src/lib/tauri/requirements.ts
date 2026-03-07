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
  lastVerifiedAt: string | null;
  appliesTo: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmRequirementTestLink {
  id: string;
  requirementId: string;
  testCaseId: string;
  createdAt: string;
}

import { invoke } from './invoke';

export interface RequirementsState {
  requirements: PmRequirement[];
  testLinks: PmRequirementTestLink[];
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
