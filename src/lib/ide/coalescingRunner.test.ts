import { describe, expect, it } from 'vitest';
import { createCoalescingRunner } from './coalescingRunner';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createCoalescingRunner', () => {
  it('never runs two jobs at once and folds everything submitted meanwhile into one', async () => {
    const started: number[][] = [];
    const gates: Array<ReturnType<typeof deferred>> = [];
    const runner = createCoalescingRunner<number[]>(
      (batch) => {
        started.push(batch);
        const gate = deferred();
        gates.push(gate);
        return gate.promise;
      },
      (a, b) => [...a, ...b]
    );

    const first = runner.submit([1]);
    const second = runner.submit([2]);
    const third = runner.submit([3]);
    expect(started).toEqual([[1]]);

    gates[0].resolve();
    await first;
    await Promise.resolve();
    expect(started).toEqual([[1], [2, 3]]);

    gates[1].resolve();
    await Promise.all([second, third]);
    expect(started).toHaveLength(2);
  });

  it('keeps going after a failed run', async () => {
    const seen: string[] = [];
    const runner = createCoalescingRunner<string>(
      async (v) => {
        seen.push(v);
        if (v === 'bad') throw new Error('boom');
      },
      (_a, b) => b
    );
    await expect(runner.submit('bad')).rejects.toThrow('boom');
    await runner.submit('good');
    expect(seen).toEqual(['bad', 'good']);
  });
});
