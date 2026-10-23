import { managerRefusalCode } from '@/lib/agents/supervisorManagers';
import { supervisorWithKey } from '@/lib/agents/supervisorLaunch';
import { TERMINAL_ENTER } from '@/lib/agents/terminalKeys';
import { presentationOf, readManagerPresentations } from '@/lib/quickAccess/managerPresentation';
import { resolveAuricSkillReference } from '@/lib/settings/auricSkills';
import type { AgentInfo } from '@/lib/tauri/agents';
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
 * What a start came to. `declined` is nothing happening on purpose (the user
 * cancelled a choice, or an automatic start would have needed one); `failed`
 * has already been said in a toast.
 */
export type OpenManagerOutcome = 'opened' | 'declined' | 'failed';

interface LaunchResult {
  outcome: OpenManagerOutcome;
  /** The supervisor that is now showing, when there is one. */
  agent?: AgentInfo;
}

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
  announceInUse?: (agentName: string) => string,
  onInUse?: (agent: AgentInfo) => Promise<OpenManagerOutcome>
): Promise<LaunchResult> {
  try {
    const result = await store.spawnSupervisor(launch);
    if (result.kind === 'nothing-visible') {
      store.showToast('Allow at least one project for the supervisor first', 'info');
      hooks.onNothingVisible();
      return { outcome: 'declined' };
    }
    if (result.kind === 'cancelled') return { outcome: 'declined' };
    if (result.kind === 'run_in_use' && announceInUse) {
      store.showToast(announceInUse(result.agent.name), 'info');
    }
    if (result.kind === 'run_in_use' && onInUse) {
      const outcome = await onInUse(result.agent);
      if (outcome !== 'opened') return { outcome };
    }
    hooks.onShow(result.agent.id);
    return { outcome: 'opened', agent: result.agent };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    store.showToast(`${failure}: ${detail}`, 'error');
    return { outcome: 'failed' };
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

export interface OpenManagerOptions {
  /** Work to hand over; blank text is no task. */
  task?: string;
  /** Overrides the model stored for the manager (Settings → Supervisor → Project Managers). */
  model?: string;
  /**
   * Nobody clicked (a reminder with `launch: 'auto'`). The task is sent as
   * automatic text, which Rust refuses while the human has unsent text in that
   * terminal, and no dialog may open. Either way nothing happens and the
   * outcome is `declined`, so the reminder keeps its button.
   */
  automatic?: boolean;
}

/** What opening a manager with a task needs on top of starting one: the fleet and its stdin. */
export type ManagerStore = SupervisorStoreActions & Pick<StoreState, 'sendAgentInput' | 'agents'>;

/**
 * The task as the one message a running manager receives: `sendAgentInput`
 * wraps it in a bracketed paste when the TUI asked for that, and the Enter
 * submits it.
 */
async function sendTaskToManager(
  store: ManagerStore,
  agent: AgentInfo,
  task: string,
  automatic: boolean
): Promise<OpenManagerOutcome> {
  const text = `${task}${TERMINAL_ENTER}`;
  try {
    if (automatic) await store.sendAgentInput(agent.id, text, { automatic: true });
    else await store.sendAgentInput(agent.id, text);
    return 'opened';
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Rust's refusal of automatic text while the human types (`openManagerAction.autoDelivery`).
    if (automatic && managerRefusalCode(error) === 'human_drafting') return 'declined';
    store.showToast(`Could not send the task to ${agent.name}: ${detail}`, 'error');
    return 'failed';
  }
}

async function openManagerNow(
  store: ManagerStore,
  managerKey: string,
  hooks: OpenSupervisorHooks,
  options: OpenManagerOptions,
  startedBefore: AgentInfo | undefined
): Promise<LaunchResult> {
  const task = options.task?.trim() ?? '';
  const automatic = options.automatic === true;
  // The caller's fleet is a snapshot from before an earlier start finished.
  const live = supervisorWithKey(store.agents, managerKey) ?? startedBefore;
  if (task && live) {
    const outcome = await sendTaskToManager(store, live, task, automatic);
    if (outcome === 'opened') hooks.onShow(live.id);
    return { outcome, agent: outcome === 'opened' ? live : undefined };
  }
  if (!task && startedBefore) {
    hooks.onShow(startedBefore.id);
    return { outcome: 'opened', agent: startedBefore };
  }
  const model = options.model ?? presentationOf(readManagerPresentations(), managerKey).model;
  return await launchAndShow(
    store,
    {
      task,
      managerKey,
      ...(model ? { model } : {}),
      ...(automatic ? { automatic: true } : {}),
    },
    hooks,
    'Could not open the Project Manager',
    undefined,
    task
      ? // Started between the check and the launch: the task must not be lost.
        (agent) => sendTaskToManager(store, agent, task, automatic)
      : undefined
  );
}

/** The newest call per manager key; the next call for that key waits for it. */
const startsInFlight = new Map<string, Promise<AgentInfo | undefined>>();

/**
 * The one verb for a Project Manager, from the rail, its tile, the menu bar,
 * a reminder and Ask: its live supervisor comes forward, otherwise its folder
 * is resumed under its key. A manager has exactly one instance, so unlike a
 * skill this never starts another.
 *
 * With a task, a running manager gets it as a message and a stopped one is
 * resumed with it as its first task, so "Ask" means the same on either.
 *
 * Calls for one key run one after the other, whichever door they came through:
 * a second call waits for the start in flight and then finds the manager
 * running, so two Opens start one supervisor and an Ask during a start is
 * delivered after it.
 */
export function openManager(
  store: ManagerStore,
  managerKey: string,
  hooks: OpenSupervisorHooks,
  options: OpenManagerOptions = {}
): Promise<OpenManagerOutcome> {
  const previous = startsInFlight.get(managerKey);
  const mine = (async () => {
    const startedBefore = previous ? await previous : undefined;
    return await openManagerNow(store, managerKey, hooks, options, startedBefore);
  })();
  const tracked = mine.then(
    (result) => result.agent,
    () => undefined
  );
  startsInFlight.set(managerKey, tracked);
  return mine
    .then((result) => result.outcome)
    .finally(() => {
      if (startsInFlight.get(managerKey) === tracked) startsInFlight.delete(managerKey);
    });
}
