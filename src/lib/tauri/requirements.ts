import type { PmRequirement, PmRequirementTestLink } from '@/lib/pm/types';
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
