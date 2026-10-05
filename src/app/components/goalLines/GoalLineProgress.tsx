'use client';

import type { GoalLine } from '@/lib/goals/goalLinesLayout';
import { lineProgress } from '@/lib/goals/goalLineTimeline';

/** Amber, the colour everywhere else in the app that means "a person is needed". */
const HUMAN = '#ffce2e';

/**
 * The card's progress capsule: done and skipped fill from the left, the
 * front breathes, the rest stays empty, and a small diamond marks each open
 * human step where it sits. A bar reads the same at five stations and at
 * ninety, which a dot per station never could.
 */
export function GoalLineProgress({ line }: { line: GoalLine }) {
  const p = lineProgress(line);
  if (p.total === 0) return null;
  const pct = (n: number) => `${(n / p.total) * 100}%`;
  return (
    <div
      role="progressbar"
      aria-label={`${line.name}: ${p.done} of ${p.total} stations done`}
      aria-valuemin={0}
      aria-valuemax={p.total}
      aria-valuenow={p.done}
      data-testid={`goal-line-capsule-${line.goalId}`}
      className="relative h-3"
    >
      <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/[0.07]">
        <span style={{ width: pct(p.done), backgroundColor: line.hue }} />
        <span style={{ width: pct(p.skipped), backgroundColor: line.hue }} className="opacity-35" />
        {p.front > 0 && (
          <span
            data-testid={`goal-line-capsule-front-${line.goalId}`}
            style={{ width: `max(${pct(p.front)}, 6px)`, backgroundColor: line.hue }}
            className="goal-line-breathe"
          />
        )}
      </div>
      {p.humanMarks.map((mark) => (
        <span
          key={mark.id}
          aria-hidden="true"
          data-testid={`goal-line-capsule-human-${mark.id}`}
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] ring-2 ring-background-dark"
          style={{ left: `${mark.at * 100}%`, backgroundColor: HUMAN }}
        />
      ))}
    </div>
  );
}
