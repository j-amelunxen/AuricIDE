import type { AgentConfig } from '@/lib/tauri/agents';
import { deriveAgentName } from '@/lib/agents/naming';
import { loadSpawnDefaults, type SpawnPreset } from '@/lib/agents/spawnDefaults';
import type { QuickAccessCombo } from '@/lib/store/starredProjectsSlice';
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
 * Builds the launch config for a `spawn-agent` action.
 *
 * The notification supplies the task and, optionally, where to run it. Provider,
 * model and permission mode come from the last launch — the same values the
 * spawn dialog would have pre-filled — because a payload written by an agent or
 * a schedule has no business deciding how much authority the new agent gets.
 * An explicit provider or model in the action is honoured; permission mode is
 * never taken from the payload.
 */
export function buildSpawnConfig(
  action: Extract<NotificationAction, { kind: 'spawn-agent' }>,
  fallbackCwd?: string
): AgentConfig {
  const defaults = loadSpawnDefaults();
  const cwd = action.repoPath ?? fallbackCwd;

  return {
    name: deriveAgentName(action.task, cwd?.split('/').filter(Boolean).pop()),
    model: action.model ?? defaults?.model ?? FALLBACK_MODEL,
    task: action.task,
    cwd,
    provider: action.provider ?? defaults?.providerId,
    permissionMode: defaults?.permissionMode,
    headless: defaults?.headless,
    spawnedByTicketId: action.ticketId,
    spawnedByGoalId: action.goalId,
    runSource: 'ui',
  };
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
  fallbackCwd?: string
): Promise<void> {
  switch (action.kind) {
    case 'answer':
      return;
    case 'spawn-agent':
      await deps.spawnAgent(buildSpawnConfig(action, fallbackCwd));
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
          `Projektordner nicht gefunden: ${action.repoPath}`,
          'missing-project'
        );
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
          `Projektordner nicht gefunden: ${action.repoPath}`,
          'missing-project'
        );
      }
      const steps = action.steps.filter((step) => step.prompt.trim().length > 0);
      if (steps.length === 0) {
        throw new NotificationActionError('Combo hat keine gültigen Schritte', 'empty-combo');
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
