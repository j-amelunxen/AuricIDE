import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invoke', () => ({ invoke: vi.fn() }));

import { invoke } from './invoke';
import { machineDependencies } from './machine';

describe('machine dependency IPC', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('asks for every dependency without re-reading the login shell by default', async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await machineDependencies();
    expect(invoke).toHaveBeenCalledWith('machine_dependencies', { refresh: false });
  });

  it('asks for a re-read of the login shell when checking again', async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await machineDependencies({ refresh: true });
    expect(invoke).toHaveBeenCalledWith('machine_dependencies', { refresh: true });
  });
});
