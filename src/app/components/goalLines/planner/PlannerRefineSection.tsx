import type { PlannerRevision } from '@/lib/goals/planner/plannerDraft';

interface PlannerRefineSectionProps {
  refine: string;
  onRefineChange: (next: string) => void;
  onApplyRefine: () => void;
  busy: boolean;
  revisions: PlannerRevision[];
}

export function PlannerRefineSection({
  refine,
  onRefineChange,
  onApplyRefine,
  busy,
  revisions,
}: PlannerRefineSectionProps) {
  return (
    <>
      <div className="flex flex-col gap-1 text-[10px] text-foreground-muted">
        <label data-testid="planner-refine-label" htmlFor="planner-refine">
          Refine the plan
        </label>
        <div className="flex gap-2">
          <input
            id="planner-refine"
            data-testid="planner-refine"
            type="text"
            value={refine}
            onChange={(e) => onRefineChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onApplyRefine();
            }}
            disabled={busy}
            placeholder="Describe the change… Enter to apply"
            className="flex-1 rounded-lg bg-black/30 px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-foreground-muted/40 focus:bg-black/50 focus-visible:ring-2 focus-visible:ring-primary/70"
          />
          <button
            data-testid="planner-apply"
            onClick={onApplyRefine}
            disabled={busy || !refine.trim()}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {busy ? '…' : 'Refine'}
          </button>
        </div>
      </div>

      {revisions.length > 0 && (
        <div className="flex flex-col gap-0.5 font-mono text-[10px] text-foreground-muted">
          {revisions.map((r, i) => (
            <span key={`${r.at}-${i}`}>
              <span className="text-[#2effa5]/70">✓</span> v{i + 2}: {r.instruction}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
