import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./invoke', () => ({ invoke: vi.fn() }));

import { invoke } from './invoke';
import {
  managerArchive,
  managerInstructions,
  managerMemory,
  managerPromote,
  managerRegistry,
  managerRemove,
  managerRename,
  managerRestore,
  managerValidate,
  MANAGERS_CHANGED_EVENT,
  supervisorManagersList,
} from './supervisorManagers';

describe('supervisor manager IPC', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('lists the registry', async () => {
    vi.mocked(invoke).mockResolvedValue({ managers: [{ key: 'release-desk' }], error: null });
    expect(await supervisorManagersList()).toEqual([{ key: 'release-desk' }]);
    expect(invoke).toHaveBeenCalledWith('manager_list');
  });

  it('hands the registry error to the UI as a field', async () => {
    const reply = {
      managers: [],
      error: 'supervisor-managers.json could not be read: x. It was left as it is.',
    };
    vi.mocked(invoke).mockResolvedValue(reply);
    expect(await managerRegistry()).toEqual(reply);
  });

  it('throws the sentence when Rust could not read the registry, never an empty list', async () => {
    const sentence = 'supervisor-managers.json could not be read: bad. It was left as it is.';
    vi.mocked(invoke).mockResolvedValue({ managers: [], error: sentence });
    await expect(supervisorManagersList()).rejects.toBe(sentence);
  });

  it('promotes a run folder under a name', async () => {
    vi.mocked(invoke).mockResolvedValue({ key: 'release-desk' });
    await managerPromote('2026-10-21_090000', 'Release Desk');
    expect(invoke).toHaveBeenCalledWith('manager_promote', {
      runDir: '2026-10-21_090000',
      name: 'Release Desk',
    });
  });

  it('renames by key', async () => {
    vi.mocked(invoke).mockResolvedValue({ key: 'release-desk' });
    await managerRename('release-desk', 'Ship Desk');
    expect(invoke).toHaveBeenCalledWith('manager_rename', {
      key: 'release-desk',
      name: 'Ship Desk',
    });
  });

  it.each([
    ['manager_archive', managerArchive],
    ['manager_restore', managerRestore],
    ['manager_remove', managerRemove],
  ] as const)('%s takes only the key', async (command, call) => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await call('release-desk');
    expect(invoke).toHaveBeenCalledWith(command, { key: 'release-desk' });
  });

  it('reads the instructions, null when the file is missing', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    expect(await managerInstructions('release-desk')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('manager_instructions', { key: 'release-desk' });
  });

  it('reads the memory summary and validates on demand', async () => {
    vi.mocked(invoke).mockResolvedValue({ okf: 'ok' });
    await managerMemory('release-desk');
    expect(invoke).toHaveBeenLastCalledWith('manager_memory', { key: 'release-desk' });
    await managerValidate('release-desk');
    expect(invoke).toHaveBeenLastCalledWith('manager_validate', { key: 'release-desk' });
  });

  it('lets a refusal sentence through untouched', async () => {
    vi.mocked(invoke).mockRejectedValue("No Project Manager has the key 'x'.");
    await expect(managerArchive('x')).rejects.toBe("No Project Manager has the key 'x'.");
  });

  it.each([
    ['promoted', () => managerPromote('2026-10-21_090000', 'Release Desk')],
    ['renamed', () => managerRename('release-desk', 'Release Desk 2')],
    ['archived', () => managerArchive('release-desk')],
    ['restored', () => managerRestore('release-desk')],
    ['removed', () => managerRemove('release-desk')],
  ])('announces a registry change once a manager is %s', async (_what, change) => {
    vi.mocked(invoke).mockResolvedValue({});
    const heard = vi.fn();
    window.addEventListener(MANAGERS_CHANGED_EVENT, heard);
    await change();
    window.removeEventListener(MANAGERS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('announces nothing when Rust refuses the change', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('refused'));
    const heard = vi.fn();
    window.addEventListener(MANAGERS_CHANGED_EVENT, heard);
    await expect(managerArchive('release-desk')).rejects.toThrow('refused');
    window.removeEventListener(MANAGERS_CHANGED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
