export interface Blueprint {
  id: string;
  name: string;
  techStack: string;
  goal: string;
  complexity: 'EASY' | 'MEDIUM' | 'HARD';
  category: 'architectures' | 'optimizations' | 'ui-and-marketing';
  description: string;
  createdAt: string;
  updatedAt: string;
}

import { invoke } from './invoke';

export interface BlueprintState {
  blueprints: Blueprint[];
}

export async function blueprintsLoad(projectPath: string): Promise<BlueprintState> {
  return await invoke<BlueprintState>('blueprints_load', { projectPath });
}

export async function blueprintsSave(projectPath: string, payload: BlueprintState): Promise<void> {
  await invoke('blueprints_save', { projectPath, payload });
}

export async function blueprintsClear(projectPath: string): Promise<void> {
  await invoke('blueprints_clear', { projectPath });
}
