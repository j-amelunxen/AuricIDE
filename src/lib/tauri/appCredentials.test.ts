import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import { setAppCredentials } from './appCredentials';

describe('application credential Tauri API', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('replaces one namespace with one atomic IPC call', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const values = { api_token: 'token', user_key: 'user', enabled: 'true' };

    await setAppCredentials('pushover_settings', values);

    expect(mockInvoke).toHaveBeenCalledOnce();
    expect(mockInvoke).toHaveBeenCalledWith('app_credential_replace_namespace', {
      namespace: 'pushover_settings',
      values,
    });
  });
});
