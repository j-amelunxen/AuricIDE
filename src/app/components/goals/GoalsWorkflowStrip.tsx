'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** localStorage key marking the workflow strip as dismissed. */
export const WORKFLOW_STRIP_DISMISSED_KEY = 'auric.goals.workflow-strip-dismissed';

const STEPS = [
  { title: 'Define a goal', detail: 'name + criteria' },
  { title: 'Attach work', detail: 'link tickets' },
  { title: 'Run the conductor', detail: 'agents pick tickets' },
  { title: 'Achieved', detail: 'auto when green' },
];

interface GoalsWorkflowStripProps {
  onDismiss: () => void;
}

/**
 * One-line teaching strip for the goal loop. Shown until dismissed;
 * replayable via the help button in the modal header.
 */
export function GoalsWorkflowStrip({ onDismiss }: GoalsWorkflowStripProps) {
  return (
    <div
      data-testid="goals-workflow-strip"
      className="flex items-center gap-4 border-b border-white/5 bg-white/[0.02] px-6 py-2.5"
    >
      <ol className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary-light">
                {i + 1}
              </span>
              <span className="text-[11px] font-medium text-foreground">{step.title}</span>
              <span className="hidden text-[10px] text-foreground-muted min-[1200px]:inline">
                · {step.detail}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <AuricIcon
                name="chevron_right"
                aria-hidden
                className="text-xs text-foreground-muted/40"
              />
            )}
          </li>
        ))}
      </ol>
      <button
        data-testid="goals-workflow-dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
      >
        Got it
      </button>
    </div>
  );
}
