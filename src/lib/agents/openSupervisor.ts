import { resolveAuricSkillReference } from '@/lib/settings/auricSkills';
import type { SupervisorSkillLaunch } from '@/lib/store/agent/agentTypes';
import type { StoreState } from '@/lib/store';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';

interface OpenSupervisorHooks {
  /** Nothing is allowed in Settings → Supervisor yet; take the user there. */
  onNothingVisible: () => void;
  /** Bring the supervisor's terminal forward. */
  onShow: (agentId: string) => void;
}

/**
 * The one way a skill becomes a supervisor run: a new supervisor with the
 * skill as its first task, or a message to the one already running. The tile,
 * its wheel, its menu and the menu bar all go through here, so the same skill
 * cannot start differently depending on where it was clicked.
 */
export async function openSupervisor(
  store: Pick<StoreState, 'spawnSupervisor' | 'showToast'>,
  skill: QuickAccessSkill | undefined,
  hooks: OpenSupervisorHooks
): Promise<void> {
  const resolved = skill ? resolveAuricSkillReference(skill) : undefined;
  const launch: SupervisorSkillLaunch | undefined = resolved
    ? { task: resolved.prompt, model: resolved.model }
    : undefined;
  try {
    const result = await store.spawnSupervisor(launch);
    if (result.kind === 'nothing-visible') {
      store.showToast('Allow at least one project for the supervisor first', 'info');
      hooks.onNothingVisible();
      return;
    }
    if (result.kind === 'sent') {
      store.showToast(`Sent "${resolved?.label ?? 'skill'}" to the running supervisor`, 'success');
    }
    hooks.onShow(result.agent.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.showToast(`Could not start the supervisor: ${detail}`, 'error');
  }
}
