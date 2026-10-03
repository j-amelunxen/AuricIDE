import { describe, expect, it } from 'vitest';
import { DOCK_MAX, applyDockPlace, dockPlaceNextTo, splitDock } from './dock';

const p = (path: string, dockIndex?: number) => ({ path, name: path, dockIndex });

describe('splitDock', () => {
  it('puts docked projects in dock order and leaves the rest in input order', () => {
    const { dock, rest } = splitDock([p('/a'), p('/b', 1), p('/c', 0), p('/d')]);
    expect(dock.map((x) => x.path)).toEqual(['/c', '/b']);
    expect(rest.map((x) => x.path)).toEqual(['/a', '/d']);
  });

  it('is not moved by the order of the input', () => {
    const one = splitDock([p('/b', 1), p('/c', 0)]).dock.map((x) => x.path);
    const two = splitDock([p('/c', 0), p('/b', 1)]).dock.map((x) => x.path);
    expect(one).toEqual(two);
  });

  it('reports a full dock', () => {
    const projects = Array.from({ length: DOCK_MAX }, (_, i) => p(`/p${i}`, i));
    expect(splitDock(projects).full).toBe(true);
    expect(splitDock(projects.slice(1)).full).toBe(false);
  });
});

describe('dockPlaceNextTo', () => {
  const dock = ['/a', '/b', '/c'];

  it('drops a newcomer before or after a docked tile', () => {
    expect(dockPlaceNextTo(dock, '/x', '/b', 'before')).toBe(1);
    expect(dockPlaceNextTo(dock, '/x', '/b', 'after')).toBe(2);
  });

  it('moves a docked tile to its place among the others', () => {
    expect(dockPlaceNextTo(dock, '/a', '/c', 'after')).toBe(2);
    expect(dockPlaceNextTo(dock, '/c', '/a', 'before')).toBe(0);
  });

  it('appends when the target is not in the dock', () => {
    expect(dockPlaceNextTo(dock, '/x', null, 'after')).toBe(3);
  });
});

describe('applyDockPlace', () => {
  const order = (projects: { path: string; dockIndex?: number }[]) =>
    splitDock(projects).dock.map((x) => `${x.path}:${x.dockIndex}`);

  it('docks at a place and renumbers', () => {
    let list = [p('/a'), p('/b'), p('/c')];
    list = applyDockPlace(list, '/a', 0);
    list = applyDockPlace(list, '/b', 1);
    list = applyDockPlace(list, '/c', 0);
    expect(order(list)).toEqual(['/c:0', '/a:1', '/b:2']);
  });

  it('takes a project out and closes the gap', () => {
    let list = [p('/a', 0), p('/b', 1), p('/c', 2)];
    list = applyDockPlace(list, '/a', null);
    expect(order(list)).toEqual(['/b:0', '/c:1']);
    expect(list[0].dockIndex).toBeUndefined();
  });

  it('refuses a newcomer when full but still reorders', () => {
    let list = Array.from({ length: DOCK_MAX + 1 }, (_, i) =>
      p(`/p${i}`, i < DOCK_MAX ? i : undefined)
    );
    expect(applyDockPlace(list, `/p${DOCK_MAX}`, 0)).toBe(list);
    list = applyDockPlace(list, `/p${DOCK_MAX - 1}`, 0);
    expect(splitDock(list).dock[0].path).toBe(`/p${DOCK_MAX - 1}`);
  });
});
