'use client';

import { AuricIcon } from '@/app/components/ui/AuricIcon';

export const WORKFLOW_STEP_LABELS = ['Define', 'Plan & create work', 'Run', 'Achieved'] as const;

export interface GoalWorkflowStepperProps {
  workflowStep: {
    stage: string;
    index: number;
    hint: string;
  };
}

export function GoalWorkflowStepper({ workflowStep }: GoalWorkflowStepperProps) {
  return (
    <div
      data-testid="goal-workflow-stepper"
      className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
    >
      <ol className="flex flex-wrap items-center gap-y-2">
        {WORKFLOW_STEP_LABELS.map((label, i) => {
          const pos = i + 1;
          const isCurrent = pos === workflowStep.index;
          const isDone = pos < workflowStep.index || workflowStep.stage === 'done';
          return (
            <li
              key={label}
              data-testid={`goal-workflow-step-${pos}`}
              aria-current={isCurrent ? 'step' : undefined}
              className={`flex items-center ${i < WORKFLOW_STEP_LABELS.length - 1 ? 'flex-1' : ''}`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-colors ${
                    isDone && !isCurrent
                      ? 'bg-green-500/20 text-green-300'
                      : isCurrent
                        ? 'bg-primary/25 text-primary-light ring-1 ring-primary/40'
                        : 'bg-white/5 text-foreground-muted'
                  }`}
                >
                  {isDone && !isCurrent ? <AuricIcon name="check" className="text-[11px]" /> : pos}
                </span>
                <span
                  className={`text-[10px] ${
                    isCurrent
                      ? 'font-bold text-foreground'
                      : isDone
                        ? 'text-foreground/70'
                        : 'text-foreground-muted'
                  }`}
                >
                  {label}
                </span>
              </span>
              {i < WORKFLOW_STEP_LABELS.length - 1 && (
                <span aria-hidden className="mx-2 h-px flex-1 bg-white/10" />
              )}
            </li>
          );
        })}
      </ol>
      <p
        data-testid="goal-workflow-hint"
        className="mt-2 text-[10px] leading-relaxed text-foreground-muted"
      >
        {workflowStep.hint}
      </p>
    </div>
  );
}
