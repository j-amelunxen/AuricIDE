import type { SpawnPreset } from '@/lib/agents/spawnDefaults';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import { resolveAuricSkillReference } from '@/lib/settings/auricSkills';

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
    setSpawnAgentWorktree: (pinned: boolean | null) => void;
    setSpawnDialogOpen: (open: boolean) => void;
  },
  repoPath: string,
  skill?: Pick<
    QuickAccessSkill,
    'prompt' | 'providerId' | 'model' | 'permissionMode' | 'auricSkillId'
  > &
    Partial<Pick<QuickAccessSkill, 'label'>>
): void {
  const resolved = skill
    ? resolveAuricSkillReference({ ...skill, label: skill.label ?? '' })
    : undefined;
  store.setSpawnAgentTicketId(null);
  store.setSpawnAgentGoalId(null);
  store.setInitialAgentTask(resolved?.prompt ?? '');
  store.setSpawnAgentPreset(
    resolved?.providerId
      ? {
          providerId: resolved.providerId,
          model: resolved.model,
          permissionMode: resolved.permissionMode,
        }
      : null
  );
  // A skill is started for the repository the user is pointing at, so the
  // worktree box starts off however git-shaped that folder is — a skill run
  // against a fresh detached checkout leaves the work where nobody looks.
  // Without a skill this is a plain "start an agent here" and the box keeps
  // following the folder.
  store.setSpawnAgentWorktree(resolved ? false : null);
  store.setSpawnAgentRepoPath(repoPath);
  store.setSpawnDialogOpen(true);
}
