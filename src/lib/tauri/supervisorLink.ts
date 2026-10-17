import { invoke } from './invoke';

/**
 * Which projects the supervisor link may read scenes from
 * (`docs/design-supervisor-link.md`, "Who sees what"). The file is
 * `<app_data_dir>/supervisor-link.json`, Rust's alone: it is read on every
 * scene request and fails closed.
 */
export interface SupervisorLinkPolicy {
  sceneProjects: string[];
}

export async function supervisorLinkPolicyGet(): Promise<SupervisorLinkPolicy> {
  return await invoke<SupervisorLinkPolicy>('supervisor_link_policy_get');
}

/** Answers with the file as it now reads back (paths canonical, sorted). */
export async function supervisorLinkPolicySet(projects: string[]): Promise<SupervisorLinkPolicy> {
  return await invoke<SupervisorLinkPolicy>('supervisor_link_policy_set', { projects });
}
