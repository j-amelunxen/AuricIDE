import { describe, expect, it } from 'vitest';
import type { DependencyReport } from '@/lib/tauri/machine';
import { dependencyView, neededBy } from './dependencyView';

const report = (patch: Partial<DependencyReport>): DependencyReport => ({
  id: 'okf',
  label: 'okf',
  ok: true,
  found: '0.7.0',
  requirement: 'okf 0.7.0 or newer',
  detail: 'Found.',
  fix: null,
  features: [],
  version: '0.7.0',
  path: '/usr/local/bin/okf',
  outsidePath: false,
  ...patch,
});

describe('dependencyView', () => {
  it('reads a tool on PATH as found, with the structured version and path', () => {
    expect(dependencyView(report({}))).toEqual({
      state: 'found',
      version: '0.7.0',
      path: '/usr/local/bin/okf',
    });
  });

  it('says where a tool was found when it is not on PATH, and that is not a failure', () => {
    const view = dependencyView(report({ outsidePath: true, path: '/Users/dev/go/bin/okf' }));
    expect(view).toEqual({
      state: 'outside-path',
      version: '0.7.0',
      path: '/Users/dev/go/bin/okf',
    });
  });

  it('does not read the display string: rewording `found` changes nothing', () => {
    expect(dependencyView(report({ found: 'whatever Rust says today' })).state).toBe('found');
  });

  it('keeps the path when the version could not be read', () => {
    expect(dependencyView(report({ version: null }))).toMatchObject({
      state: 'found',
      version: null,
      path: '/usr/local/bin/okf',
    });
  });

  it('reads a missing tool as calm information, not a problem', () => {
    expect(
      dependencyView(report({ ok: false, found: null, version: null, path: null, fix: 'x' }))
    ).toEqual({ state: 'missing', version: null, path: null });
  });

  it('reads a tool that is there but unusable as a problem', () => {
    expect(dependencyView(report({ ok: false, found: '0.5.0', version: '0.5.0' }))).toEqual({
      state: 'problem',
      version: '0.5.0',
      path: '/usr/local/bin/okf',
    });
  });
});

describe('neededBy', () => {
  it.each([
    [[], null],
    [['Video import'], 'Video import'],
    [['Video import', 'okf'], 'Video import and okf'],
    [['a', 'b', 'c'], 'a, b and c'],
  ])('%j -> %j', (features, expected) => {
    expect(neededBy(features)).toBe(expected);
  });
});
