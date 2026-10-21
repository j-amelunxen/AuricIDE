import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import type { OperationDescription } from './graphCopy';
import { validateRefName } from './graphNames';
import type { Point } from './GraphRowItem';

const BUTTON =
  'inline-flex min-h-8 items-center rounded-md px-3 text-xs font-medium transition-[background-color,transform] duration-100 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100';
const QUIET = `${BUTTON} border border-border-dark text-foreground-muted hover:bg-white/5`;
const PRIMARY = `${BUTTON} bg-primary text-white hover:bg-primary/90`;
const DESTRUCTIVE = `${BUTTON} bg-red-700 text-white hover:bg-red-600`;
const SURFACE =
  'rounded-xl border border-white/10 bg-surface/95 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150';

interface OperationSheetProps {
  description: OperationDescription;
  /** Where focus goes when the sheet closes; see `useDialogA11y`. */
  returnFocusTo?: () => HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** One confirmation for every graph operation that changes something. */
export function OperationSheet({
  description,
  returnFocusTo,
  onConfirm,
  onCancel,
}: OperationSheetProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>({ returnFocusTo });
  const { destructive } = description;
  return createPortal(
    <div
      className="fixed inset-0 z-[var(--z-confirm)] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-sheet-title"
        aria-describedby="graph-sheet-body"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
        }}
        className={`${SURFACE} flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-5`}
      >
        <h2
          id="graph-sheet-title"
          className="line-clamp-2 break-words text-sm font-semibold text-foreground"
        >
          {description.title}
        </h2>
        <p id="graph-sheet-body" className="text-xs leading-relaxed text-foreground-muted">
          {description.body}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={QUIET} onClick={onCancel} autoFocus={destructive}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? DESTRUCTIVE : PRIMARY}
            onClick={onConfirm}
            autoFocus={!destructive}
          >
            {description.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export type NameKind = 'branch' | 'tag' | 'rename';

export interface NameSubmission {
  name: string;
  checkout: boolean;
  message: string;
}

interface NamePopoverProps {
  kind: NameKind;
  at: Point;
  /** What the new ref will point at, in words ("Fix login (abcdef1)"). */
  subject: string;
  initialName: string;
  returnFocusTo?: () => HTMLElement | null;
  /** Names that already exist, so the field can refuse them while typing. */
  taken: ReadonlySet<string>;
  onSubmit: (submission: NameSubmission) => void;
  onCancel: () => void;
}

const COPY: Record<NameKind, { title: string; action: string }> = {
  branch: { title: 'New Branch', action: 'Create' },
  tag: { title: 'New Tag', action: 'Create' },
  rename: { title: 'Rename Branch', action: 'Rename' },
};

const POPOVER_WIDTH = 288;
const EDGE_MARGIN = 8;

/**
 * In the lower half of the window the popover grows upward from the point, so
 * its height never has to be guessed to keep it on screen.
 */
function popoverPosition(at: Point): React.CSSProperties {
  const left = Math.max(
    EDGE_MARGIN,
    Math.min(at.x, window.innerWidth - POPOVER_WIDTH - EDGE_MARGIN)
  );
  return at.y > window.innerHeight / 2
    ? { left, bottom: Math.max(EDGE_MARGIN, window.innerHeight - at.y) }
    : { left, top: Math.max(EDGE_MARGIN, at.y) };
}

function blockedReason(kind: NameKind, name: string, initial: string, taken: ReadonlySet<string>) {
  if (kind === 'rename' && name === initial) return 'Change the name first.';
  return validateRefName(name, taken);
}

/** One text field with live validation, for New Branch, New Tag and Rename. */
export function NamePopover(props: NamePopoverProps) {
  const { kind, onSubmit, onCancel } = props;
  const dialogRef = useDialogA11y<HTMLDivElement>({ returnFocusTo: props.returnFocusTo });
  const [name, setName] = useState(props.initialName);
  const [checkout, setCheckout] = useState(true);
  const [message, setMessage] = useState('');
  const copy = COPY[kind];
  const reason = blockedReason(kind, name, props.initialName, props.taken);
  const showProblem = name.length > 0 && reason !== null && name !== props.initialName;
  const helpId = useId();

  const submit = () => {
    if (reason) return;
    onSubmit({ name, checkout: kind === 'branch' && checkout, message });
  };

  return createPortal(
    <div
      data-testid="graph-popover-backdrop"
      className="fixed inset-0 z-[var(--z-confirm)]"
      onMouseDown={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            submit();
          }
        }}
        style={{ ...popoverPosition(props.at), width: POPOVER_WIDTH }}
        className={`${SURFACE} fixed flex flex-col gap-3 p-4`}
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground">{copy.title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
            {kind === 'rename' ? props.initialName : `At ${props.subject}`}
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground-muted">
          Name
          <input
            autoFocus
            value={name}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={showProblem}
            aria-describedby={reason ? helpId : undefined}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-border-dark bg-editor-bg px-2 py-1.5 font-mono text-xs text-foreground"
          />
        </label>
        {reason && (
          <p
            id={helpId}
            role={showProblem ? 'alert' : undefined}
            className={`-mt-1.5 text-[11px] ${showProblem ? 'text-red-300' : 'text-foreground-muted'}`}
          >
            {reason}
          </p>
        )}
        {kind === 'branch' && (
          <label className="flex items-center gap-2 text-[11px] text-foreground-muted">
            <input
              type="checkbox"
              className="accent-primary"
              checked={checkout}
              onChange={(e) => setCheckout(e.target.checked)}
            />
            Check out after creating
          </label>
        )}
        {kind === 'tag' && (
          <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground-muted">
            Message (optional)
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-md border border-border-dark bg-editor-bg px-2 py-1.5 text-xs text-foreground"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={QUIET} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY}
            disabled={reason !== null}
            title={reason ?? undefined}
            onClick={submit}
          >
            {copy.action}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
