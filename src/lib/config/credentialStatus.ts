import { loadAppCredentials } from '@/lib/tauri/appCredentials';
import { loadProjectCredentials } from './projectConfig';

/**
 * The one override rule, in TypeScript: a project value wins when it carries
 * something, the application value otherwise. A blank is not a value — that is
 * how a cleared field arrives from a settings screen.
 *
 * Twin of `app_config::resolve_credential` in Rust, and tested against the same
 * cases. The two disagreeing is the failure that matters here: a switch in the
 * UI would gate on one answer while the key is actually spent under another.
 */
export function resolveCredential(
  global: string | undefined,
  project: string | undefined
): string | null {
  if (project !== undefined && project.trim() !== '') return project;
  if (global !== undefined && global.trim() !== '') return global;
  return null;
}

/**
 * Whether one credential field resolves to something for this project —
 * application value and project override taken together.
 *
 * Asking the project database alone is what a caller reaches for out of habit,
 * and it is wrong since the keys moved to the application store: a project that
 * inherits its key stores nothing of its own, so the answer comes back "not
 * configured" for a key that is right there. Anything gating a feature on a key
 * has to go through here.
 */
export async function isCredentialConfigured(
  rootPath: string | null,
  namespace: string,
  key = 'api_key'
): Promise<boolean> {
  return (await readCredential(rootPath, namespace, key)) !== null;
}

/**
 * The value one credential field resolves to for this project, or null. Same
 * rule as `isCredentialConfigured` — that one is this one, asked yes-or-no.
 *
 * Only for fields that may be shown: never call it for `api_key` to put the
 * result on screen.
 */
export async function readCredential(
  rootPath: string | null,
  namespace: string,
  key: string
): Promise<string | null> {
  const [global, project] = await Promise.all([
    loadAppCredentials(namespace).catch(() => null),
    rootPath ? loadProjectCredentials(rootPath, namespace).catch(() => null) : null,
  ]);
  // A namespace nothing was ever written to comes back empty, and IPC that is
  // not there at all comes back as nothing — neither is worth a crash in a
  // caller that only wanted to know whether a field is set.
  return resolveCredential(global?.[key], project?.[key]);
}
