import type { SupervisorPolicy, SupervisorPolicyRejection } from '../config/supervisorPolicy';
import { invoke } from './invoke';

/**
 * The supervisor policy as Rust read it from `<app_data_dir>/supervisor-policy.json`,
 * plus what it dropped and why. The file is Rust's alone: the frontend never
 * writes it directly and never caches it in webview storage (ADR 0004).
 */
export interface SupervisorPolicyState {
  policy: SupervisorPolicy;
  rejected: SupervisorPolicyRejection[];
}

export async function supervisorPolicyGet(): Promise<SupervisorPolicyState> {
  return await invoke<SupervisorPolicyState>('supervisor_policy_get');
}

/**
 * Rust validates before it writes (mode 0600, atomically) and refuses
 * `bypassPermissions`. Answers with the file as it now reads back, so the
 * caller shows what was stored, not what it sent.
 */
export async function supervisorPolicySet(
  policy: SupervisorPolicy
): Promise<SupervisorPolicyState> {
  return await invoke<SupervisorPolicyState>('supervisor_policy_set', { policy });
}

/**
 * Where the login shell's PATH finds a tool (an absolute path: whether the
 * file exists), or `null`. For display only; the policy gate never reads it.
 */
export async function supervisorResolveTool(name: string): Promise<string | null> {
  return await invoke<string | null>('supervisor_resolve_tool', { name });
}
