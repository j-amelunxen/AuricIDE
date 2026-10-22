import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';

const mockRuns = vi.fn();
vi.mock('@/lib/tauri/supervisorRuns', () => ({ supervisorRunsList: () => mockRuns() }));

import { managerInstructionsPath } from './managerFolder';

const manager = { key: 'release-desk', runDir: '2026-10-21_090000' } as SupervisorManager;

describe('managerInstructionsPath', () => {
  beforeEach(() => mockRuns.mockReset());

  it('joins the manager folder from the runs list with the instructions file', async () => {
    mockRuns.mockResolvedValue([
      { name: '2026-10-20_080000', path: '/Users/dev/.auric/supervisors/2026-10-20_080000' },
      { name: '2026-10-21_090000', path: '/Users/dev/.auric/supervisors/2026-10-21_090000/' },
    ]);
    expect(await managerInstructionsPath(manager)).toBe(
      '/Users/dev/.auric/supervisors/2026-10-21_090000/INSTRUCTIONS.md'
    );
  });

  it('is null when the folder is gone', async () => {
    mockRuns.mockResolvedValue([{ name: 'other', path: '/Users/dev/.auric/supervisors/other' }]);
    expect(await managerInstructionsPath(manager)).toBeNull();
  });
});
