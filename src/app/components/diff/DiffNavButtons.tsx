import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Previous and next hunk, and the unified / side-by-side switch. */
export function DiffNavButtons({
  viewMode,
  narrow = false,
  onPrev,
  onNext,
  onToggleView,
}: {
  viewMode: 'unified' | 'side-by-side';
  /** Side-by-side does not fit; the switch stays visible but says why it is off. */
  narrow?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleView: () => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Previous hunk"
        data-testid="diff-prev-hunk"
        onClick={onPrev}
        className="flex min-h-6 items-center rounded px-1.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
        title="Previous hunk"
      >
        <AuricIcon name="arrow_upward" className="text-sm" />
      </button>
      <button
        type="button"
        aria-label="Next hunk"
        data-testid="diff-next-hunk"
        onClick={onNext}
        className="flex min-h-6 items-center rounded px-1.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
        title="Next hunk"
      >
        <AuricIcon name="arrow_downward" className="text-sm" />
      </button>
      <button
        type="button"
        data-testid="diff-view-toggle"
        onClick={onToggleView}
        disabled={narrow}
        className="flex min-h-6 items-center gap-1 rounded px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50 text-foreground-muted hover:bg-hover-bg hover:text-foreground"
        title={
          narrow
            ? 'Too narrow for side-by-side; widen the editor to switch'
            : viewMode === 'unified'
              ? 'Switch to side-by-side'
              : 'Switch to unified'
        }
      >
        <AuricIcon
          name={viewMode === 'unified' ? 'view_column_2' : 'view_agenda'}
          className="text-sm"
        />
        {viewMode === 'unified' ? 'Side-by-side' : 'Unified'}
      </button>
    </>
  );
}
