import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectStore = new Map<string, string>();
const globalStore = new Map<string, string>();
const key = (namespace: string, field: string) => `${namespace}::${field}`;

vi.mock('@/lib/tauri/db', () => ({
  dbList: vi.fn(async (_root: string, ns: string) =>
    [...projectStore.entries()]
      .filter(([entry]) => entry.startsWith(`${ns}::`))
      .map(([entry, value]) => ({
        namespace: ns,
        key: entry.slice(ns.length + 2),
        value,
        updated_at: '',
      }))
  ),
}));

vi.mock('@/lib/tauri/appCredentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/appCredentials')>();
  return {
    ...actual,
    loadAppCredentials: vi.fn(async (ns: string) =>
      Object.fromEntries(
        [...globalStore.entries()]
          .filter(([entry]) => entry.startsWith(`${ns}::`))
          .map(([entry, value]) => [entry.slice(ns.length + 2), value])
      )
    ),
  };
});

import { CREDENTIAL_NAMESPACES } from '@/lib/tauri/appCredentials';
import { isCredentialConfigured, resolveCredential } from './credentialStatus';

const JUDGE = CREDENTIAL_NAMESPACES.judge;

beforeEach(() => {
  projectStore.clear();
  globalStore.clear();
});

/**
 * Mirrors the cases `app_config::resolve_credential` is tested against in Rust.
 * The two are twins; a disagreement means the UI gates on one answer while the
 * key is spent under another.
 */
describe('resolveCredential – the override rule', () => {
  it('lets a project value win over the application one', () => {
    expect(resolveCredential('global', 'project')).toBe('project');
  });

  it('falls back to the application value when the project sets none', () => {
    expect(resolveCredential('global', undefined)).toBe('global');
  });

  it('reads a blank project value as "use the application one", not as "none here"', () => {
    expect(resolveCredential('global', '  ')).toBe('global');
  });

  it('resolves to nothing when neither side carries anything', () => {
    expect(resolveCredential(undefined, undefined)).toBeNull();
    expect(resolveCredential('', '')).toBeNull();
  });
});

describe('isCredentialConfigured', () => {
  // The bug this exists to prevent: the keys live in the application store now,
  // so a project that inherits its judge key has nothing in its own database.
  // Asking only the project reported a configured judge as missing, which left
  // the conductor's "Judge review" switch greyed out with no way to turn it on.
  it('counts an application-wide key even though the project stores none', async () => {
    globalStore.set(key(JUDGE, 'api_key'), 'sk-application');

    await expect(isCredentialConfigured('/p', JUDGE)).resolves.toBe(true);
  });

  it('counts a project override even though the application store has none', async () => {
    projectStore.set(key(JUDGE, 'api_key'), 'sk-project');

    await expect(isCredentialConfigured('/p', JUDGE)).resolves.toBe(true);
  });

  it('reports nothing configured when neither store carries the field', async () => {
    globalStore.set(key(JUDGE, 'model'), 'some-model');

    await expect(isCredentialConfigured('/p', JUDGE)).resolves.toBe(false);
  });

  it('still answers for the application store with no project open', async () => {
    globalStore.set(key(JUDGE, 'api_key'), 'sk-application');

    await expect(isCredentialConfigured(null, JUDGE)).resolves.toBe(true);
  });
});
