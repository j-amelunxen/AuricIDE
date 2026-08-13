import type { SpawnPreset } from '@/lib/agents/spawnDefaults';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';

/**
 * The one path into the spawn dialog. Everything a previous entry point may
 * have left behind is cleared explicitly — a skill launched in repo B must
 * not inherit repo A's ticket, goal or preset.
 */
export function openSkillSpawnDialog(
  store: {
    setSpawnAgentTicketId: (id: null) => void;
    setSpawnAgentGoalId: (id: null) => void;
    setInitialAgentTask: (task: string) => void;
    setSpawnAgentPreset: (preset: SpawnPreset | null) => void;
    setSpawnAgentRepoPath: (path: string) => void;
    setSpawnDialogOpen: (open: boolean) => void;
  },
  repoPath: string,
  skill?: Pick<QuickAccessSkill, 'prompt' | 'providerId' | 'model' | 'permissionMode'>
): void {
  store.setSpawnAgentTicketId(null);
  store.setSpawnAgentGoalId(null);
  store.setInitialAgentTask(skill?.prompt ?? '');
  store.setSpawnAgentPreset(
    skill?.providerId
      ? {
          providerId: skill.providerId,
          model: skill.model,
          permissionMode: skill.permissionMode,
        }
      : null
  );
  store.setSpawnAgentRepoPath(repoPath);
  store.setSpawnDialogOpen(true);
}
