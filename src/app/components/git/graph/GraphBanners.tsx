import { useRef } from 'react';
import type { GitOperationName, GitRefs } from '@/lib/tauri/gitGraph';
import { SHORT_OID_LENGTH } from './graphCopy';
import type { Point } from './GraphRowItem';

const BANNER =
  'flex items-center gap-3 border-b border-white/5 bg-primary/10 px-4 py-1.5 text-xs text-foreground';
const BANNER_BUTTON =
  'ml-auto shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-primary-light transition-[background-color,transform] duration-100 ease-out hover:bg-primary/15 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100';

const OPERATION_PHRASE: Record<Exclude<GitOperationName, 'none'>, string> = {
  merge: 'A merge',
  rebase: 'A rebase',
  'cherry-pick': 'A cherry-pick',
  revert: 'A revert',
  other: 'An operation',
};

interface GraphBannersProps {
  refs: GitRefs | null;
  onCheckoutBranch: (point: Point) => void;
  onOpenMergePanel: () => void;
}

/** Above the list: what is unusual about the repository right now. */
export function GraphBanners({ refs, onCheckoutBranch, onOpenMergePanel }: GraphBannersProps) {
  const branchButton = useRef<HTMLButtonElement>(null);
  const operation = refs && refs.operation !== 'none' ? refs.operation : null;
  const detachedAt = refs?.headDetached ? (refs.headOid ?? '').slice(0, SHORT_OID_LENGTH) : null;
  const operationText = operation ? `${OPERATION_PHRASE[operation]} is in progress.` : null;
  const detachedText =
    detachedAt !== null
      ? `HEAD is detached at ${detachedAt}. Commits made here belong to no branch.`
      : null;
  return (
    <>
      {/* Mounted before it has anything to say: a region that appears with its text is not announced. */}
      <div role="status" className="sr-only">
        {[operationText, detachedText].filter(Boolean).join(' ')}
      </div>
      {operationText && (
        <div className={BANNER}>
          <span>{operationText}</span>
          <button type="button" className={BANNER_BUTTON} onClick={onOpenMergePanel}>
            Open Merge Panel
          </button>
        </div>
      )}
      {detachedText && (
        <div className={BANNER}>
          <span>{detachedText}</span>
          <button
            ref={branchButton}
            type="button"
            className={BANNER_BUTTON}
            onClick={() => {
              const box = branchButton.current?.getBoundingClientRect();
              onCheckoutBranch({ x: box?.left ?? 0, y: box?.bottom ?? 0 });
            }}
          >
            Check Out a Branch…
          </button>
        </div>
      )}
    </>
  );
}

type EmptyKind = 'loading' | 'no-repo' | 'no-commits' | 'error';

interface GraphEmptyStateProps {
  kind: EmptyKind;
  message?: string;
  onRetry?: () => void;
}

const EMPTY_COPY: Record<Exclude<EmptyKind, 'error' | 'loading'>, [string, string]> = {
  'no-repo': [
    'Not a git repository',
    'Open a folder that contains a git repository to see its history.',
  ],
  'no-commits': ['No commits yet', 'Make a first commit and the history appears here.'],
};

export function GraphEmptyState({ kind, message, onRetry }: GraphEmptyStateProps) {
  if (kind === 'loading') {
    return (
      <p role="status" className="p-6 text-xs text-foreground-muted">
        Loading history…
      </p>
    );
  }
  if (kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-xs text-red-300">
          {message}
        </p>
        <button type="button" className={BANNER_BUTTON.replace('ml-auto ', '')} onClick={onRetry}>
          Try Again
        </button>
      </div>
    );
  }
  const [title, body] = EMPTY_COPY[kind];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-xs text-xs text-foreground-muted [text-wrap:pretty]">{body}</p>
    </div>
  );
}
