import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./invoke', () => ({ invoke: vi.fn(async () => ({ content: 'ok' })) }));

import { llmCall } from './llm';
import { invoke } from './invoke';

describe('llmCall IPC', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
  });

  it('is a function', () => {
    expect(typeof llmCall).toBe('function');
  });

  it('forwards role:judge so the backend targets the judge model', async () => {
    await llmCall({
      messages: [{ role: 'user', content: 'x' }],
      projectPath: '/p',
      role: 'judge',
    });
    expect(invoke).toHaveBeenCalledWith('llm_call', {
      request: expect.objectContaining({ role: 'judge' }),
    });
  });

  it('omits role by default (uses the implementer model)', async () => {
    await llmCall({ messages: [{ role: 'user', content: 'x' }], projectPath: '/p' });
    const arg = vi.mocked(invoke).mock.calls[0][1] as { request: { role?: string } };
    expect(arg.request.role).toBeUndefined();
  });
});
