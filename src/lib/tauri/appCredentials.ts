import { invoke } from './invoke';

/**
 * Application-wide credentials, kept by Rust in `app-credentials.json` at mode
 * 0600 rather than in the localStorage mirror — a secret should not end up in a
 * second copy inside a WebKit database.
 *
 * The namespaces match the ones a project uses for its overrides
 * (`llm_settings`, `judge_llm_settings`, `excalidraw_settings`,
 * `video_import_settings`), so a global value and its override are addressed
 * identically on both sides.
 */
export const CREDENTIAL_NAMESPACES = {
  llm: 'llm_settings',
  judge: 'judge_llm_settings',
  excalidraw: 'excalidraw_settings',
  videoImport: 'video_import_settings',
} as const;

/**
 * Every field of one namespace. Browser mode and a webview without IPC come
 * back empty — a settings screen that cannot reach the store should render
 * blank fields, not fail to mount.
 */
export async function loadAppCredentials(namespace: string): Promise<Record<string, string>> {
  try {
    return await invoke<Record<string, string>>('app_credential_list', { namespace });
  } catch {
    return {};
  }
}

/**
 * Stores a value, or clears it when blank. Unlike the readers this one lets the
 * error through: a save that did not happen must not look like one that did.
 */
export async function setAppCredential(
  namespace: string,
  key: string,
  value: string
): Promise<void> {
  await invoke('app_credential_set', { namespace, key, value });
}
