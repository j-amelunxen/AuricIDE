'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { ReviewIntent } from '@/lib/git/review/reviewIntent';

/** Long enough that three lines of task text would not hold it. */
const LONG_TASK_CHARS = 280;

/** What the agent behind this change set was asked to do. Renders nothing when nobody knows. */
export function ReviewIntentHeader({ intent }: { intent: ReviewIntent | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!intent) return null;
  const long =
    !!intent.task && (intent.task.length > LONG_TASK_CHARS || intent.task.split('\n').length > 3);

  return (
    <section
      data-testid="review-intent"
      aria-label="What the agent was asked to do"
      className="border-b border-border-dark bg-panel-bg/60 px-4 py-2.5"
    >
      <p className="flex items-start gap-1.5 text-xs text-foreground-muted">
        <AuricIcon name="smart_toy" className="mt-0.5 shrink-0 text-sm text-primary-light" />
        <span>
          {intent.relation === 'author' ? 'Written by' : 'Last agent here:'}{' '}
          <span className="font-medium text-foreground">{intent.agentName}</span>
          {intent.ticketName ? (
            <>
              {' '}
              for <span className="font-medium text-foreground">{intent.ticketName}</span>
            </>
          ) : null}
        </span>
      </p>
      {intent.task ? (
        <div className="mt-1.5 pl-5">
          <p
            data-testid="review-intent-task"
            className={`whitespace-pre-wrap text-xs leading-5 text-foreground/90 ${
              expanded ? '' : 'line-clamp-3'
            }`}
          >
            {intent.task}
          </p>
          {long ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[11px] font-medium text-primary-light hover:underline"
            >
              {expanded ? 'Show less' : 'Show the whole task'}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
