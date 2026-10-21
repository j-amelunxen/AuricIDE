import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { runGraphOperation } from './useGraphOperations';

const openMergeTabOrToast = vi.fn();
vi.mock('@/lib/ide/openMergeTab', () => ({
  openMergeTabOrToast: (...args: unknown[]) => openMergeTabOrToast(...args),
}));

const REPO = '/work/app';
const ok = async () => ({ ok: true as const });

function stubActions(over: Record<string, unknown> = {}) {
  useStore.setState({
    toasts: [],
    graphCheckout: vi.fn(ok),
    graphCreateBranch: vi.fn(ok),
    graphRenameBranch: vi.fn(ok),
    graphDeleteBranch: vi.fn(ok),
    graphCreateTag: vi.fn(ok),
    graphDeleteTag: vi.fn(ok),
    graphCherryPick: vi.fn(async () => ({
      ok: true as const,
      pick: { clean: true, conflicts: [], newOid: 'n1' },
    })),
    graphRevert: vi.fn(async () => ({
      ok: true as const,
      pick: { clean: true, conflicts: [], newOid: 'n1' },
    })),
    ...over,
  } as never);
}

const toasts = () => useStore.getState().toasts;

describe('runGraphOperation', () => {
  beforeEach(() => {
    openMergeTabOrToast.mockClear();
    stubActions();
  });

  it('checks out, says so, and reports that HEAD moved', async () => {
    const onHeadMoved = vi.fn();
    const result = await runGraphOperation(
      REPO,
      { kind: 'checkout', target: 'refs/heads/main', label: 'main' },
      onHeadMoved
    );
    expect(useStore.getState().graphCheckout).toHaveBeenCalledWith(REPO, 'refs/heads/main');
    expect(result.ok).toBe(true);
    expect(toasts().map((t) => [t.message, t.variant])).toEqual([['Checked out main', 'success']]);
    expect(onHeadMoved).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal as its mapped title and sentence, and does not move HEAD', async () => {
    stubActions({
      graphCheckout: vi.fn(async () => ({
        ok: false as const,
        code: 'would_overwrite',
        message: 'Local changes to a.ts would be overwritten.',
      })),
    });
    const onHeadMoved = vi.fn();
    await runGraphOperation(REPO, { kind: 'checkout', target: 't', label: 'main' }, onHeadMoved);
    expect(toasts()).toMatchObject([
      {
        message: 'Your changes are in the way. Local changes to a.ts would be overwritten.',
        variant: 'error',
      },
    ]);
    expect(onHeadMoved).not.toHaveBeenCalled();
  });

  it('answers an already applied pick calmly: the sentence alone, as info', async () => {
    stubActions({
      graphCherryPick: vi.fn(async () => ({
        ok: false as const,
        code: 'already_applied',
        message: 'This change is already on main. Nothing was picked.',
      })),
    });
    await runGraphOperation(REPO, { kind: 'cherry-pick', oid: 'c1', summary: 'S' }, vi.fn());
    expect(toasts()).toMatchObject([
      { message: 'This change is already on main. Nothing was picked.', variant: 'info' },
    ]);
  });

  it('leaves a not_merged refusal to the caller, who asks for a second confirmation', async () => {
    stubActions({
      graphDeleteBranch: vi.fn(async () => ({
        ok: false as const,
        code: 'not_merged',
        message: 'x',
      })),
    });
    const result = await runGraphOperation(
      REPO,
      { kind: 'branch-delete', name: 'f', force: false },
      vi.fn()
    );
    expect(result).toMatchObject({ ok: false, code: 'not_merged' });
    expect(toasts()).toEqual([]);
  });

  it('still reports a not_merged refusal when the delete was forced', async () => {
    stubActions({
      graphDeleteBranch: vi.fn(async () => ({
        ok: false as const,
        code: 'not_merged',
        message: 'Still not merged.',
      })),
    });
    await runGraphOperation(REPO, { kind: 'branch-delete', name: 'f', force: true }, vi.fn());
    expect(toasts()).toHaveLength(1);
  });

  it('moves HEAD for a new branch only when it was checked out', async () => {
    const onHeadMoved = vi.fn();
    await runGraphOperation(
      REPO,
      { kind: 'branch-create', name: 'a', atOid: 'c1', checkout: false },
      onHeadMoved
    );
    expect(onHeadMoved).not.toHaveBeenCalled();
    await runGraphOperation(
      REPO,
      { kind: 'branch-create', name: 'b', atOid: 'c1', checkout: true },
      onHeadMoved
    );
    expect(onHeadMoved).toHaveBeenCalledTimes(1);
    expect(useStore.getState().graphCreateBranch).toHaveBeenLastCalledWith(REPO, 'b', 'c1', true);
  });

  it('sends no message for a lightweight tag', async () => {
    await runGraphOperation(
      REPO,
      { kind: 'tag-create', name: 'v1', oid: 'c1', message: '' },
      vi.fn()
    );
    expect(useStore.getState().graphCreateTag).toHaveBeenCalledWith(REPO, 'v1', 'c1', undefined);
  });

  it('reports a clean cherry-pick and moves HEAD', async () => {
    const onHeadMoved = vi.fn();
    await runGraphOperation(
      REPO,
      { kind: 'cherry-pick', oid: 'c1', summary: 'Fix login' },
      onHeadMoved
    );
    expect(toasts()[0]).toMatchObject({ message: 'Cherry-picked “Fix login”', variant: 'success' });
    expect(onHeadMoved).toHaveBeenCalledTimes(1);
  });

  it('turns a conflicting cherry-pick into a toast that opens the merge panel', async () => {
    stubActions({
      graphCherryPick: vi.fn(async () => ({
        ok: true as const,
        pick: { clean: false, conflicts: ['a.ts', 'b.ts'], newOid: null },
      })),
    });
    const onHeadMoved = vi.fn();
    await runGraphOperation(REPO, { kind: 'cherry-pick', oid: 'c1', summary: 'S' }, onHeadMoved);
    const [toast] = toasts();
    expect(toast.message).toBe('Cherry-pick stopped on 2 conflicts');
    expect(toast.action?.label).toBe('Open Merge Panel');
    toast.action?.run();
    expect(openMergeTabOrToast).toHaveBeenCalledWith(REPO, 'a.ts');
    expect(onHeadMoved).not.toHaveBeenCalled();
  });

  it('uses the singular for one conflicting file in a revert', async () => {
    stubActions({
      graphRevert: vi.fn(async () => ({
        ok: true as const,
        pick: { clean: false, conflicts: ['a.ts'], newOid: null },
      })),
    });
    await runGraphOperation(REPO, { kind: 'revert', oid: 'c1', summary: 'S' }, vi.fn());
    expect(toasts()[0].message).toBe('Revert stopped on 1 conflict');
  });
});
