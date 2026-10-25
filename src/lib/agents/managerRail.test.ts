import { describe, expect, it } from 'vitest';
import {
  managerActivityMs,
  managerFolderFirst,
  mostRecentManagerKey,
  type ManagerRecency,
} from './managerRail';
import type { RunTreeNode } from './supervisorRuns';

const at = (iso: string) => Date.parse(iso);

describe('managerActivityMs', () => {
  it('takes the newest of the last launch, the session and the folder', () => {
    expect(
      managerActivityMs(
        {
          lastLaunch: { at: '2026-10-20T10:00:00Z', instructionsSha256: 'x' },
          session: { startedAt: '2026-10-21T10:00:00Z', notedAt: '2026-10-22T10:00:00Z' },
        },
        at('2026-10-19T10:00:00Z')
      )
    ).toBe(at('2026-10-22T10:00:00Z'));
  });

  it('lets a folder written to after the last session win', () => {
    expect(
      managerActivityMs(
        { lastLaunch: { at: '2026-10-20T10:00:00Z', instructionsSha256: 'x' } },
        at('2026-10-23T08:00:00Z')
      )
    ).toBe(at('2026-10-23T08:00:00Z'));
  });

  it('ignores timestamps that do not parse', () => {
    expect(
      managerActivityMs(
        { lastLaunch: { at: 'not a date', instructionsSha256: 'x' }, session: null },
        null
      )
    ).toBeNull();
  });

  it('is null for a manager that never ran and has no folder time', () => {
    expect(managerActivityMs({ lastLaunch: null }, null)).toBeNull();
  });
});

describe('mostRecentManagerKey', () => {
  const entry = (over: Partial<ManagerRecency>): ManagerRecency => ({
    key: 'a',
    name: 'A',
    running: false,
    activityMs: null,
    ...over,
  });

  it('has none without managers', () => {
    expect(mostRecentManagerKey([])).toBeNull();
  });

  it('picks a running manager over one used more recently', () => {
    expect(
      mostRecentManagerKey([
        entry({ key: 'fresh', name: 'Fresh', activityMs: 500 }),
        entry({ key: 'live', name: 'Live', running: true, activityMs: 100 }),
      ])
    ).toBe('live');
  });

  it('among running managers, picks the one used last', () => {
    expect(
      mostRecentManagerKey([
        entry({ key: 'one', name: 'One', running: true, activityMs: 100 }),
        entry({ key: 'two', name: 'Two', running: true, activityMs: 200 }),
      ])
    ).toBe('two');
  });

  it('otherwise picks the newest activity, with unknown times last', () => {
    expect(
      mostRecentManagerKey([
        entry({ key: 'never', name: 'Aaa' }),
        entry({ key: 'old', name: 'Old', activityMs: 100 }),
        entry({ key: 'new', name: 'New', activityMs: 300 }),
      ])
    ).toBe('new');
  });

  it('breaks a tie by name, as the rail sorts, so the choice does not flicker', () => {
    expect(
      mostRecentManagerKey([
        entry({ key: 'z', name: 'zeta', activityMs: 100 }),
        entry({ key: 'b', name: 'Beta', activityMs: 100 }),
      ])
    ).toBe('b');
  });
});

describe('managerFolderFirst', () => {
  const file = (name: string): RunTreeNode => ({
    kind: 'file',
    name,
    path: `/run/${name}`,
    modifiedAtMs: 1,
  });
  const folder = (name: string, children: RunTreeNode[] = []): RunTreeNode => ({
    kind: 'folder',
    name,
    key: name,
    modifiedAtMs: 1,
    children,
  });

  it('puts the instructions, then the memory folder, before everything else', () => {
    const tree = [
      file('notes.md'),
      folder('logs'),
      folder('knowledge'),
      file('INSTRUCTIONS.md'),
      file('supervisor.json'),
    ];
    expect(managerFolderFirst(tree).map((node) => node.name)).toEqual([
      'INSTRUCTIONS.md',
      'knowledge',
      'notes.md',
      'supervisor.json',
      'logs',
    ]);
  });

  it('lists files before subfolders at every level, keeping each group in its order', () => {
    const tree = [
      folder('knowledge', [
        folder('decisions', [folder('old'), file('use-x.md')]),
        file('index.md'),
        folder('sessions'),
        file('log.md'),
      ]),
    ];
    const [knowledge] = managerFolderFirst(tree);
    const children = knowledge.kind === 'folder' ? knowledge.children : [];
    expect(children.map((node) => node.name)).toEqual([
      'index.md',
      'log.md',
      'decisions',
      'sessions',
    ]);
    const decisions = children[2];
    expect(decisions.kind === 'folder' && decisions.children.map((node) => node.name)).toEqual([
      'use-x.md',
      'old',
    ]);
  });

  it('leaves a folder without them as it was, and does not touch the input', () => {
    const tree = [file('b.md'), file('a.md')];
    const result = managerFolderFirst(tree);
    expect(result.map((node) => node.name)).toEqual(['b.md', 'a.md']);
    expect(result).not.toBe(tree);
  });

  it('does not lift a file merely named like the memory folder', () => {
    const tree = [file('x.md'), file('knowledge')];
    expect(managerFolderFirst(tree).map((node) => node.name)).toEqual(['x.md', 'knowledge']);
  });
});
