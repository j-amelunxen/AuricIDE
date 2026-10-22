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

interface OpenSupervisorOptions {
  /** Start a new supervisor even without a skill, rather than open the running one. */
  forceNew?: boolean;
}

/**
 * The one way a skill becomes a supervisor run: always a new supervisor with
 * the skill as its first task. Without a skill the newest running supervisor
 * comes forward, unless `forceNew` asks for another. The tile, its wheel, its
 * menu and the menu bar all go through here, so the same skill cannot start
 * differently depending on where it was clicked.
 */
export async function openSupervisor(
  store: Pick<StoreState, 'spawnSupervisor' | 'showToast'>,
  skill: QuickAccessSkill | undefined,
  hooks: OpenSupervisorHooks,
  options: OpenSupervisorOptions = {}
): Promise<void> {
  const resolved = skill ? resolveAuricSkillReference(skill) : undefined;
  const launch: SupervisorSkillLaunch | undefined = resolved
    ? { task: resolved.prompt, model: resolved.model }
    : options.forceNew
      ? { task: '', forceNew: true }
      : undefined;
  try {
    const result = await store.spawnSupervisor(launch);
    if (result.kind === 'nothing-visible') {
      store.showToast('Allow at least one project for the supervisor first', 'info');
      hooks.onNothingVisible();
      return;
    }
    if (result.kind === 'cancelled') {
      return;
    }
    hooks.onShow(result.agent.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.showToast(`Could not start the supervisor: ${detail}`, 'error');
  }
}

type SupervisorStoreActions = Pick<StoreState, 'spawnSupervisor' | 'showToast'>;

/**
 * Starts (or finds) the supervisor for a launch and shows it. `run_in_use` is
 * the folder's live supervisor: shown, and announced only when `announceInUse`
 * says how.
 */
async function launchAndShow(
  store: SupervisorStoreActions,
  launch: SupervisorSkillLaunch,
  hooks: OpenSupervisorHooks,
  failure: string,
  announceInUse?: (agentName: string) => string
): Promise<void> {
  try {
    const result = await store.spawnSupervisor(launch);
    if (result.kind === 'nothing-visible') {
      store.showToast('Allow at least one project for the supervisor first', 'info');
      hooks.onNothingVisible();
      return;
    }
    if (result.kind === 'cancelled') return;
    if (result.kind === 'run_in_use' && announceInUse) {
      store.showToast(announceInUse(result.agent.name), 'info');
    }
    hooks.onShow(result.agent.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.showToast(`${failure}: ${detail}`, 'error');
  }
}

/**
 * A new supervisor in an earlier run's folder (the tile's "Resume" entries
 * and the runs browser), whatever else runs. Only a run folder that a live
 * supervisor already works in is refused: that one is brought forward.
 */
export async function resumeSupervisor(
  store: SupervisorStoreActions,
  runDir: string,
  hooks: OpenSupervisorHooks
): Promise<void> {
  await launchAndShow(
    store,
    { task: '', resumeRunDir: runDir },
    hooks,
    'Could not resume the supervisor',
    (name) => `This run is already open in "${name}".`
  );
}

/**
 * The one verb for a Project Manager, from the rail, its tile, the menu bar
 * and Settings: its live supervisor comes forward, otherwise its folder is
 * resumed under its key. A manager has exactly one instance, so unlike a
 * skill this never starts another.
 */
export async function openManager(
  store: SupervisorStoreActions,
  managerKey: string,
  hooks: OpenSupervisorHooks
): Promise<void> {
  await launchAndShow(store, { task: '', managerKey }, hooks, 'Could not open the Project Manager');
}
