import {
  quickAccessCombos,
  quickAccessSkills,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';
import type { NotificationAction } from './types';

export interface PresentedAction {
  action: NotificationAction;
  /** Why the button is disabled. Absent ⇒ enabled. */
  disabledReason?: string;
}

export type RepoDirStatus = 'unknown' | 'dir' | 'missing';

function findPinnedSkill(
  starred: StarredProject[],
  repoPath: string,
  skillId: string,
  invocation?: string
): QuickAccessSkill | undefined {
  const project = starred.find((p) => p.path === repoPath);
  if (!project) return undefined;
  const skills = quickAccessSkills(project);
  return (
    skills.find((s) => s.id === skillId) ??
    (invocation ? skills.find((s) => s.invocation === invocation) : undefined)
  );
}

function findPinnedCombo(
  starred: StarredProject[],
  repoPath: string,
  comboId: string
): QuickAccessCombo | undefined {
  const project = starred.find((p) => p.path === repoPath);
  if (!project) return undefined;
  return quickAccessCombos(project).find((c) => c.id === comboId);
}

function overlayLiveLabel(
  action: NotificationAction,
  starred: StarredProject[]
): NotificationAction {
  if (action.kind === 'run-skill') {
    const live = findPinnedSkill(starred, action.repoPath, action.skillId, action.invocation);
    if (live) return { ...action, label: `Start ${live.label}` };
  }
  if (action.kind === 'run-combo') {
    const live = findPinnedCombo(starred, action.repoPath, action.comboId);
    if (live) return { ...action, label: `Start ${live.label}` };
  }
  return action;
}

function repoPathOf(action: NotificationAction): string | undefined {
  if (action.kind === 'run-skill' || action.kind === 'run-combo') return action.repoPath;
  if (action.kind === 'spawn-agent') return action.repoPath;
  return undefined;
}

function disabledReason(
  action: NotificationAction,
  repoDirStatus: Map<string, RepoDirStatus>
): string | undefined {
  const repoPath = repoPathOf(action);
  if (repoPath !== undefined && repoDirStatus.get(repoPath) === 'missing') {
    return 'Project folder not found';
  }
  if (action.kind === 'run-combo') {
    const hasStep = action.steps.some((step) => step.prompt.trim().length > 0);
    if (!hasStep) return 'Combo has no valid steps';
  }
  return undefined;
}

export function presentNotificationActions(
  actions: NotificationAction[],
  starred: StarredProject[],
  repoDirStatus: Map<string, RepoDirStatus>
): PresentedAction[] {
  return actions.map((action) => {
    const presented: PresentedAction = { action: overlayLiveLabel(action, starred) };
    const reason = disabledReason(action, repoDirStatus);
    if (reason !== undefined) presented.disabledReason = reason;
    return presented;
  });
}
