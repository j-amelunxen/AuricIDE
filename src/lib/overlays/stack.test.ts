import { describe, expect, it } from 'vitest';
import { hasLayer, ownsEscape, pop, push, remove, replace, top } from './stack';
import type { OverlayEntry, OverlayStack } from './stack';

const empty = (): OverlayStack => ({ layers: [] });
const tool = (id: string): OverlayEntry => ({ id, kind: 'tool' });
const confirm = (id: string): OverlayEntry => ({ id, kind: 'confirm' });

describe('push / top', () => {
  it('makes the last pushed layer the top', () => {
    const stack = push(push(empty(), tool('A')), tool('B'));

    expect(top(stack)).toEqual(tool('B'));
    expect(ownsEscape(stack, 'A')).toBe(false);
    expect(ownsEscape(stack, 'B')).toBe(true);
  });

  it('throws when the id is already on the stack', () => {
    const stack = push(empty(), tool('A'));

    expect(() => push(stack, tool('A'))).toThrow(/already on stack/i);
    expect(() => push(stack, confirm('A'))).toThrow(/already on stack/i);
  });

  it('does not mutate the input stack', () => {
    const original = empty();
    push(original, tool('A'));

    expect(original.layers).toEqual([]);
  });
});

describe('pop', () => {
  it('returns the previous layer as top', () => {
    const stack = pop(push(push(empty(), tool('A')), tool('B')));

    expect(top(stack)).toEqual(tool('A'));
    expect(ownsEscape(stack, 'A')).toBe(true);
    expect(ownsEscape(stack, 'B')).toBe(false);
  });

  it('leaves an empty stack empty', () => {
    const stack = pop(empty());

    expect(stack.layers).toEqual([]);
    expect(top(stack)).toBeNull();
  });
});

describe('replace', () => {
  it('swaps the top tool instead of stacking', () => {
    const stack = replace(push(empty(), tool('A')), tool('B'));

    expect(stack.layers).toEqual([tool('B')]);
    expect(top(stack)).toEqual(tool('B'));
    expect(ownsEscape(stack, 'A')).toBe(false);
    expect(ownsEscape(stack, 'B')).toBe(true);
  });

  it('replaces the tool beneath a confirm and leaves the confirm on top', () => {
    const withConfirm = push(push(empty(), tool('A')), confirm('ask'));
    const stack = replace(withConfirm, tool('B'));

    expect(stack.layers).toEqual([tool('B'), confirm('ask')]);
    expect(ownsEscape(stack, 'B')).toBe(false);
    expect(ownsEscape(stack, 'ask')).toBe(true);
  });

  it('does not replace a lone confirm', () => {
    const onlyConfirm = push(empty(), confirm('ask'));

    expect(replace(onlyConfirm, tool('B'))).toEqual(onlyConfirm);
    expect(ownsEscape(onlyConfirm, 'ask')).toBe(true);
  });
});

describe('confirm isolation', () => {
  it('gives Escape to the confirm, not the tool beneath', () => {
    const stack = push(push(empty(), tool('A')), confirm('ask'));

    expect(ownsEscape(stack, 'A')).toBe(false);
    expect(ownsEscape(stack, 'ask')).toBe(true);
  });

  it('returns Escape to the tool after the confirm is popped', () => {
    const stack = pop(push(push(empty(), tool('A')), confirm('ask')));

    expect(top(stack)).toEqual(tool('A'));
    expect(ownsEscape(stack, 'A')).toBe(true);
    expect(ownsEscape(stack, 'ask')).toBe(false);
  });
});

describe('ownsEscape', () => {
  it('is false for every id on an empty stack', () => {
    expect(ownsEscape(empty(), 'A')).toBe(false);
  });
});

describe('remove / hasLayer', () => {
  it('drops a layer by id even when it is not the top', () => {
    const stack = remove(push(push(empty(), tool('A')), tool('B')), 'A');

    expect(stack.layers).toEqual([tool('B')]);
    expect(hasLayer(stack, 'A')).toBe(false);
    expect(hasLayer(stack, 'B')).toBe(true);
    expect(ownsEscape(stack, 'B')).toBe(true);
  });

  it('is a no-op when the id is not on the stack', () => {
    const original = push(empty(), tool('A'));

    expect(remove(original, 'missing')).toEqual(original);
    expect(hasLayer(empty(), 'A')).toBe(false);
  });

  it('does not mutate the input stack', () => {
    const original = push(empty(), tool('A'));
    remove(original, 'A');

    expect(original.layers).toEqual([tool('A')]);
  });
});
