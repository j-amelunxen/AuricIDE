import { describe, expect, it } from 'vitest';
import { resolveTauriInvoke } from './invoke';

describe('resolveTauriInvoke', () => {
  it('takes the named export', async () => {
    const invoke = async () => 'ok';
    const resolved = resolveTauriInvoke({ invoke });
    await expect(resolved?.('x')).resolves.toBe('ok');
  });

  it('falls back to the default export when the named one is missing', async () => {
    const invoke = async () => 'via-default';
    const resolved = resolveTauriInvoke({ default: { invoke } });
    await expect(resolved?.('x')).resolves.toBe('via-default');
  });

  it('returns null when the bridge is not a function', () => {
    expect(resolveTauriInvoke({})).toBeNull();
    expect(resolveTauriInvoke({ invoke: undefined })).toBeNull();
  });
});
