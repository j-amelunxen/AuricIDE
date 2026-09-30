import type { AgentConfig } from '@/lib/tauri/agents';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { deriveAgentName } from '@/lib/agents/naming';
import { resolveSkillLaunch } from '@/lib/agents/skillLaunch';
import { runKindFor } from '@/lib/agents/spawnTargets';
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
  /**
   * Opens (or switches to) `repoPath` if needed and starts — or pre-fills —
   * a conductor run there. The project switch, the load wait and the actual
   * `startConductor` call are the caller's concern; this module only decides
   * *whether* the run may start on the click (`mode: 'direct'`) or must stop
   * at the panel for a human to press Start (`mode: 'dialog'`).
   */
  startConductorRun: (input: {
    repoPath: string;
    ticketBudget: number;
    maxConcurrent: number;
    goalId?: string;
    requireReview: boolean;
    judgeForm?: 'llm' | 'agent';
    judgeProviderId?: string;
    judgeModel?: string;
    mode: 'direct' | 'dialog';
    origin?: string;
  }) => Promise<void>;
}

export class NotificationActionError extends Error {
  constructor(
    message: string,
    readonly code: 'missing-project' | 'empty-combo' | 'provider-model'
  ) {
    super(message);
  }
}

/** Model of last resort when nothing has been launched on this machine yet. */
const FALLBACK_MODEL = 'sonnet';

/**
 * Provider, model and permission mode as one pair. A model name and a
 * permission mode only mean something inside the harness they were chosen
 * for, so the remembered ones (the last launch) come along only when they
 * belong to the provider that will run; otherwise that provider's own
 * defaults apply.
 *
 * The final pair is then checked against what the chosen provider offers:
 * a remembered model it does not offer (a stale or inconsistent preference)
 * gives way to its default model; a model the payload names is refused. A
 * named provider whose default model is not known here is refused too:
 * guessing would start it with some other harness's model. Only a provider
 * that lists no models at all leaves the name unchecked.
 */
function pairedLaunch(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  remembered: ReturnType<typeof loadSpawnDefaults>,
  providers: ProviderInfo[] | undefined
): { provider?: string; model: string; permissionMode?: string } {
  const provider = action.provider ?? remembered?.providerId;
  const own = remembered && (!action.provider || action.provider === remembered.providerId);
  const info = providers?.find((entry) => entry.id === provider);
  const offered = (model: string | undefined) =>
    model !== undefined && (!info?.models.length || info.models.some((m) => m.value === model));
  const refuse = (message: string) => new NotificationActionError(message, 'provider-model');

  if (action.model && info && !offered(action.model)) {
    throw refuse(`Provider '${provider}' does not offer model '${action.model}'`);
  }
  if (action.model && provider && providers && !info) {
    const elsewhere = providers.some((entry) => entry.models.some((m) => m.value === action.model));
    if (elsewhere) throw refuse(`Model '${action.model}' belongs to another provider`);
  }
  const rememberedModel = own ? remembered?.model : undefined;
  const model =
    action.model ??
    (info && !offered(rememberedModel) ? undefined : rememberedModel) ??
    info?.defaultModel ??
    (provider ? undefined : FALLBACK_MODEL);
  if (!model) {
    throw refuse(
      `No model is known for provider '${provider}'; name one or start it from the dialog`
    );
  }
  const permissionMode = own ? remembered?.permissionMode : info?.defaultPermissionMode;
  return { provider, model, permissionMode };
}

/** The instruction, plus the reminder's Note when there is one. */
function taskWithNote(task: string, note: string | null | undefined): string {
  const extra = note?.trim();
  if (!extra) return task;
  return `${task}\n\n${extra}`;
}

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
  /** Schedule or notification origin name, carried into the decision log. */
  origin?: string;
  /** Set when the notification is an MCP launch request; see `launchRequest.ts`. */
  launchRequestUid?: string;
  /**
   * The project an agent-written button belongs to (the notification's
   * `projectPath`, the requesting agent's MCP project). Required for a launch
   * request and for every other agent-written Start button: the stored folder
   * may be a worktree without its own `.auric/project.db`, so the binding can
   * never be derived from it.
   */
  launchProjectPath?: string;
  /**
   * The notification the clicked action sits on. Required for a Start button
   * a model wrote: the native spawn re-reads that row and refuses any folder
   * but the one the MCP server checked and stamped on it.
   */
  notificationUid?: string;
}

/**
 * Where a launch request runs and which project it is bound to. The folder is
 * the one stored with the request (the requesting agent's own); there is no
 * fallback to the open project, and the Rust spawn checks it once more
 * (`agents/launch_dir.rs`).
 */
function launchRequestPlacement(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  context: NotificationActionContext
): { cwd: string; projectPath: string } {
  if (!action.repoPath) {
    throw new Error('This launch request stored no folder to start in');
  }
  if (!context.launchProjectPath) {
    throw new Error('This launch request names no project to bind the agent to');
  }
  return { cwd: action.repoPath, projectPath: context.launchProjectPath };
}

/**
 * Where an agent-written Start button (notify, an agent's schedule) runs.
 * Sub-goal 09, blocker 2 of review r3: the same directory rule as a launch
 * request. The folder is the one stored on the row, never the open project,
 * and the config names the row and action so the Rust spawn checks the folder
 * against the MCP server's stamp (`check_agent_notification_directory`).
 */
function agentButtonPlacement(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  context: NotificationActionContext
): { cwd: string; projectPath: string; notificationUid: string } {
  if (!context.notificationUid) {
    throw new Error('This Start button was written by an agent and cannot be checked here');
  }
  if (!action.repoPath) {
    throw new Error('This Start button stored no folder to start in');
  }
  if (!context.launchProjectPath) {
    throw new Error('This Start button names no project to bind the agent to');
  }
  return {
    cwd: action.repoPath,
    projectPath: context.launchProjectPath,
    notificationUid: context.notificationUid,
  };
}

function checkedPlacement(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  context: NotificationActionContext
) {
  if (context.launchRequestUid) {
    return { ...launchRequestPlacement(action, context), notificationUid: null };
  }
  if (context.trust !== 'user') return agentButtonPlacement(action, context);
  return null;
}

/**
 * Who the run is recorded as started by. Only a person's own reminder is a
 * schedule run; anything a model wrote, or a launch request it filed, is an
 * mcp run — the usage row should say which of the two spent the money.
 */
function runSourceFor(
  context: NotificationActionContext,
  placement: { notificationUid: string | null } | null
): NonNullable<AgentConfig['runSource']> {
  if (context.launchRequestUid || placement?.notificationUid) return 'mcp';
  return context.trust === 'user' ? 'schedule' : 'mcp';
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
 *
 * A trusted reminder's Note (`action.note`) is folded into `task` here, not
 * baked into the stored task, so re-editing the form does not show the same
 * text twice. The notification body is not the source: catch-up rewrites that
 * field, and an agent's display copy must not become a second prompt channel.
 */
export function buildSpawnConfig(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  context: NotificationActionContext = {}
): AgentConfig {
  const placement = checkedPlacement(action, context);
  const cwd = placement ? placement.cwd : (action.repoPath ?? context.fallbackCwd);
  // An agent-written button may not make a worktree: the native check accepts
  // only the stamped folder itself. Launch requests have their own rule.
  const worktree = action.useWorktree && cwd && !placement?.notificationUid;
  const defaults = loadSpawnDefaults(cwd) ?? loadSpawnDefaults();
  const trusted = context.trust === 'user';
  const pair = pairedLaunch(action, defaults, context.providers);

  return {
    name: deriveAgentName(action.task, cwd?.split('/').filter(Boolean).pop()),
    model: pair.model,
    task: trusted ? taskWithNote(action.task, action.note) : action.task,
    projectPath: placement ? placement.projectPath : (cwd ?? null),
    cwd,
    provider: pair.provider,
    permissionMode:
      (trusted ? action.permissionMode : undefined) ??
      (pair.permissionMode as AgentConfig['permissionMode']),
    headless: (trusted ? action.headless : undefined) ?? defaults?.headless,
    spawnedByTicketId: action.ticketId,
    spawnedByGoalId: action.goalId,
    runKind: runKindFor({ spawnedByTicketId: action.ticketId, spawnedByGoalId: action.goalId }),
    runSource: runSourceFor(context, placement),
    ...(worktree ? { useWorktree: true, worktreeRepoPath: cwd } : {}),
    ...(context.launchRequestUid ? { launchRequestUid: context.launchRequestUid } : {}),
    ...(placement?.notificationUid
      ? {
          agentNotificationUid: placement.notificationUid,
          agentNotificationActionId: action.id,
        }
      : {}),
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
    projectPath: action.repoPath,
    cwd: action.repoPath,
    provider: launch.provider,
    permissionMode: launch.permissionMode,
    headless: action.headless,
    runKind: 'other',
    runSource: 'schedule',
  };
}

/**
 * Whether the click starts the skill outright or fills in the spawn dialog.
 *
 * `auto` reaching this function means a click already happened — the
 * unattended path in the auto-start hook calls `spawnAgent` through here
 * too — so on a click `auto` is just another way of saying `direct`. Absent
 * means dialog, which is what every payload written before direct launch
 * existed says — an old schedule must not start behaving differently because
 * the app learned a new trick.
 */
function startsDirectly(
  action: Extract<NotificationAction, { kind: 'run-skill' }>,
  context: NotificationActionContext
): boolean {
  return (action.launch === 'direct' || action.launch === 'auto') && context.trust === 'user';
}

/**
 * Whether a `run-conductor` click may start the run outright.
 *
 * `auto` reaching this function means a click already happened — the
 * unattended path in `scheduledRun.ts` calls `startConductor` directly and
 * never goes through here — so on a click `auto` is just another way of
 * saying `direct`. Only a user-authored payload may skip the panel; from a
 * model the same payload still offers the button, it just always stops there.
 */
function conductorLaunchMode(
  action: Extract<NotificationAction, { kind: 'run-conductor' }>,
  context: NotificationActionContext
): 'direct' | 'dialog' {
  if (context.trust !== 'user') return 'dialog';
  return action.launch === 'direct' || action.launch === 'auto' ? 'direct' : 'dialog';
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
    case 'run-conductor': {
      if (!(await deps.projectDirExists(action.repoPath))) {
        throw new NotificationActionError(
          `Project folder not found: ${action.repoPath}`,
          'missing-project'
        );
      }
      await deps.startConductorRun({
        repoPath: action.repoPath,
        ticketBudget: action.ticketBudget,
        maxConcurrent: action.maxConcurrent ?? 1,
        goalId: action.goalId,
        requireReview: action.requireReview ?? false,
        // Passed through as-is, absences included: a schedule that names no
        // judge leaves the project's own choice standing.
        judgeForm: action.judgeForm,
        judgeProviderId: action.judgeProviderId,
        judgeModel: action.judgeModel,
        mode: conductorLaunchMode(action, context),
        origin: context.origin,
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
