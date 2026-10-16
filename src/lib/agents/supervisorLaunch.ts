import { APP_CONFIG_KEYS, readAppPref, removeAppPref, writeAppPref } from '@/lib/config/appConfig';
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
import { isFinishedAgent } from './fleet';
import {
  buildSupervisorLaunchPrompt,
  supervisorPromptProjects,
  supervisorPromptSkills,
} from './supervisorLaunchPrompt';

/** One supervisor at a time: the tile focuses this one instead of starting a second. */
export function findRunningSupervisor(agents: AgentInfo[]): AgentInfo | undefined {
  return agents.find((agent) => agent.role === 'supervisor' && !isFinishedAgent(agent));
}

/**
 * The human's standing instructions for every supervisor (Settings →
 * Supervisor). An app preference, not part of `supervisor-policy.json`: they
 * steer how the supervisor works, never what Rust lets it do.
 */
export function readSupervisorInstructions(): string {
  return readAppPref(APP_CONFIG_KEYS.supervisorInstructions) ?? '';
}

/** A blank text removes the preference, so "no instructions" is one state. */
export function writeSupervisorInstructions(text: string): void {
  if (text.trim()) writeAppPref(APP_CONFIG_KEYS.supervisorInstructions, text);
  else removeAppPref(APP_CONFIG_KEYS.supervisorInstructions);
}

export function offeredModelsOf(providers: ProviderInfo[]): OfferedModels {
  return Object.fromEntries(providers.map((p) => [p.id, p.models.map((m) => m.value)]));
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
  /** A skill's prompt, handed over as the first task. */
  firstTask?: string;
  /** A skill's model; the policy's supervisor model otherwise. */
  model?: string;
  /** The human's standing instructions from Settings → Supervisor. */
  instructions?: string;
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
  const providerId = input.policy.supervisor.provider;
  const provider = input.providers.find((p) => p.id === providerId);
  return {
    name: 'Supervisor',
    role: 'supervisor',
    provider: providerId,
    model: input.model ?? input.policy.supervisor.model ?? provider?.defaultModel ?? '',
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
        chrome: input.policy.supervisor.chrome === true,
        instructions: input.instructions,
      }
    ),
    projectPath: null,
    headless: false,
    runSource: 'ui',
    // The generated prompt is not something a person typed; keep it out of
    // the open project's prompt history.
    historyPrompt: '',
  };
}
