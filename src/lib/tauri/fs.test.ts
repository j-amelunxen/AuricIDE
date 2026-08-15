import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readDirectory, readFile, writeFile } from './fs';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, _args?: Record<string, unknown>) => {
    if (cmd === 'read_directory') {
      return Promise.resolve([
        { name: 'src', path: '/src', is_directory: true },
        {
          name: 'README.md',
          path: '/README.md',
          is_directory: false,
          created_at: 1_700_000_000_000,
        },
        {
          name: 'lib',
          path: '/lib',
          is_directory: true,
          newest_file_created_at: 1_700_000_000_100,
        },
      ]);
    }
    if (cmd === 'read_file') {
      return Promise.resolve('# Hello World');
    }
    if (cmd === 'write_file') {
      return Promise.resolve(null);
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}));

describe('IPC fs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('readDirectory returns file entries', async () => {
    const entries = await readDirectory('/project');
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe('src');
    expect(entries[0].isDirectory).toBe(true);
    expect(entries[0].createdAt).toBeUndefined();
    expect(entries[1].createdAt).toBe(1_700_000_000_000);
    expect(entries[2].newestFileCreatedAt).toBe(1_700_000_000_100);
  });

  it('readFile returns file content', async () => {
    const content = await readFile('/README.md');
    expect(content).toBe('# Hello World');
  });

  it('writeFile completes without error', async () => {
    await expect(writeFile('/README.md', '# Updated')).resolves.toBeUndefined();
  });
});
