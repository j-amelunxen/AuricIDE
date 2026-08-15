import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('theme IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listThemes calls invoke with list_themes', async () => {
    const files = [{ path: '/app/themes/rose.json', content: '{}' }];
    mockInvoke.mockResolvedValueOnce(files);

    const { listThemes } = await import('./themes');
    await expect(listThemes()).resolves.toEqual(files);
    expect(mockInvoke).toHaveBeenCalledWith('list_themes', undefined);
  });

  it('importTheme calls invoke with content and filename', async () => {
    const written = { path: '/app/themes/rose.json', content: '{"id":"rose"}' };
    mockInvoke.mockResolvedValueOnce(written);

    const { importTheme } = await import('./themes');
    const result = await importTheme('{"id":"rose"}', 'rose.json');

    expect(result).toEqual(written);
    expect(mockInvoke).toHaveBeenCalledWith('import_theme', {
      content: '{"id":"rose"}',
      filename: 'rose.json',
    });
  });
});
