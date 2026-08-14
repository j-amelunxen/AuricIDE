import { beforeEach, describe, expect, it, vi } from 'vitest';

const projectStore = new Map<string, string>();
const globalStore = new Map<string, string>();
const key = (namespace: string, field: string) => `${namespace}::${field}`;

vi.mock('@/lib/tauri/db', () => ({
  dbGet: vi.fn(
    async (_root: string, ns: string, k: string) => projectStore.get(key(ns, k)) ?? null
  ),
  dbSet: vi.fn(async (_root: string, ns: string, k: string, value: string) => {
    projectStore.set(key(ns, k), value);
  }),
  dbDelete: vi.fn(async (_root: string, ns: string, k: string) => projectStore.delete(key(ns, k))),
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
    setAppCredential: vi.fn(async (ns: string, k: string, value: string) => {
      globalStore.set(key(ns, k), value);
    }),
  };
});

import { migrateProjectCredentials } from './migrateCredentials';

const ROOT = '/tmp/project';

beforeEach(() => {
  projectStore.clear();
  globalStore.clear();
  vi.clearAllMocks();
});

describe('credential migration', () => {
  it('lifts a project-only key into the application store', async () => {
    projectStore.set('llm_settings::api_key', 'sk-from-project');

    const result = await migrateProjectCredentials(ROOT);

    expect(globalStore.get('llm_settings::api_key')).toBe('sk-from-project');
    // Left behind, the same value would read as a deliberate override.
    expect(projectStore.has('llm_settings::api_key')).toBe(false);
    expect(result.lifted).toContain('llm_settings');
  });

  it('keeps a project value as an override when the application already has one', async () => {
    globalStore.set('llm_settings::api_key', 'sk-global');
    projectStore.set('llm_settings::api_key', 'sk-from-project');

    const result = await migrateProjectCredentials(ROOT);

    expect(globalStore.get('llm_settings::api_key')).toBe('sk-global');
    expect(projectStore.get('llm_settings::api_key')).toBe('sk-from-project');
    expect(result.lifted).not.toContain('llm_settings');
  });

  it('decides field by field, not namespace by namespace', async () => {
    // A project that set only the model must not lose it just because the key
    // it did not set was already global.
    globalStore.set('llm_settings::api_key', 'sk-global');
    projectStore.set('llm_settings::model', 'project-model');

    await migrateProjectCredentials(ROOT);

    expect(globalStore.get('llm_settings::model')).toBe('project-model');
    expect(projectStore.has('llm_settings::model')).toBe(false);
  });

  it('covers every credential namespace', async () => {
    projectStore.set('judge_llm_settings::api_key', 'sk-judge');
    projectStore.set('excalidraw_settings::api_key', 'sk-excalidraw');
    projectStore.set('video_import_settings::remote_api_key', 'sk-video');

    const result = await migrateProjectCredentials(ROOT);

    expect(globalStore.get('judge_llm_settings::api_key')).toBe('sk-judge');
    expect(globalStore.get('excalidraw_settings::api_key')).toBe('sk-excalidraw');
    expect(globalStore.get('video_import_settings::remote_api_key')).toBe('sk-video');
    expect(result.lifted).toHaveLength(3);
  });

  it('runs once and then stays out of the way', async () => {
    projectStore.set('llm_settings::api_key', 'sk-from-project');
    await migrateProjectCredentials(ROOT);

    // A second run must not re-lift a key the user has since set locally on
    // purpose.
    projectStore.set('llm_settings::api_key', 'sk-deliberate-override');
    const second = await migrateProjectCredentials(ROOT);

    expect(second.lifted).toHaveLength(0);
    expect(projectStore.get('llm_settings::api_key')).toBe('sk-deliberate-override');
  });

  it('marks a project with nothing to move as done anyway', async () => {
    const first = await migrateProjectCredentials(ROOT);
    expect(first.lifted).toHaveLength(0);

    // Otherwise every launch would re-scan four namespaces for nothing.
    projectStore.set('llm_settings::api_key', 'sk-set-later');
    const second = await migrateProjectCredentials(ROOT);
    expect(second.lifted).toHaveLength(0);
  });

  it('does nothing without a project', async () => {
    const result = await migrateProjectCredentials('');

    expect(result.lifted).toHaveLength(0);
    expect(globalStore.size).toBe(0);
  });

  it('leaves everything in place when the application store cannot be written', async () => {
    const { setAppCredential } = await import('@/lib/tauri/appCredentials');
    vi.mocked(setAppCredential).mockRejectedValueOnce(new Error('read-only'));
    projectStore.set('llm_settings::api_key', 'sk-from-project');

    const result = await migrateProjectCredentials(ROOT);

    // Deleting the project copy after a failed write would lose the key.
    expect(projectStore.get('llm_settings::api_key')).toBe('sk-from-project');
    expect(result.lifted).toHaveLength(0);
  });

  it('stays unmarked after a failure so the next launch tries again', async () => {
    const { setAppCredential } = await import('@/lib/tauri/appCredentials');
    vi.mocked(setAppCredential).mockRejectedValueOnce(new Error('read-only'));
    projectStore.set('llm_settings::api_key', 'sk-from-project');
    await migrateProjectCredentials(ROOT);

    vi.mocked(setAppCredential).mockImplementation(async (ns: string, k: string, value: string) => {
      globalStore.set(key(ns, k), value);
    });
    const retry = await migrateProjectCredentials(ROOT);

    expect(retry.lifted).toContain('llm_settings');
  });
});
