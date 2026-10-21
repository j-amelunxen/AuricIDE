import { describe, expect, it } from 'vitest';
import type { GitRef, GitRefs } from '@/lib/tauri/gitGraph';
import { orderRefsForRow, refAriaLabel, refsByOid, rowAriaLabel } from './graphRefs';

const ref = (
  shorthand: string,
  kind: GitRef['kind'],
  target = 'c1',
  isCurrent = false
): GitRef => ({
  name: shorthand,
  shorthand,
  kind,
  target,
  upstream: null,
  ahead: null,
  behind: null,
  isCurrent,
});

describe('orderRefsForRow', () => {
  it('puts the current branch first, then local, remote and tags by name', () => {
    const ordered = orderRefsForRow([
      ref('v1', 'tag'),
      ref('origin/main', 'remote'),
      ref('zeta', 'local'),
      ref('alpha', 'local'),
      ref('main', 'local', 'c1', true),
    ]);
    expect(ordered.map((r) => r.shorthand)).toEqual(['main', 'alpha', 'zeta', 'origin/main', 'v1']);
  });
});

describe('refsByOid', () => {
  const refs = (headDetached: boolean): GitRefs => ({
    refs: [ref('HEAD', 'head', 'c1'), ref('main', 'local', 'c1', true), ref('v1', 'tag', 'c2')],
    headDetached,
    headOid: 'c1',
    operation: 'none',
  });

  it('groups refs by the commit they point at', () => {
    const map = refsByOid(refs(false));
    expect(map.get('c2')?.map((r) => r.shorthand)).toEqual(['v1']);
  });

  it('shows the HEAD marker only while HEAD is detached', () => {
    expect(
      refsByOid(refs(false))
        .get('c1')
        ?.map((r) => r.shorthand)
    ).toEqual(['main']);
    expect(
      refsByOid(refs(true))
        .get('c1')
        ?.map((r) => r.shorthand)
    ).toEqual(['main', 'HEAD']);
  });

  it('is empty before refs have loaded', () => {
    expect(refsByOid(null).size).toBe(0);
  });
});

describe('refAriaLabel', () => {
  it('names the kind and marks the current branch', () => {
    expect(refAriaLabel(ref('main', 'local', 'c1', true))).toBe('branch main, current');
    expect(refAriaLabel(ref('origin/main', 'remote'))).toBe('remote origin/main');
    expect(refAriaLabel(ref('v1', 'tag'))).toBe('tag v1');
    expect(refAriaLabel(ref('HEAD', 'head'))).toBe('HEAD');
  });
});

describe('rowAriaLabel', () => {
  it('reads summary, author, date and refs', () => {
    expect(
      rowAriaLabel('Fix login', 'Ada', '3 h ago', [ref('main', 'local'), ref('v1', 'tag')])
    ).toBe('Fix login, Ada, 3 h ago, branch main, tag v1');
  });
  it('leaves refs out when there are none', () => {
    expect(rowAriaLabel('Fix', 'Ada', 'now', [])).toBe('Fix, Ada, now');
  });
});
