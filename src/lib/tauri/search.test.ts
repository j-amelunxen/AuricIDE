import { describe, expect, it, vi, beforeEach } from 'vitest';
import { searchInFiles } from './search';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, _args?: Record<string, unknown>) => {
    if (cmd === 'search_in_files') {
      return Promise.resolve([
        { path: '/p/a.md', line: 3, column: 8, line_text: 'the needle here' },
        { path: '/p/b.md', line: 1, column: 1, line_text: 'needle at start' },
      ]);
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}));

describe('IPC search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps snake_case results to camelCase', async () => {
    const results = await searchInFiles('/p', 'needle', false);
    expect(results).toEqual([
      { path: '/p/a.md', line: 3, column: 8, lineText: 'the needle here' },
      { path: '/p/b.md', line: 1, column: 1, lineText: 'needle at start' },
    ]);
  });

  it('forwards rootPath, query and caseSensitive to the backend', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await searchInFiles('/p', 'needle', true);
    expect(invoke).toHaveBeenCalledWith('search_in_files', {
      rootPath: '/p',
      query: 'needle',
      caseSensitive: true,
    });
  });
});
