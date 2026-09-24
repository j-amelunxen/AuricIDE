import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('./invoke', () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }));

import { sendPushoverTest } from './pushover';

describe('Pushover Tauri API', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('calls the dedicated test command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await sendPushoverTest();
    expect(mockInvoke).toHaveBeenCalledWith('pushover_send_test');
  });
});
