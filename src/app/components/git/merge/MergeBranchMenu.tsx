'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import { listGitBranches, type GitBranch } from '@/lib/tauri/git';
import { previewMerge, type GitMergePreview, type GitMergeStartResult } from '@/lib/tauri/gitMerge';
import { pluralize, previewSummary } from './mergeCopy';
import { openMergeTabOrToast } from '@/lib/ide/openMergeTab';

const MENU_WIDTH = 256;
const VIEWPORT_GAP = 8;

interface MenuPlace {
  top: number;
  left: number;
  width: number;
}

/**
 * Where the menu sits: under the trigger, right edges aligned, kept inside the
 * window. It is portalled to the body, because the Source Control sidebar
 * clips anything that overflows it.
 */
export function menuPlaceFor(
  trigger: Pick<HTMLElement, 'getBoundingClientRect'> | null,
  viewportWidth: number = typeof window === 'undefined' ? 1024 : window.innerWidth
): MenuPlace | null {
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(MENU_WIDTH, viewportWidth - VIEWPORT_GAP * 2);
  const left = Math.min(
    Math.max(rect.right - width, VIEWPORT_GAP),
    viewportWidth - width - VIEWPORT_GAP
  );
  return { top: rect.bottom + 4, left, width };
}

export interface MergeBranchMenuProps {
  repoPath: string;
  /** HEAD's branch, for the copy. `null` when detached or not loaded yet. */
  currentBranch: string | null;
  /** A section header already names the branch: the trigger then just says "Merge…". */
  compact?: boolean;
}

/** The toast that says what `git merge <branch>` did; conflicts open the first file instead. */
export function mergeOutcomeMessage(
  result: GitMergeStartResult,
  branch: string,
  head: string
): { text: string; variant: 'info' | 'success' } {
  switch (result.outcome) {
    case 'up-to-date':
      return { text: `${head} already contains ${branch}. Nothing to merge.`, variant: 'info' };
    case 'fast-forward':
      return { text: `Fast-forwarded ${head} to ${branch}.`, variant: 'success' };
    case 'merged':
      return { text: `Merged ${branch} into ${head}.`, variant: 'success' };
    case 'conflicts':
      return {
        text: `${pluralize(result.conflicts.length, 'file conflicts', 'files conflict')}. Opening the first one.`,
        variant: 'info',
      };
  }
}

/** Long enough that arrowing through the list does not preview every branch it passes. */
const PREVIEW_DELAY_MS = 150;
const CONFIRM_FILES = 8;

/** The confirm before a merge the preview says will conflict: every file it names, up to a few. */
export function conflictConfirmMessage(preview: GitMergePreview): string {
  const shown = preview.conflicts.slice(0, CONFIRM_FILES).join(', ');
  const more = preview.conflicts.length - CONFIRM_FILES;
  const files = pluralize(preview.conflicts.length, 'file', 'files');
  return `${files} will conflict: ${shown}${more > 0 ? ` and ${more} more` : ''}. The merge stops so you can resolve them in the merge panel; Abort merge puts everything back.`;
}

/**
 * Per-branch previews for one opening of the menu. The branch list is read
 * again on every open, so a branch tip that moved is previewed afresh then;
 * within one opening a preview is computed once.
 */
function useMergePreviews(repoPath: string) {
  const [previews, setPreviews] = useState<Record<string, GitMergePreview | null>>({});
  const pending = useRef(new Map<string, Promise<GitMergePreview | null>>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Forgets every preview; called when the menu opens. */
  const reset = () => {
    pending.current = new Map();
    setPreviews({});
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  /** The preview, from cache or computed now. `null` when it could not be computed. */
  const load = (branch: string): Promise<GitMergePreview | null> => {
    const known = pending.current.get(branch);
    if (known) return known;
    const map = pending.current;
    const request = previewMerge(repoPath, branch)
      .catch(() => null)
      .then((preview) => {
        // A preview from an earlier opening is not shown in this one.
        if (pending.current === map) setPreviews((p) => ({ ...p, [branch]: preview }));
        return preview;
      });
    map.set(branch, request);
    return request;
  };

  const schedule = (branch: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(branch), PREVIEW_DELAY_MS);
  };

  return { previews, load, schedule, reset };
}

/** "Merge branch into current…": a small menu of local branches, one click per merge. */
export function MergeBranchMenu({
  repoPath,
  currentBranch,
  compact = false,
}: MergeBranchMenuProps) {
  const mergeBranch = useStore((s) => s.mergeBranch);
  const showToast = useStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const {
    previews,
    load: loadPreview,
    schedule: schedulePreview,
    reset: resetPreviews,
  } = useMergePreviews(repoPath);
  const { confirm, confirmDialog } = useConfirm();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const head = currentBranch ?? 'HEAD';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listGitBranches(repoPath)
      .then((all) => {
        if (!cancelled) setBranches(all.filter((b) => b.kind === 'local' && !b.isCurrent));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    // The menu is placed once against the trigger; a resize would leave it behind.
    const onResize = () => setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', onResize);
    };
  }, [open, repoPath]);

  // Focus the first entry once the list is there, so the menu is usable without the mouse.
  useEffect(() => {
    if (open && branches && branches.length > 0) {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
  }, [open, branches]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const run = async (branch: string) => {
    const preview = await loadPreview(branch);
    setOpen(false);
    if (preview?.outcome === 'conflicts') {
      const ok = await confirm({
        title: `Merging ${branch} will conflict`,
        message: conflictConfirmMessage(preview),
        confirmLabel: 'Merge and resolve',
        variant: 'elevate',
      });
      if (!ok) {
        triggerRef.current?.focus();
        return;
      }
    }
    setRunning(true);
    try {
      const result = await mergeBranch(repoPath, branch);
      const { text, variant } = mergeOutcomeMessage(result, branch, head);
      showToast(text, variant);
      if (result.outcome === 'conflicts' && result.conflicts[0]) {
        openMergeTabOrToast(repoPath, result.conflicts[0]);
      }
    } catch (err) {
      showToast(
        `Could not merge ${branch}: ${err instanceof Error ? err.message : String(err)}`,
        'error'
      );
    } finally {
      setRunning(false);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    );
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={running}
        onClick={() => {
          if (!open) {
            setBranches(null);
            setError(null);
            resetPreviews();
            setPlace(menuPlaceFor(triggerRef.current));
          }
          setOpen(!open);
        }}
        title={`Merge another branch into ${head}`}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      >
        <AuricIcon name="merge" className="text-xs" />
        {running ? 'Merging…' : compact ? 'Merge…' : `Merge into ${head}…`}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={place ?? undefined}
            id={menuId}
            role="menu"
            aria-label={`Merge a branch into ${head}`}
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 overflow-hidden rounded-md border border-border-dark bg-surface py-1 shadow-xl shadow-black/40"
          >
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
              Merge into {head}
            </p>
            {error && <p className="px-3 py-1.5 text-[11px] text-red-300">{error}</p>}
            {!error && branches === null && (
              <p className="px-3 py-1.5 text-[11px] text-foreground-muted">Loading branches…</p>
            )}
            {branches?.length === 0 && (
              <p className="px-3 py-1.5 text-[11px] text-foreground-muted">
                No other local branch.
              </p>
            )}
            <div className="max-h-64 overflow-y-auto">
              {branches?.map((b) => {
                const preview = previews[b.name];
                return (
                  <button
                    key={b.name}
                    type="button"
                    role="menuitem"
                    onClick={() => void run(b.name)}
                    onFocus={() => schedulePreview(b.name)}
                    onMouseEnter={() => schedulePreview(b.name)}
                    className="flex w-full items-start gap-2 px-3 py-1 text-left text-xs text-foreground hover:bg-primary/10 focus:bg-primary/10 focus:outline-none"
                  >
                    <AuricIcon
                      name="alt_route"
                      className="mt-0.5 shrink-0 text-xs text-foreground-muted"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono">{b.name}</span>
                      {preview && (
                        <span
                          data-testid="merge-preview"
                          className={`block truncate text-[10px] ${
                            preview.outcome === 'conflicts'
                              ? 'text-amber-300'
                              : 'text-foreground-muted'
                          }`}
                        >
                          <span className="sr-only">, </span>
                          {previewSummary(preview)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="border-t border-white/5 px-3 pt-1.5 pb-1 text-[10px] leading-snug text-foreground-muted">
              Needs a clean working tree. Conflicts open in the merge panel.
            </p>
          </div>,
          document.body
        )}
      {confirmDialog}
    </div>
  );
}
