import type { AgentConfig } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { deriveAgentName } from '@/lib/agents/naming';
import { resolveSkillLaunch } from '@/lib/agents/skillLaunch';
import { loadSpawnDefaults, type SpawnPreset } from '@/lib/agents/spawnDefaults';
import type { QuickAccessCombo } from '@/lib/store/starredProjectsSlice';
import type { NotificationTrust } from './trust';
import type { NotificationAction, NotificationOpenTarget } from './types';

/**
 * The operations a notification may set off, as functions the caller supplies.
 *
 * Injected rather than reached for through the store so this module stays
 * testable without one, and so the mapping from a *data* action to a real
 * side effect is visible in one place. Everything here already exists
 * elsewhere in the app — nothing new becomes possible because a notification
 * asked for it.
 */
export interface NotificationActionDeps {
  spawnAgent: (config: AgentConfig) => Promise<unknown>;
  openSpawnDialog: (input: { task: string; repoPath: string; preset: SpawnPreset | null }) => void;
  startSkillCombo: (projectPath: string, combo: QuickAccessCombo) => Promise<void>;
  /** True only when path is an existing directory, not a file. */
  projectDirExists: (path: string) => Promise<boolean>;
  openFile: (path: string, line?: number) => void;
  openTicket: (ticketId: string) => void;
  openGoal: (goalId: string) => void;
  openAgent: (agentId: string) => void;
  runCommand: (commandId: string) => void;
}

export class NotificationActionError extends Error {
  constructor(
    message: string,
    readonly code: 'missing-project' | 'empty-combo'
  ) {
    super(message);
  }
}

/** Model of last resort when nothing has been launched on this machine yet. */
const FALLBACK_MODEL = 'sonnet';

/**
 * What the click knows beyond the action itself.
 *
 * `trust` is the important one: it says whether the payload was authored by the
 * user (a schedule they filled in) or by a running model, and therefore whether
 * the payload may decide how much authority the agent it starts gets. Defaults
 * to `foreign`, so a caller that forgets it gets the cautious behaviour.
 */
export interface NotificationActionContext {
  /** Where to run when the action names no repository of its own. */
  fallbackCwd?: string;
  trust?: NotificationTrust;
  /** The harnesses this machine offers, for resolving a skill's pins. */
  providers?: ProviderInfo[];
}

/**
 * Builds the launch config for a `spawn-agent` action.
 *
 * Provider and model may always come from the payload — they decide *what*
 * runs. The permission mode decides how much the run may do without asking, so
 * it is taken from the payload only when the user wrote it; from an agent's
 * payload it falls back to the last launch, the same value the spawn dialog
 * would have pre-filled.
 *
 * The remembered defaults are read for the working directory the agent will run
 * in, not globally — the launch choices are stored per project, and reading
 * them without the path yields whatever was last launched outside any project,
 * which is usually nothing at all.
 */
export function buildSpawnConfig(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  context: NotificationActionContext = {}
): AgentConfig {
  const cwd = action.repoPath ?? context.fallbackCwd;
  const defaults = loadSpawnDefaults(cwd) ?? loadSpawnDefaults();
  const trusted = context.trust === 'user';

  return {
    name: deriveAgentName(action.task, cwd?.split('/').filter(Boolean).pop()),
    model: action.model ?? defaults?.model ?? FALLBACK_MODEL,
    task: action.task,
    cwd,
    provider: action.provider ?? defaults?.providerId,
    permissionMode: (trusted ? action.permissionMode : undefined) ?? defaults?.permissionMode,
    headless: defaults?.headless,
    spawnedByTicketId: action.ticketId,
    spawnedByGoalId: action.goalId,
    runSource: 'ui',
  };
}

/**
 * Builds the launch config for a `run-skill` action that starts without the
 * dialog. The skill's own pins decide provider, model and permission mode —
 * they are the same values Quick Access would have used, resolved through the
 * one helper every direct skill launch shares.
 */
export function buildSkillSpawnConfig(
  action: Extract<NotificationAction, { kind: 'run-skill' }>,
  providers: ProviderInfo[]
): AgentConfig {
  const launch = resolveSkillLaunch(action, providers);
  const folder = action.repoPath.split('/').filter(Boolean).pop();

  return {
    name: action.skillLabel || deriveAgentName(action.prompt, folder),
    model: launch.model,
    task: action.prompt,
    cwd: action.repoPath,
    provider: launch.provider,
    permissionMode: launch.permissionMode,
    runSource: 'ui',
  };
}

/**
 * Whether the click starts the skill outright or fills in the spawn dialog.
 *
 * Absent means dialog, which is what every payload written before direct launch
 * existed says — an old schedule must not start behaving differently because
 * the app learned a new trick.
 */
function startsDirectly(
  action: Extract<NotificationAction, { kind: 'run-skill' }>,
  context: NotificationActionContext
): boolean {
  return action.launch === 'direct' && context.trust === 'user';
}

function openTarget(target: NotificationOpenTarget, deps: NotificationActionDeps): void {
  switch (target.type) {
    case 'file':
      deps.openFile(target.path, target.line);
      return;
    case 'ticket':
      deps.openTicket(target.ticketId);
      return;
    case 'goal':
      deps.openGoal(target.goalId);
      return;
    case 'agent':
      deps.openAgent(target.agentId);
      return;
  }
}

/**
 * Carries out one action.
 *
 * Recording the answer is *not* done here: every action on a question settles
 * it, not just an `answer` one, so the caller stamps that once around this
 * call. An `answer` action therefore has no side effect of its own — its whole
 * purpose is to be recorded, which is what a waiting agent reads back.
 */
export async function executeNotificationAction(
  action: NotificationAction,
  deps: NotificationActionDeps,
  context: NotificationActionContext = {}
): Promise<void> {
  switch (action.kind) {
    case 'answer':
      return;
    case 'spawn-agent':
      await deps.spawnAgent(buildSpawnConfig(action, context));
      return;
    case 'open':
      openTarget(action.target, deps);
      return;
    case 'command':
      deps.runCommand(action.commandId);
      return;
    case 'run-skill': {
      if (!(await deps.projectDirExists(action.repoPath))) {
        throw new NotificationActionError(
          `Project folder not found: ${action.repoPath}`,
          'missing-project'
        );
      }
      if (startsDirectly(action, context)) {
        await deps.spawnAgent(buildSkillSpawnConfig(action, context.providers ?? []));
        return;
      }
      deps.openSpawnDialog({
        task: action.prompt,
        repoPath: action.repoPath,
        preset: action.providerId
          ? {
              providerId: action.providerId,
              model: action.model,
              permissionMode: action.permissionMode,
            }
          : null,
      });
      return;
    }
    case 'run-combo': {
      if (!(await deps.projectDirExists(action.repoPath))) {
        throw new NotificationActionError(
          `Project folder not found: ${action.repoPath}`,
          'missing-project'
        );
      }
      const steps = action.steps.filter((step) => step.prompt.trim().length > 0);
      if (steps.length === 0) {
        throw new NotificationActionError('Combo has no valid steps', 'empty-combo');
      }
      await deps.startSkillCombo(action.repoPath, {
        id: action.comboId,
        label: action.comboLabel,
        steps,
      });
      return;
    }
  }
}
