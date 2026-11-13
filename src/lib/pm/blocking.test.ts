import { describe, expect, it } from 'vitest';
import { blockingTicket } from './blocking';
import { priorityUrgency } from './enums';
import type { PmDependency, PmTicket } from './types';

const ticket = (id: string, status: string): PmTicket => ({ id, status }) as PmTicket;
const dependsOn = (sourceId: string, targetId: string): PmDependency =>
  ({
    id: `${sourceId}-${targetId}`,
    sourceId,
    sourceType: 'ticket',
    targetId,
    targetType: 'ticket',
  }) as PmDependency;

describe('blockingTicket', () => {
  const tickets = new Map(
    [
      ticket('a', 'open'),
      ticket('b', 'in_progress'),
      ticket('c', 'done'),
      ticket('d', 'discarded'),
    ].map((t) => [t.id, t])
  );

  it('names a live target and ignores closed ones', () => {
    expect(
      blockingTicket({ id: 'a' }, [dependsOn('a', 'c'), dependsOn('a', 'b')], tickets)?.id
    ).toBe('b');
    expect(
      blockingTicket({ id: 'a' }, [dependsOn('a', 'c'), dependsOn('a', 'd')], tickets)
    ).toBeNull();
  });
});

describe('priorityUrgency', () => {
  it('orders critical first and reads an unknown value as normal', () => {
    expect(
      ['low', 'critical', 'normal', 'high'].sort((x, y) => priorityUrgency(y) - priorityUrgency(x))
    ).toEqual(['critical', 'high', 'normal', 'low']);
    expect(priorityUrgency('urgent')).toBe(priorityUrgency('normal'));
  });
});
