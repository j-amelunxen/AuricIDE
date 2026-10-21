import type { ContextMenuOption } from '@/app/components/ide/ContextMenu';
import type { GitRef, GitRefs } from '@/lib/tauri/gitGraph';

export interface MenuCommit {
  oid: string;
  summary: string;
}

export interface GraphMenuContext {
  refs: GitRefs | null;
  /** Label of the operation this tab is running, or null. */
  busy: string | null;
}

export interface GraphMenuActions {
  checkoutRef: (ref: GitRef) => void;
  checkoutCommit: (commit: MenuCommit) => void;
  newBranch: (commit: MenuCommit) => void;
  newTag: (commit: MenuCommit) => void;
  cherryPick: (commit: MenuCommit) => void;
  revert: (commit: MenuCommit) => void;
  renameBranch: (ref: GitRef) => void;
  deleteBranch: (ref: GitRef) => void;
  deleteTag: (ref: GitRef) => void;
  copy: (text: string, what: string) => void;
}

const ON_CURRENT_BRANCH = 'You are on this branch';
const OPERATION_RUNNING = 'Wait for the running operation to finish';

/** The reason every write is unavailable right now, or undefined when writes may run. */
export function writeBlockedReason({ refs, busy }: GraphMenuContext): string | undefined {
  if (busy) return OPERATION_RUNNING;
  const operation = refs?.operation ?? 'none';
  if (operation === 'none') return undefined;
  return `Finish the ${operation === 'other' ? 'running operation' : operation} first`;
}

type Item = Exclude<ContextMenuOption, { type: 'separator' } | { type: 'header' }>;

const item = (label: string, action: () => void, extra: Partial<Item> = {}): Item => ({
  label,
  action,
  ...extra,
});

export function buildCommitMenu(
  commit: MenuCommit,
  ctx: GraphMenuContext,
  actions: GraphMenuActions
): ContextMenuOption[] {
  const blocked = writeBlockedReason(ctx);
  const alreadyHere =
    ctx.refs?.headDetached && ctx.refs.headOid === commit.oid
      ? 'HEAD is already on this commit'
      : undefined;
  return [
    item('Check Out (detached)…', () => actions.checkoutCommit(commit), {
      disabledReason: blocked ?? alreadyHere,
    }),
    item('New Branch…', () => actions.newBranch(commit), { disabledReason: blocked }),
    item('New Tag…', () => actions.newTag(commit), { disabledReason: blocked }),
    { type: 'separator' },
    item('Cherry-Pick…', () => actions.cherryPick(commit), { disabledReason: blocked }),
    item('Revert…', () => actions.revert(commit), { disabledReason: blocked }),
    { type: 'separator' },
    item('Copy SHA', () => actions.copy(commit.oid, 'SHA')),
    item('Copy Summary', () => actions.copy(commit.summary, 'summary')),
  ];
}

export function buildRefMenu(
  ref: GitRef,
  ctx: GraphMenuContext,
  actions: GraphMenuActions
): ContextMenuOption[] {
  const blocked = writeBlockedReason(ctx);
  const copyName = item('Copy Name', () => actions.copy(ref.shorthand, 'name'));

  if (ref.kind === 'local') {
    const here = ref.isCurrent ? ON_CURRENT_BRANCH : undefined;
    return [
      item('Check Out', () => actions.checkoutRef(ref), { disabledReason: blocked ?? here }),
      item('Rename…', () => actions.renameBranch(ref), { disabledReason: blocked }),
      item('Delete…', () => actions.deleteBranch(ref), {
        danger: true,
        disabledReason: blocked ?? here,
      }),
      { type: 'separator' },
      copyName,
    ];
  }
  if (ref.kind === 'remote') {
    return [
      item('Check Out as Local Branch', () => actions.checkoutRef(ref), {
        disabledReason: blocked,
      }),
      { type: 'separator' },
      copyName,
    ];
  }
  if (ref.kind === 'tag') {
    return [
      item('Delete Tag…', () => actions.deleteTag(ref), { danger: true, disabledReason: blocked }),
      { type: 'separator' },
      copyName,
    ];
  }
  return [copyName];
}

const REF_KIND_WORD: Record<GitRef['kind'], string> = {
  local: 'Branch',
  remote: 'Remote',
  tag: 'Tag',
  head: 'HEAD',
};

/**
 * The commit menu followed by one headed section per ref on it. Pills cannot
 * take keyboard focus, so this is how a keyboard user reaches a ref's actions.
 */
export function buildCombinedMenu(
  commit: MenuCommit,
  refs: GitRef[],
  ctx: GraphMenuContext,
  actions: GraphMenuActions
): ContextMenuOption[] {
  const sections = refs.flatMap((ref): ContextMenuOption[] => [
    { type: 'separator' },
    { type: 'header', label: `${REF_KIND_WORD[ref.kind]} ${ref.shorthand}` },
    ...buildRefMenu(ref, ctx, actions).filter((o) => o.type !== 'separator'),
  ]);
  return [...buildCommitMenu(commit, ctx, actions), ...sections];
}
