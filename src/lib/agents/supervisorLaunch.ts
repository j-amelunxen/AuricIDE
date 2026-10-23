import type { ProviderPolicy } from '@/lib/config/providerPolicy';
import {
  permissionModesOf,
  supervisorPmServers,
  visibleProjects,
  type OfferedModels,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import { projectProviderPolicyGet } from '@/lib/tauri/providerPolicy';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { ManagerMemorySummary, SupervisorManager } from '@/lib/tauri/supervisorManagers';
import { isFinishedAgent } from './fleet';
import {
  buildSupervisorLaunchPrompt,
  supervisorPromptProjects,
  supervisorPromptSkills,
} from './supervisorLaunchPrompt';
import { layoutRulesRunWithoutOkf } from './supervisorManagers';

/**
 * Every supervisor that still runs, newest first: by start time, a tie going
 * to the one listed later. Several may run side by side, each over its own
 * children.
 */
export function runningSupervisors(agents: AgentInfo[]): AgentInfo[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .filter(({ agent }) => agent.role === 'supervisor' && !isFinishedAgent(agent))
    .sort((a, b) => b.agent.startedAt - a.agent.startedAt || b.index - a.index)
    .map(({ agent }) => agent);
}

/** The one a plain click on the tile brings forward instead of starting another. */
export function newestRunningSupervisor(agents: AgentInfo[]): AgentInfo | undefined {
  return runningSupervisors(agents)[0];
}

/** The live supervisor running under this key; a Project Manager always does. */
export function supervisorWithKey(agents: AgentInfo[], key: string): AgentInfo | undefined {
  return runningSupervisors(agents).find((agent) => agent.supervisorKey === key);
}

const withoutTrailingSlash = (path: string) => path.replace(/\/+$/, '');

/**
 * The live supervisor already working in this run folder (its cwd is the
 * folder). A run folder holds one supervisor at a time; Rust refuses a second
 * with `run_dir_in_use`, this only says so before asking.
 */
export function supervisorUsingRunDir(agents: AgentInfo[], runDir: string): AgentInfo | undefined {
  const wanted = withoutTrailingSlash(runDir);
  return runningSupervisors(agents).find(
    (agent) => agent.repoPath !== undefined && withoutTrailingSlash(agent.repoPath) === wanted
  );
}

import {
  readSupervisorInstructions,
  writeSupervisorInstructions,
  readAllSupervisorInstructions,
} from '@/lib/config/supervisorProviders';

export { readSupervisorInstructions, writeSupervisorInstructions, readAllSupervisorInstructions };

export function offeredModelsOf(providers: ProviderInfo[]): OfferedModels {
  return Object.fromEntries(providers.map((p) => [p.id, p.models.map((m) => m.value)]));
}

/**
 * A manager's own model, or undefined when its provider stopped offering it
 * (the launch then uses the supervisor default). A provider that lists no
 * models leaves the name unchecked, as the notification launch does.
 */
function modelStillOffered(model: string | undefined, provider: ProviderInfo | undefined) {
  if (!provider) return model;
  return !model
    ? undefined
    : provider.models.length === 0 || provider.models.some((m) => m.value === model)
      ? model
      : undefined;
}

/**
 * The provider policy of each project, read off disk by Rust whether the
 * project is open or not. A project whose read fails (no backend) is left out
 * and counts as the open default — what Rust itself does with an unreadable
 * policy, and Rust checks again when a child spawns.
 */
export async function readProjectProviderPolicies(
  paths: string[]
): Promise<Record<string, ProviderPolicy>> {
  const read = await Promise.all(
    paths.map(async (path) => {
      try {
        return [path, await projectProviderPolicyGet(path)] as const;
      } catch {
        return null;
      }
    })
  );
  return Object.fromEntries(read.filter((entry) => entry !== null));
}

export interface SupervisorSpawnInput {
  policy: SupervisorPolicy;
  providers: ProviderInfo[];
  projectPolicies: Record<string, ProviderPolicy>;
  descriptions: Record<string, string | null | undefined>;
  /** The provider to run the supervisor on. Defaults to policy.supervisor.provider. */
  provider?: string;
  /** A skill's prompt, handed over as the first task. */
  firstTask?: string;
  /** A skill's model; the policy's supervisor model otherwise. */
  model?: string;
  /** The human's standing instructions from Settings → Supervisor. */
  instructions?: string;
  /** An earlier run's folder to work in again; Rust checks it is one. */
  resumeRunDir?: string;
  /** Set when the launch is a Project Manager's (`docs/design-project-manager.md`). */
  manager?: SupervisorManagerLaunch;
}

/** What a manager's launch needs from Rust: its record, instructions file and last memory check. */
export interface SupervisorManagerLaunch {
  record: SupervisorManager;
  /** The text of `INSTRUCTIONS.md`; null when the file is missing. */
  instructions: string | null;
  /** The last memory check; null when it could not be read, which never blocks a launch. */
  memory: ManagerMemorySummary | null;
}

/**
 * The spawn config of a supervisor, or `null` when the policy shows it no
 * project — a supervisor with nothing to supervise is a Settings question.
 *
 * Rust owns the rest of its shape (ADR 0004): run folder, MCP binding, tools,
 * approved skills, permission mode and interactivity are set there whatever
 * this config says.
 */
export function supervisorSpawnConfig(input: SupervisorSpawnInput): AgentConfig | null {
  const visible = visibleProjects(
    input.policy,
    input.projectPolicies,
    offeredModelsOf(input.providers),
    permissionModesOf(input.providers)
  );
  if (visible.length === 0) return null;
  const providerId = input.provider ?? input.policy.supervisor.provider;
  const provider = input.providers.find((p) => p.id === providerId);
  const instructions = input.instructions ?? readSupervisorInstructions(providerId);
  const { manager } = input;
  const model = manager ? modelStillOffered(input.model, provider) : input.model;
  return {
    name: manager?.record.name ?? 'Supervisor',
    role: 'supervisor',
    provider: providerId,
    model: model ?? input.policy.supervisor.model ?? provider?.defaultModel ?? '',
    task: buildSupervisorLaunchPrompt(
      supervisorPromptProjects(
        visible,
        input.providers,
        input.descriptions,
        supervisorPmServers(input.policy)
      ),
      {
        firstTask: input.firstTask,
        skills: supervisorPromptSkills(input.policy.skills ?? {}),
        tools: Object.keys(input.policy.tools ?? {}).sort(),
        chrome: input.policy.supervisor.chrome === true && providerId === 'claude',
        instructions: instructions || undefined,
        resumedRun: input.resumeRunDir?.split('/').filter(Boolean).pop(),
        manager: manager && {
          name: manager.record.name,
          instructions: manager.instructions,
          findings: manager.memory?.findings ?? [],
          okfAvailable: !manager.memory || !layoutRulesRunWithoutOkf(manager.memory.okf),
        },
      }
    ),
    ...(input.resumeRunDir ? { resumeRunDir: input.resumeRunDir } : {}),
    // Without a folder, Rust turns a manager's key into a resume of its folder.
    ...(manager ? { supervisorKey: manager.record.key } : {}),
    projectPath: null,
    headless: false,
    runSource: 'ui',
    // The generated prompt is not something a person typed; keep it out of
    // the open project's prompt history.
    historyPrompt: '',
  };
}
