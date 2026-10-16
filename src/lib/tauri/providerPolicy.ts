import type { ProviderPolicy } from '../config/providerPolicy';
import { invoke } from './invoke';

/**
 * A project's provider policy read straight off its `.auric/project.db`, open
 * in the IDE or not — the same read the spawn gate does
 * (`provider_policy::policy_for_project`). Anything unreadable comes back as
 * the open default, as it does there.
 */
export async function projectProviderPolicyGet(projectPath: string): Promise<ProviderPolicy> {
  return await invoke<ProviderPolicy>('project_provider_policy_get', { projectPath });
}
