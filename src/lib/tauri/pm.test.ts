import { describe, expect, it, vi, beforeEach } from 'vitest';
import { pmLoad, pmSave } from './pm';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'pm_load') {
      return Promise.resolve({
        epics: [
          {
            id: 'e1',
            name: 'Epic 1',
            description: '',
            sortOrder: 0,
            createdAt: '',
            updatedAt: '',
          },
        ],
        tickets: [],
        testCases: [],
        dependencies: [],
      });
    }
    if (cmd === 'pm_save') {
      return Promise.resolve(null);
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  }),
}));

describe('IPC pm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pmLoad returns PmState', async () => {
    const state = await pmLoad('/project');
    expect(state.epics).toHaveLength(1);
    expect(state.epics[0].name).toBe('Epic 1');
  });

  it('pmSave resolves without error', async () => {
    await expect(
      pmSave('/project', { epics: [], tickets: [], testCases: [], dependencies: [] })
    ).resolves.toBeUndefined();
  });
});
