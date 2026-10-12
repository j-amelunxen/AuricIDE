import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { RiskFlag } from '@/lib/git/review/riskFlags';
import { Kbd } from './Kbd';
import { RiskChips } from './RiskChips';

export interface HunkToolbarAction {
  id: string;
  /** Visible text, e.g. "Stage hunk" or "Accept". */
  label: string;
  /** What the accessible name starts with, e.g. "Discard hunk"; position and file follow. */
  name: string;
  icon: string;
  onRun: () => void;
  danger?: boolean;
  /** `label` is the key as shown, `aria` the `aria-keyshortcuts` value. */
  shortcut?: { label: string; aria: string };
  /** Tooltip; defaults to the label and its key. */
  tooltip?: string;
}

/**
 * How present the actions are when not hovered: `focused` (the hunk the keys
 * act on, with its key hints), `dim` (the file being reviewed) or `hover`.
 */
export type HunkToolbarVisibility = 'focused' | 'dim' | 'hover';

const RESTING: Record<HunkToolbarVisibility, string> = {
  focused: 'opacity-100',
  dim: 'opacity-60',
  hover: 'opacity-0',
};

function basename(path: string | undefined): string {
  if (!path) return 'this file';
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Right end of a hunk header: risk chips (always shown, they are information)
 * and the hunk's actions.
 */
// code-gate: complexity-parameter-count - one destructured props object, named at the call site
export function HunkToolbar({
  hunkIndex,
  hunkCount,
  fileName,
  flags,
  actions,
  visibility,
  busy,
  note,
}: {
  hunkIndex: number;
  hunkCount: number;
  fileName: string;
  flags: readonly RiskFlag[];
  actions: readonly HunkToolbarAction[];
  visibility: HunkToolbarVisibility;
  busy: boolean;
  /** A short state next to the actions, e.g. "Accepted". */
  note?: string;
}) {
  if (flags.length === 0 && actions.length === 0 && !note) return null;
  const where = `${hunkIndex + 1} of ${hunkCount} in ${basename(fileName)}`;
  return (
    <span
      data-testid="hunk-toolbar"
      className="flex shrink-0 items-center gap-2 py-0.5 pr-2 font-sans font-normal"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <RiskChips flags={flags} />
      {note ? <span className="text-[11px] font-medium text-foreground-muted">{note}</span> : null}
      {actions.length > 0 ? (
        <span
          data-visibility={visibility}
          className={`flex items-center gap-0.5 transition-opacity duration-150 focus-within:opacity-100 group-hover/hunk:opacity-100 motion-reduce:transition-none ${RESTING[visibility]}`}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              data-testid={`hunk-action-${action.id}`}
              disabled={busy}
              aria-label={`${action.name} ${where}`}
              aria-keyshortcuts={action.shortcut?.aria}
              title={
                action.tooltip ??
                (action.shortcut ? `${action.label} (${action.shortcut.label})` : action.label)
              }
              onClick={action.onRun}
              className={`flex min-h-6 items-center gap-1 rounded px-2 text-[11px] font-medium motion-safe:active:scale-[0.96] disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                action.danger
                  ? 'text-foreground-muted hover:bg-red-500/10 hover:text-red-300'
                  : 'text-foreground hover:bg-primary/15 hover:text-primary-light'
              }`}
            >
              <AuricIcon name={action.icon} className="text-[13px]" />
              {action.label}
              {visibility === 'focused' && action.shortcut ? (
                <Kbd>{action.shortcut.label}</Kbd>
              ) : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
