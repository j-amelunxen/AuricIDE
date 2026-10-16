import type { PermissionModeOption, ProviderInfo } from '@/lib/tauri/providers';
import { DEFAULT_PROVIDER_POLICY, isProviderAllowed, type ProviderPolicy } from './providerPolicy';
import fixtures from './supervisorPolicy.fixtures.json';
import {
  defaultSupervisorProjectPolicy,
  MAX_PROVIDER_WEIGHT,
  normalizeProjectPath,
  permissionModesOf,
  runsUnattended,
  type SupervisorPolicy,
  type SupervisorProjectPolicy,
} from './supervisorPolicy';

/**
 * The edits Settings → Supervisor makes, as pure functions over the policy.
 * Each keeps the file's meaning of "absent": `providers: null` and a missing
 * `models[p]` mean "everything", so the first edit turns them into an explicit
 * list of everything but the one being switched off.
 */

const REJECTED_PERMISSION_MODES: readonly string[] = fixtures.rejectedPermissionModes;

export function updateSupervisorProject(
  policy: SupervisorPolicy,
  path: string,
  update: (entry: SupervisorProjectPolicy) => SupervisorProjectPolicy
): SupervisorPolicy {
  const key = normalizeProjectPath(path);
  const current = policy.projects[key] ?? defaultSupervisorProjectPolicy();
  return { ...policy, projects: { ...policy.projects, [key]: update(current) } };
}

/** Switching off keeps the entry, so switching back on restores what was set. */
export function setProjectAllowed(
  policy: SupervisorPolicy,
  path: string,
  allowed: boolean
): SupervisorPolicy {
  return updateSupervisorProject(policy, path, (entry) => ({ ...entry, allowed }));
}

function toggled(list: readonly string[], id: string, on: boolean, order: readonly string[]) {
  const next = new Set(list);
  if (on) next.add(id);
  else next.delete(id);
  // The registry's order, so a saved file reads the way the screen does.
  const ordered = order.filter((entry) => next.has(entry));
  return [...ordered, ...[...next].filter((entry) => !order.includes(entry))];
}

/** `candidates`: the providers "whatever the project permits" stands for right now. */
export function toggleSupervisorProvider(
  entry: SupervisorProjectPolicy,
  providerId: string,
  on: boolean,
  candidates: readonly string[]
): SupervisorProjectPolicy {
  const current = entry.providers ?? candidates;
  return { ...entry, providers: toggled(current, providerId, on, candidates) };
}

/** `offered`: the provider's model ids, in the order the registry lists them. */
export function toggleSupervisorModel(
  entry: SupervisorProjectPolicy,
  providerId: string,
  modelId: string,
  on: boolean,
  offered: readonly string[]
): SupervisorProjectPolicy {
  const current = entry.models[providerId] ?? offered;
  return {
    ...entry,
    models: { ...entry.models, [providerId]: toggled(current, modelId, on, offered) },
  };
}

/** `null` goes back to the provider's own default. */
export function setSupervisorPermissionMode(
  entry: SupervisorProjectPolicy,
  providerId: string,
  mode: string | null
): SupervisorProjectPolicy {
  const permissionMode = { ...entry.permissionMode };
  if (mode === null) delete permissionMode[providerId];
  else permissionMode[providerId] = mode;
  return { ...entry, permissionMode };
}

/**
 * A provider's load-balancing share, clamped to a whole number in 0..99 like
 * the parser demands. `null` (an emptied field) takes the provider out of the map.
 */
export function setSupervisorProviderWeight(
  entry: SupervisorProjectPolicy,
  providerId: string,
  weight: number | null
): SupervisorProjectPolicy {
  const providerWeights = { ...entry.providerWeights };
  if (weight === null || !Number.isFinite(weight)) delete providerWeights[providerId];
  else providerWeights[providerId] = Math.min(MAX_PROVIDER_WEIGHT, Math.max(0, Math.floor(weight)));
  return { ...entry, providerWeights };
}

/**
 * A supervisor's child never runs without asking: the parser refuses
 * `bypassPermissions` by name, the spawn check refuses every mode the provider
 * marks `unattended` — so the form offers neither.
 */
export function offerablePermissionModes(modes: PermissionModeOption[]): PermissionModeOption[] {
  return modes.filter(
    (mode) => !mode.unattended && !REJECTED_PERMISSION_MODES.includes(mode.value)
  );
}

export interface UnattendedBlocker {
  path: string;
  providerId: string;
}

/**
 * The providers that would run a child without asking — their provider
 * default skips prompts and the policy names no other mode. Only where it
 * would actually matter: an allowed project, a ticked provider, one the
 * project's own rules permit. Anything else never runs, so it never blocks a
 * save.
 */
export function unattendedBlockers(
  policy: SupervisorPolicy,
  providers: ProviderInfo[],
  projectPolicies: Record<string, ProviderPolicy>
): UnattendedBlocker[] {
  const modes = permissionModesOf(providers);
  return Object.entries(policy.projects).flatMap(([path, entry]) => {
    if (!entry.allowed) return [];
    const projectPolicy = projectPolicies[path] ?? DEFAULT_PROVIDER_POLICY;
    return providers
      .filter(
        (p) =>
          (entry.providers?.includes(p.id) ?? true) &&
          isProviderAllowed(p.id, projectPolicy) &&
          runsUnattended(entry, p.id, modes)
      )
      .map((p) => ({ path, providerId: p.id }));
  });
}
