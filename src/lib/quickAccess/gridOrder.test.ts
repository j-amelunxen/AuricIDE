import { describe, expect, it } from 'vitest';
import { moveGridTile, parseGridOrder, serializeGridOrder } from './gridOrder';

describe('moveGridTile', () => {
  const visible = ['/a', '/b', '/c'];

  it('puts the dragged tile before or after the target', () => {
    expect(moveGridTile(visible, '/c', '/a', 'before')).toEqual(['/c', '/a', '/b']);
    expect(moveGridTile(visible, '/a', '/c', 'after')).toEqual(['/b', '/c', '/a']);
  });

  it('takes in a tile that was not in the grid yet, such as one coming out of the dock', () => {
    expect(moveGridTile(visible, '/d', '/b', 'before')).toEqual(['/a', '/d', '/b', '/c']);
  });

  it('leaves the order alone when a tile is dropped on itself', () => {
    expect(moveGridTile(visible, '/b', '/b', 'after')).toEqual(visible);
  });
});

describe('grid order storage', () => {
  it('round-trips a list of paths', () => {
    expect(parseGridOrder(serializeGridOrder(['/a', '/b']))).toEqual(['/a', '/b']);
  });

  it('reads anything unusable as an empty order', () => {
    expect(parseGridOrder(null)).toEqual([]);
    expect(parseGridOrder('{oops')).toEqual([]);
    expect(parseGridOrder('{"a":1}')).toEqual([]);
  });

  it('drops entries that are not strings and repeated paths', () => {
    expect(parseGridOrder('["/a",3,"/b","/a",null]')).toEqual(['/a', '/b']);
  });
});
