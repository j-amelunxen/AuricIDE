import { useCallback, useState } from 'react';
import { useStore } from '@/lib/store';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import type { GitRef } from '@/lib/tauri/gitGraph';
import {
  SHORT_OID_LENGTH,
  countCommitsOnlyReachableFrom,
  describeOperation,
  type OperationDescription,
} from './graphCopy';
import type { GraphMenuActions, MenuCommit } from './graphMenus';
import { NamePopover, OperationSheet, type NameKind, type NameSubmission } from './GraphSheets';
import type { Point } from './GraphRowItem';
import { useGraphOperations, type GraphOp } from './useGraphOperations';

interface SheetState {
  description: OperationDescription;
  onConfirm: () => void;
}

interface PopoverState {
  kind: NameKind;
  at: Point;
  subject: string;
  initialName: string;
  taken: ReadonlySet<string>;
  onSubmit: (submission: NameSubmission) => void;
}

const subjectOf = (commit: MenuCommit) =>
  `${commit.summary} (${commit.oid.slice(0, SHORT_OID_LENGTH)})`;

/** The refs of one kind, by short name, for the "already taken" check. */
function namesOfKind(repoPath: string, kind: GitRef['kind']): ReadonlySet<string> {
  const refs = useStore.getState().graphs[repoPath]?.refs?.refs ?? [];
  return new Set(refs.filter((r) => r.kind === kind).map((r) => r.shorthand));
}

function currentBranch(repoPath: string): string | null {
  const refs = useStore.getState().graphs[repoPath]?.refs?.refs ?? [];
  return refs.find((r) => r.kind === 'local' && r.isCurrent)?.shorthand ?? null;
}

/**
 * Everything the menus and buttons can do, with the sheets and popovers they
 * go through. `overlay` must be rendered once by the view.
 */
export function useGraphCommands(
  repoPath: string,
  onHeadMoved: () => void,
  getOpener: () => HTMLElement | null
) {
  const execute = useGraphOperations(repoPath, onHeadMoved);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [pendingOid, setPendingOid] = useState<string | null>(null);

  const run = useCallback(
    async (op: GraphOp, oid: string | null) => {
      setPendingOid(oid);
      try {
        return await execute(op);
      } finally {
        setPendingOid(null);
      }
    },
    [execute]
  );

  const confirm = useCallback((description: OperationDescription, onConfirm: () => void) => {
    setSheet({
      description,
      onConfirm: () => {
        setSheet(null);
        onConfirm();
      },
    });
  }, []);

  const askName = useCallback(
    (state: Omit<PopoverState, 'onSubmit'>, submit: (s: NameSubmission) => void) => {
      setPopover({
        ...state,
        onSubmit: (submission) => {
          setPopover(null);
          submit(submission);
        },
      });
    },
    []
  );

  const deleteUnmerged = useCallback(
    (ref: GitRef) => {
      const graph = useStore.getState().graphs[repoPath];
      const commitCount = graph?.refs
        ? countCommitsOnlyReachableFrom(graph.commits, graph.refs, ref)
        : 0;
      confirm(
        describeOperation({ kind: 'delete-branch-unmerged', name: ref.shorthand, commitCount }),
        () => {
          void run({ kind: 'branch-delete', name: ref.shorthand, force: true }, ref.target);
        }
      );
    },
    [confirm, repoPath, run]
  );

  const actionsAt = useCallback(
    (at: Point): GraphMenuActions => ({
      checkoutRef: (ref) =>
        void run({ kind: 'checkout', target: ref.name, label: ref.shorthand }, ref.target),
      checkoutCommit: (commit) =>
        confirm(describeOperation({ kind: 'checkout-commit', commit }), () => {
          void run(
            { kind: 'checkout', target: commit.oid, label: commit.oid.slice(0, SHORT_OID_LENGTH) },
            commit.oid
          );
        }),
      newBranch: (commit) =>
        askName(
          {
            kind: 'branch',
            at,
            subject: subjectOf(commit),
            initialName: '',
            taken: namesOfKind(repoPath, 'local'),
          },
          ({ name, checkout }) => {
            void run({ kind: 'branch-create', name, atOid: commit.oid, checkout }, commit.oid);
          }
        ),
      newTag: (commit) =>
        askName(
          {
            kind: 'tag',
            at,
            subject: subjectOf(commit),
            initialName: '',
            taken: namesOfKind(repoPath, 'tag'),
          },
          ({ name, message }) => {
            void run({ kind: 'tag-create', name, oid: commit.oid, message }, commit.oid);
          }
        ),
      cherryPick: (commit) =>
        confirm(
          describeOperation({
            kind: 'cherry-pick',
            commit,
            currentBranch: currentBranch(repoPath),
          }),
          () =>
            void run({ kind: 'cherry-pick', oid: commit.oid, summary: commit.summary }, commit.oid)
        ),
      revert: (commit) =>
        confirm(
          describeOperation({ kind: 'revert', commit, currentBranch: currentBranch(repoPath) }),
          () => void run({ kind: 'revert', oid: commit.oid, summary: commit.summary }, commit.oid)
        ),
      renameBranch: (ref) =>
        askName(
          {
            kind: 'rename',
            at,
            subject: ref.shorthand,
            initialName: ref.shorthand,
            taken: namesOfKind(repoPath, 'local'),
          },
          ({ name }) => {
            void run({ kind: 'branch-rename', oldName: ref.shorthand, newName: name }, ref.target);
          }
        ),
      deleteBranch: (ref) =>
        confirm(describeOperation({ kind: 'delete-branch', name: ref.shorthand }), () => {
          void run({ kind: 'branch-delete', name: ref.shorthand, force: false }, ref.target).then(
            (result) => {
              if (!result.ok && result.code === 'not_merged') deleteUnmerged(ref);
            }
          );
        }),
      deleteTag: (ref) =>
        confirm(describeOperation({ kind: 'delete-tag', name: ref.shorthand }), () => {
          void run({ kind: 'tag-delete', name: ref.shorthand }, ref.target);
        }),
      copy: (text, what) => {
        void copyToClipboard(text).then((copied) =>
          useStore
            .getState()
            .showToast(
              copied ? `Copied ${what}` : `Could not copy the ${what}`,
              copied ? 'success' : 'error'
            )
        );
      },
    }),
    [askName, confirm, deleteUnmerged, repoPath, run]
  );

  const overlay = (
    <>
      {sheet && (
        <OperationSheet
          description={sheet.description}
          returnFocusTo={getOpener}
          onConfirm={sheet.onConfirm}
          onCancel={() => setSheet(null)}
        />
      )}
      {popover && (
        <NamePopover {...popover} returnFocusTo={getOpener} onCancel={() => setPopover(null)} />
      )}
    </>
  );

  return { actionsAt, overlay, busyOid: pendingOid };
}
