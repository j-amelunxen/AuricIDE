'use client';

import type { ReactNode } from 'react';

/** Same tokens as GoalLineMap — legend glyphs must match the board. */
const HUE = '#6ec8ff';
const WARN = '#ffce2e';
const AGENT = '#2effa5';
const SURFACE = 'var(--color-surface, #0a0a10)';

type SwatchProps = { children: ReactNode; label: string };

function Swatch({ children, label }: SwatchProps) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center">
        {children}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-foreground-muted/70">
        {label}
      </span>
    </li>
  );
}

function Dot({
  fill,
  stroke = HUE,
  r = 4.5,
  opacity = 1,
  cx = 8,
  cy = 8,
}: {
  fill: string;
  stroke?: string;
  r?: number;
  opacity?: number;
  cx?: number;
  cy?: number;
}) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={2} opacity={opacity} />
    </svg>
  );
}

/**
 * Visual key for the goal-line map. Glyphs mirror GoalLineMap so the legend
 * is readable at a glance — not a wall of equals-sign prose.
 */
export function GoalLineLegend() {
  return (
    <div
      data-testid="goal-line-legend"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/5 pt-3"
      role="group"
      aria-label="Checkpoint legend"
    >
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <Swatch label="complete">
          <Dot fill={HUE} />
        </Swatch>
        <Swatch label="in progress">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <circle cx="8" cy="8" r="7" fill={HUE} opacity={0.2} className="goal-line-pulse" />
            <circle cx="8" cy="8" r="4.5" fill={SURFACE} stroke={HUE} strokeWidth={2} />
          </svg>
        </Swatch>
        <Swatch label="upcoming">
          <Dot fill={SURFACE} opacity={0.7} />
        </Swatch>
        <Swatch label="later">
          <Dot fill="none" stroke={HUE} r={3.5} opacity={0.25} />
        </Swatch>
      </ul>

      <span aria-hidden="true" className="hidden h-3 w-px bg-white/10 sm:block" />

      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <Swatch label="reported">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <circle cx="8" cy="8" r="4.5" fill={SURFACE} stroke={HUE} strokeWidth={2} />
            <circle cx="8" cy="8" r="1.8" fill={HUE} />
          </svg>
        </Swatch>
        <Swatch label="AI check">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <circle
              cx="8"
              cy="8"
              r="7"
              fill="none"
              stroke={HUE}
              strokeWidth={1.2}
              strokeOpacity={0.55}
              strokeDasharray="2 2.5"
            />
            <circle cx="8" cy="8" r="4" fill={HUE} />
          </svg>
        </Swatch>
        <Swatch label="needs review">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <circle
              cx="8"
              cy="8"
              r="7"
              fill="none"
              stroke={WARN}
              strokeWidth={1.2}
              strokeOpacity={0.7}
              strokeDasharray="1.5 2.5"
            />
            <circle cx="8" cy="8" r="4" fill={HUE} />
          </svg>
        </Swatch>
        <Swatch label="human">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <rect
              x="3.5"
              y="3.5"
              width="9"
              height="9"
              rx="1.5"
              fill={SURFACE}
              stroke={WARN}
              strokeWidth={2}
            />
          </svg>
        </Swatch>
        <Swatch label="agent">
          <svg width="16" height="16" viewBox="0 0 16 16" className="overflow-visible">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke={AGENT}
              strokeOpacity={0.35}
              strokeWidth={1.4}
            />
            <circle cx="8" cy="8" r="3.2" fill={AGENT} />
          </svg>
        </Swatch>
      </ul>
    </div>
  );
}
