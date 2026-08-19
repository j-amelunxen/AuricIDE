import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const key = (namespace: string, key: string) => `${namespace}::${key}`;

vi.mock('@/lib/tauri/db', () => ({
  dbGet: vi.fn(async (_root: string, ns: string, k: string) => store.get(key(ns, k)) ?? null),
  dbSet: vi.fn(async (_root: string, ns: string, k: string, value: string) => {
    store.set(key(ns, k), value);
  }),
  dbDelete: vi.fn(async (_root: string, ns: string, k: string) => store.delete(key(ns, k))),
  dbList: vi.fn(async (_root: string, ns: string) =>
    [...store.entries()]
      .filter(([entry]) => entry.startsWith(`${ns}::`))
      .map(([entry, value]) => ({
        namespace: ns,
        key: entry.slice(ns.length + 2),
        value,
        updated_at: '',
      }))
  ),
}));

import {
  PROJECT_CONFIG_DEFAULTS,
  loadIgnoredRepos,
  loadProjectConfig,
  loadProviderPolicy,
  loadProjectCredentials,
  saveIgnoredRepos,
  saveProviderPolicy,
  setProjectConfigValue,
} from './projectConfig';
import { DEFAULT_PROVIDER_POLICY } from './providerPolicy';

const ROOT = '/tmp/project';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('project config', () => {
  it('returns the defaults for a project that has never been configured', async () => {
    await expect(loadProjectConfig(ROOT)).resolves.toEqual(PROJECT_CONFIG_DEFAULTS);
  });

  it('round-trips a string setting', async () => {
    await setProjectConfigValue(ROOT, 'branchTicketPattern', 'FOO-\\d+');

    const config = await loadProjectConfig(ROOT);
    expect(config.branchTicketPattern).toBe('FOO-\\d+');
    // Untouched fields keep their defaults rather than becoming undefined.
    expect(config.agenticCommitPrompt).toBe(PROJECT_CONFIG_DEFAULTS.agenticCommitPrompt);
  });

  it('round-trips a boolean setting', async () => {
    await setProjectConfigValue(ROOT, 'agenticCommit', false);

    await expect(loadProjectConfig(ROOT)).resolves.toMatchObject({ agenticCommit: false });
  });

  it('survives a stored value of the wrong shape', async () => {
    // Hand-edited databases and older writes exist; one bad field must not
    // take the whole settings screen down with it.
    store.set('project_config::agenticCommit', 'perhaps');

    await expect(loadProjectConfig(ROOT)).resolves.toMatchObject({
      agenticCommit: PROJECT_CONFIG_DEFAULTS.agenticCommit,
    });
  });

  it('reads defaults when the database is unreachable', async () => {
    const { dbGet } = await import('@/lib/tauri/db');
    vi.mocked(dbGet).mockRejectedValueOnce(new Error('no IPC'));

    await expect(loadProjectConfig(ROOT)).resolves.toEqual(PROJECT_CONFIG_DEFAULTS);
  });

  it('refuses to write without a project', async () => {
    const { dbSet } = await import('@/lib/tauri/db');

    await setProjectConfigValue('', 'branchTicketPattern', 'X-\\d+');

    expect(dbSet).not.toHaveBeenCalled();
  });
});

describe('provider policy storage', () => {
  it('reads the open default when no policy was ever saved', async () => {
    await expect(loadProviderPolicy(ROOT)).resolves.toEqual(DEFAULT_PROVIDER_POLICY);
  });

  it('round-trips a policy', async () => {
    await saveProviderPolicy(ROOT, { allow: ['claude'], deny: ['grok'] });

    await expect(loadProviderPolicy(ROOT)).resolves.toEqual({
      allow: ['claude'],
      deny: ['grok'],
    });
  });

  it('reads the open default when the stored policy is corrupt', async () => {
    store.set('provider_policy::policy', '{ broken');

    await expect(loadProviderPolicy(ROOT)).resolves.toEqual(DEFAULT_PROVIDER_POLICY);
  });

  it('reads the open default without a project', async () => {
    // The launcher and browser mode have no project. Neither may be locked out.
    await expect(loadProviderPolicy('')).resolves.toEqual(DEFAULT_PROVIDER_POLICY);
  });

  it('reads the open default when the database call fails', async () => {
    const { dbGet } = await import('@/lib/tauri/db');
    vi.mocked(dbGet).mockRejectedValueOnce(new Error('no IPC'));

    await expect(loadProviderPolicy(ROOT)).resolves.toEqual(DEFAULT_PROVIDER_POLICY);
  });
});

describe('ignored repos storage', () => {
  it('reads an empty list when nothing was ever saved', async () => {
    await expect(loadIgnoredRepos(ROOT)).resolves.toEqual([]);
  });

  it('round-trips a list', async () => {
    await saveIgnoredRepos(ROOT, ['web', 'vendor/lib']);

    await expect(loadIgnoredRepos(ROOT)).resolves.toEqual(['vendor/lib', 'web']);
  });

  it('reads an empty list when the stored value is corrupt', async () => {
    store.set('ignored_repos::paths', '{ broken');

    await expect(loadIgnoredRepos(ROOT)).resolves.toEqual([]);
  });

  it('reads an empty list without a project', async () => {
    await expect(loadIgnoredRepos('')).resolves.toEqual([]);
  });

  it('reads an empty list when the database call fails', async () => {
    const { dbGet } = await import('@/lib/tauri/db');
    vi.mocked(dbGet).mockRejectedValueOnce(new Error('no IPC'));

    await expect(loadIgnoredRepos(ROOT)).resolves.toEqual([]);
  });

  it('refuses to write without a project', async () => {
    const { dbSet } = await import('@/lib/tauri/db');

    await saveIgnoredRepos('', ['vendor']);

    expect(dbSet).not.toHaveBeenCalled();
  });
});

describe('project credential overrides', () => {
  it('returns only the fields the project actually overrides', async () => {
    store.set('llm_settings::model', 'project-model');

    await expect(loadProjectCredentials(ROOT, 'llm_settings')).resolves.toEqual({
      model: 'project-model',
    });
  });

  it('returns nothing for a project that overrides nothing', async () => {
    await expect(loadProjectCredentials(ROOT, 'llm_settings')).resolves.toEqual({});
  });
});
