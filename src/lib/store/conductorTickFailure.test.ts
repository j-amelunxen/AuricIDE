import { describe, expect, it, vi } from 'vitest';

vi.mock('./conductor/conductorTick', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./conductor/conductorTick')>()),
  executeConductorTick: vi.fn(async () => {
    throw new Error('tickets table is locked');
  }),
}));

const { createTestStore } = await import('./testing');

describe('a conductor step that throws', () => {
  it('becomes one fail decision instead of a silent rejection, however often it repeats', async () => {
    const store = createTestStore();

    await expect(store.getState().conductorTick()).resolves.toBeUndefined();
    await store.getState().conductorTick();

    expect(store.getState().conductorDecisions).toEqual([
      expect.objectContaining({
        action: 'fail',
        detail: 'Conductor step failed: tickets table is locked',
      }),
    ]);
  });
});
