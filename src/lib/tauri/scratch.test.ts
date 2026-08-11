import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getScratchDir } from './scratch';

const invokeMock = vi.fn((cmd: string) => {
  if (cmd === 'get_scratch_dir') {
    return Promise.resolve('/app-data/scratches');
  }
  return Promise.reject(new Error(`Unknown command: ${cmd}`));
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

describe('IPC scratch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getScratchDir resolves the global scratch directory', async () => {
    const dir = await getScratchDir();
    expect(dir).toBe('/app-data/scratches');
    expect(invokeMock).toHaveBeenCalledWith('get_scratch_dir', undefined);
  });
});
