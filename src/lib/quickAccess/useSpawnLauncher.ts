'use client';

import { useStore } from '@/lib/store';
import { openSkillSpawnDialog } from './launchSkill';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';

/**
 * Opens the spawn dialog for a repo, optionally seeded from a skill.
 *
 * `openSkillSpawnDialog` needs seven store setters gathered into one object —
 * boilerplate that Quick Access and the Agent Console both need to launch a
 * skill the same way. Sharing this hook, rather than each entry point
 * re-selecting the six setters itself, is what keeps "start an agent from
 * here" behaving identically everywhere it appears.
 */
export function useSpawnLauncher() {
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);
  const setSpawnAgentGoalId = useStore((s) => s.setSpawnAgentGoalId);
  const setInitialAgentTask = useStore((s) => s.setInitialAgentTask);
  const setSpawnAgentPreset = useStore((s) => s.setSpawnAgentPreset);
  const setSpawnAgentRepoPath = useStore((s) => s.setSpawnAgentRepoPath);
  const setSpawnAgentWorktree = useStore((s) => s.setSpawnAgentWorktree);
  const setSpawnDialogOpen = useStore((s) => s.setSpawnDialogOpen);

  return (
    repoPath: string,
    skill?: Pick<
      QuickAccessSkill,
      'prompt' | 'providerId' | 'model' | 'permissionMode' | 'auricSkillId'
    > &
      Partial<Pick<QuickAccessSkill, 'label'>>
  ) =>
    openSkillSpawnDialog(
      {
        setSpawnAgentTicketId,
        setSpawnAgentGoalId,
        setInitialAgentTask,
        setSpawnAgentPreset,
        setSpawnAgentRepoPath,
        setSpawnAgentWorktree,
        setSpawnDialogOpen,
      },
      repoPath,
      skill
    );
}
