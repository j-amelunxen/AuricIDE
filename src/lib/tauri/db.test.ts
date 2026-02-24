import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initProjectDb, dbGet, dbSet, dbDelete, dbList, closeProjectDb } from './db';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'init_project_db') {
      return Promise.resolve(null);
    }
    if (cmd === 'db_get') {
      if (args?.key === 'missing') return Promise.resolve(null);
      return Promise.resolve('dark');
    }
    if (cmd === 'db_set') {
      return Promise.resolve(null);
    }
    if (cmd === 'db_delete') {
      return Promise.resolve(true);
    }
    if (cmd === 'db_list') {
      return Promise.resolve([
        { namespace: 'settings', key: 'font', value: 'mono', updated_at: '2026-01-01' },
        { namespace: 'settings', key: 'theme', value: 'dark', updated_at: '2026-01-01' },
      ]);
    }
    if (cmd === 'close_project_db') {
      return Promise.resolve(null);
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}));

describe('IPC db', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initProjectDb resolves without error', async () => {
    await expect(initProjectDb('/project')).resolves.toBeUndefined();
  });

  it('dbGet returns value for existing key', async () => {
    const value = await dbGet('/project', 'settings', 'theme');
    expect(value).toBe('dark');
  });

  it('dbGet returns null for missing key', async () => {
    const value = await dbGet('/project', 'settings', 'missing');
    expect(value).toBeNull();
  });

  it('dbSet resolves without error', async () => {
    await expect(dbSet('/project', 'settings', 'theme', 'dark')).resolves.toBeUndefined();
  });

  it('dbDelete returns boolean', async () => {
    const result = await dbDelete('/project', 'settings', 'theme');
    expect(result).toBe(true);
  });

  it('dbList returns entries for namespace', async () => {
    const entries = await dbList('/project', 'settings');
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe('font');
    expect(entries[1].key).toBe('theme');
  });

  it('closeProjectDb resolves without error', async () => {
    await expect(closeProjectDb('/project')).resolves.toBeUndefined();
  });
});
