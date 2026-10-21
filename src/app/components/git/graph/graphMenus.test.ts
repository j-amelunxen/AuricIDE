import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuOption } from '@/app/components/ide/ContextMenu';
import type { GitOperationName, GitRef, GitRefs } from '@/lib/tauri/gitGraph';
import {
  buildCombinedMenu,
  buildCommitMenu,
  buildRefMenu,
  type GraphMenuActions,
} from './graphMenus';

const ref = (over: Partial<GitRef> & Pick<GitRef, 'shorthand' | 'kind'>): GitRef => ({
  name: `refs/${over.kind}/${over.shorthand}`,
  target: 'c1',
  upstream: null,
  ahead: null,
  behind: null,
  isCurrent: false,
  ...over,
});

const refsOf = (over: Partial<GitRefs> = {}): GitRefs => ({
  refs: [],
  headDetached: false,
  headOid: 'head',
  operation: 'none',
  ...over,
});

const actions = (): GraphMenuActions => ({
  checkoutRef: vi.fn(),
  checkoutCommit: vi.fn(),
  newBranch: vi.fn(),
  newTag: vi.fn(),
  cherryPick: vi.fn(),
  revert: vi.fn(),
  renameBranch: vi.fn(),
  deleteBranch: vi.fn(),
  deleteTag: vi.fn(),
  copy: vi.fn(),
});

type MenuItem = Exclude<ContextMenuOption, { type: 'separator' } | { type: 'header' }>;
const items = (options: ContextMenuOption[]) =>
  options.filter((o): o is MenuItem => o.type !== 'separator' && o.type !== 'header');
const labels = (options: ContextMenuOption[]) => items(options).map((o) => o.label);
const find = (options: ContextMenuOption[], label: string) =>
  items(options).find((o) => o.label === label)!;

const commit = { oid: 'c1', summary: 'Fix login' };

describe('buildCommitMenu', () => {
  it('offers the commit operations in contract order, with ellipsis on those that open a sheet', () => {
    const menu = buildCommitMenu(commit, { refs: refsOf(), busy: null }, actions());
    expect(labels(menu)).toEqual([
      'Check Out (detached)…',
      'New Branch…',
      'New Tag…',
      'Cherry-Pick…',
      'Revert…',
      'Copy SHA',
      'Copy Summary',
    ]);
  });

  it('runs the matching action with the commit', () => {
    const a = actions();
    const menu = buildCommitMenu(commit, { refs: refsOf(), busy: null }, a);
    find(menu, 'Revert…').action?.();
    find(menu, 'Copy SHA').action?.();
    expect(a.revert).toHaveBeenCalledWith(commit);
    expect(a.copy).toHaveBeenCalledWith('c1', 'SHA');
  });

  it.each<[GitOperationName, string]>([
    ['cherry-pick', 'Finish the cherry-pick first'],
    ['revert', 'Finish the revert first'],
    ['merge', 'Finish the merge first'],
    ['rebase', 'Finish the rebase first'],
    ['other', 'Finish the running operation first'],
  ])('disables every write while a %s is open', (operation, reason) => {
    const menu = buildCommitMenu(commit, { refs: refsOf({ operation }), busy: null }, actions());
    for (const label of [
      'Check Out (detached)…',
      'New Branch…',
      'New Tag…',
      'Cherry-Pick…',
      'Revert…',
    ]) {
      expect(find(menu, label).disabledReason).toBe(reason);
    }
    expect(find(menu, 'Copy SHA').disabledReason).toBeUndefined();
  });

  it('disables writes while this tab runs an operation', () => {
    const menu = buildCommitMenu(commit, { refs: refsOf(), busy: 'Checking out' }, actions());
    expect(find(menu, 'New Tag…').disabledReason).toBe('Wait for the running operation to finish');
  });

  it('does not offer a detached checkout of the commit HEAD is already on', () => {
    const menu = buildCommitMenu(
      commit,
      { refs: refsOf({ headDetached: true, headOid: 'c1' }), busy: null },
      actions()
    );
    expect(find(menu, 'Check Out (detached)…').disabledReason).toBe(
      'HEAD is already on this commit'
    );
  });
});

describe('buildRefMenu', () => {
  const ctx = { refs: refsOf(), busy: null };

  it('gives a local branch Check Out, Rename and Delete', () => {
    const menu = buildRefMenu(ref({ shorthand: 'feature', kind: 'local' }), ctx, actions());
    expect(labels(menu)).toEqual(['Check Out', 'Rename…', 'Delete…', 'Copy Name']);
    expect(find(menu, 'Delete…').danger).toBe(true);
  });

  it('disables Check Out and Delete on the current branch, with the reason', () => {
    const menu = buildRefMenu(
      ref({ shorthand: 'main', kind: 'local', isCurrent: true }),
      ctx,
      actions()
    );
    expect(find(menu, 'Check Out').disabledReason).toBe('You are on this branch');
    expect(find(menu, 'Delete…').disabledReason).toBe('You are on this branch');
    expect(find(menu, 'Rename…').disabledReason).toBeUndefined();
  });

  it('gives a remote branch only Check Out as Local Branch and Copy Name', () => {
    const menu = buildRefMenu(ref({ shorthand: 'origin/dev', kind: 'remote' }), ctx, actions());
    expect(labels(menu)).toEqual(['Check Out as Local Branch', 'Copy Name']);
  });

  it('gives a tag Delete Tag and Copy Name', () => {
    const a = actions();
    const tag = ref({ shorthand: 'v1.0', kind: 'tag' });
    const menu = buildRefMenu(tag, ctx, a);
    expect(labels(menu)).toEqual(['Delete Tag…', 'Copy Name']);
    find(menu, 'Delete Tag…').action?.();
    expect(a.deleteTag).toHaveBeenCalledWith(tag);
  });

  it('blocks writes during an operation but keeps Copy Name', () => {
    const menu = buildRefMenu(
      ref({ shorthand: 'v1.0', kind: 'tag' }),
      { refs: refsOf({ operation: 'cherry-pick' }), busy: null },
      actions()
    );
    expect(find(menu, 'Delete Tag…').disabledReason).toBe('Finish the cherry-pick first');
    expect(find(menu, 'Copy Name').disabledReason).toBeUndefined();
  });
});

describe('buildCombinedMenu', () => {
  const ctx = { refs: refsOf(), busy: null };

  it('is just the commit menu for a commit without refs', () => {
    expect(labels(buildCombinedMenu(commit, [], ctx, actions()))).toEqual(
      labels(buildCommitMenu(commit, ctx, actions()))
    );
  });

  it('adds one headed section per ref after the commit items, for keyboard users', () => {
    const main = ref({ shorthand: 'main', kind: 'local', isCurrent: true });
    const tag = ref({ shorthand: 'v1', kind: 'tag' });
    const menu = buildCombinedMenu(commit, [main, tag], ctx, actions());
    const headers = menu
      .filter((o) => o.type === 'header')
      .map((o) => (o as { label: string }).label);
    expect(headers).toEqual(['Branch main', 'Tag v1']);
    expect(labels(menu)).toContain('Rename…');
    expect(labels(menu)).toContain('Delete Tag…');
  });
});
