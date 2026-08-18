'use client';

import { useConfirm } from '@/lib/hooks/useConfirm';
import { worktreeIsOccupied } from '@/lib/git/agentWorktree';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export function AgentWorktreesPanel() {
  const worktrees = useStore((s) => s.agentWorktrees);
  const agents = useStore((s) => s.agents);
  const removeAgentWorktree = useStore((s) => s.removeAgentWorktree);
  const showToast = useStore((s) => s.showToast);
  const { confirm, confirmDialog } = useConfirm();

  if (worktrees.length === 0) return null;

  const handleRemove = async (path: string) => {
    const tree = worktrees.find((wt) => wt.path === path);
    if (!tree) return;
    if (worktreeIsOccupied(path, agents)) {
      showToast('Stop the agent in this worktree before removing it.', 'error');
      return;
    }
    const needsForce = tree.dirty || tree.branchAhead;
    const ok = await confirm({
      title: 'Remove worktree',
      message: needsForce
        ? `${tree.branch ?? tree.name} has uncommitted or unmerged work. Removing it deletes that checkout and the auric/ branch.`
        : `Remove ${tree.branch ?? tree.name}? The checkout and its auric/ branch will be deleted.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await removeAgentWorktree(path, needsForce);
      showToast('Worktree removed.');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showToast(`Could not remove worktree: ${detail}`, 'error');
    }
  };

  return (
    <div data-testid="agent-worktrees" className="border-t border-white/5 px-3 py-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
        Agent worktrees
      </h3>
      <ul className="flex flex-col gap-1.5">
        {worktrees.map((tree) => {
          const occupied = worktreeIsOccupied(tree.path, agents);
          return (
            <li
              key={tree.path}
              className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/20 px-2 py-1.5"
            >
              <AuricIcon name="account_tree" className="mt-0.5 text-sm text-foreground-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground">
                  {tree.branch ?? tree.name}
                </p>
                <p className="truncate text-[10px] text-foreground-muted">{tree.path}</p>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {occupied && (
                    <span className="rounded bg-primary/15 px-1 text-[9px] font-medium text-primary-light">
                      agent running
                    </span>
                  )}
                  {tree.dirty && (
                    <span className="rounded bg-amber-500/15 px-1 text-[9px] font-medium text-amber-400">
                      dirty
                    </span>
                  )}
                  {tree.branchAhead && (
                    <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-medium text-emerald-400">
                      has commits
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(tree.path)}
                disabled={occupied}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {confirmDialog}
    </div>
  );
}
