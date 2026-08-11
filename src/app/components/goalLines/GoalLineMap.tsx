'use client';

import { useRef, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { GoalLine, LineStation } from '@/lib/goals/goalLinesLayout';
import { stationIndexForX } from '@/lib/goals/goalLinesLayout';

const W = 600;
const PAD = 28;

/** Status colors shared with the git gutter tokens — the app's one red/amber/green. */
const AGENT_OK = '#2effa5';
const AGENT_WARN = '#ffce2e';
const AGENT_BAD = '#ff4a4a';

function agentColor(agent: AgentInfo | undefined): string {
  if (!agent) return AGENT_OK;
  if (agent.status === 'error') return AGENT_BAD;
  if (agent.awaitingInput) return AGENT_WARN;
  return AGENT_OK;
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const EDGE_STYLE: Record<LineStation['state'], { opacity: number; dash?: string }> = {
  done: { opacity: 0.9 },
  front: { opacity: 0.9 },
  planned: { opacity: 0.35, dash: '1 6' },
  fog: { opacity: 0.12, dash: '2 7' },
};

export interface GoalLineMapProps {
  line: GoalLine;
  agentsById: Map<string, AgentInfo>;
  big?: boolean;
  /**
   * When set, pending human steps become draggable along the line; a drop
   * reports the target index. The done-work clamp lives in stationOrder —
   * an illegal drop simply snaps back.
   */
  onStationDrop?: (stationId: string, toIndex: number) => void;
}

/**
 * One goal as a transit map. Evidence drives station fill, not line color:
 * proven/human = solid, claim = hollow + center dot, fog = dim.
 * Segment pulse = agent running there.
 */
export function GoalLineMap({ line, agentsById, big = false, onStationDrop }: GoalLineMapProps) {
  const H = big ? 170 : 120;
  const midY = H / 2 + (big ? 8 : 6);
  const r = big ? 7 : 5.5;
  const hasDenseLabels = line.stations.length >= 6;
  const px = (x: number): number => PAD + x * (W - PAD * 2);

  const svgRef = useRef<SVGSVGElement>(null);
  // The client→viewBox scale is captured once at drag start, so render never
  // has to read the ref — 1:1 tracking with a frozen scale is exact enough
  // for a horizontal reorder.
  const [drag, setDrag] = useState<{
    id: string;
    startX: number;
    dx: number;
    scale: number;
  } | null>(null);

  const isDraggable = (s: LineStation): boolean =>
    !!onStationDrop && s.kind === 'human' && s.state !== 'done';

  const beginDrag = (s: LineStation, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = rect && rect.width > 0 ? W / rect.width : 1;
    setDrag({ id: s.id, startX: e.clientX, dx: 0, scale });
  };

  const endDrag = (s: LineStation, e: React.PointerEvent) => {
    if (!drag || drag.id !== s.id || !onStationDrop) {
      setDrag(null);
      return;
    }
    e.stopPropagation();
    const dx = drag.dx * drag.scale;
    if (Math.abs(dx) > 4) {
      const xPct = Math.max(0, Math.min(1, (px(s.x) + dx - PAD) / (W - PAD * 2)));
      onStationDrop(s.id, stationIndexForX(line, xPct, s.id));
    }
    setDrag(null);
  };

  const segments: React.ReactNode[] = [];
  for (let i = 1; i < line.stations.length; i++) {
    const a = line.stations[i - 1];
    const b = line.stations[i];
    const style = EDGE_STYLE[b.state === 'done' ? a.state : b.state];
    const flowing = b.state === 'front' && b.agentIds.length > 0;
    segments.push(
      <line
        key={`seg-${b.id}`}
        x1={px(a.x)}
        y1={midY}
        x2={px(b.x)}
        y2={midY}
        stroke={line.hue}
        strokeOpacity={style.opacity}
        strokeWidth={big ? 5 : 4}
        strokeLinecap="round"
        strokeDasharray={style.dash}
      />
    );
    if (flowing) {
      segments.push(
        <line
          key={`flow-${b.id}`}
          className="goal-line-flow"
          x1={px(a.x)}
          y1={midY}
          x2={px(b.x)}
          y2={midY}
          stroke="#ffffff"
          strokeOpacity={0.45}
          strokeWidth={big ? 2 : 1.6}
          strokeLinecap="round"
          strokeDasharray="3 9"
        />
      );
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block h-auto w-full overflow-visible"
      style={{ touchAction: 'pan-y' }}
      // Purely visual: nothing inside is keyboard-focusable, and everything it
      // shows or lets you do (reorder, tick, verify) has an accessible twin in
      // the station rows below. Exposing it too would just be a mouse-only
      // duplicate a screen reader cannot operate.
      aria-hidden="true"
      data-testid={`goal-line-map-${line.goalId}`}
    >
      {segments}
      {line.stations.map((s, stationIndex) => {
        const cx = px(s.x);
        const dim = s.state === 'fog' ? 0.25 : s.state === 'planned' ? 0.55 : 1;
        const humanGate = s.kind === 'gate' && s.evidence === 'human';
        const strokeColor = humanGate && s.state !== 'done' ? AGENT_WARN : line.hue;
        const done = s.state === 'done';
        const hollow = done && s.evidence === 'claim';

        const draggable = isDraggable(s);
        const dragging = drag?.id === s.id;
        const labelBelow = hasDenseLabels && stationIndex % 2 === 1;
        const labelY = labelBelow
          ? midY + (big ? 29 : 24)
          : midY - (big ? 18 : 14) - (s.agentIds.length > 0 ? (big ? 16 : 13) : 0);
        const labelAnchor =
          line.stations.length === 1
            ? 'middle'
            : stationIndex === 0
              ? 'start'
              : stationIndex === line.stations.length - 1
                ? 'end'
                : 'middle';

        return (
          <g
            key={s.id}
            opacity={dim}
            data-testid={`station-${s.id}`}
            transform={dragging ? `translate(${drag.dx * drag.scale} 0)` : undefined}
            style={draggable ? { cursor: dragging ? 'grabbing' : 'grab' } : undefined}
            onClick={draggable ? (e) => e.stopPropagation() : undefined}
            onPointerDown={draggable ? (e) => beginDrag(s, e) : undefined}
            onPointerMove={
              draggable
                ? (e) => {
                    if (drag?.id === s.id) setDrag({ ...drag, dx: e.clientX - drag.startX });
                  }
                : undefined
            }
            onPointerUp={draggable ? (e) => endDrag(s, e) : undefined}
          >
            <title>
              {s.label}
              {s.detail ? ` · ${s.detail}` : ''}
              {hollow ? ' (claim)' : ''}
              {s.stale ? ' (stale)' : ''}
            </title>
            {done && s.evidence === 'judged' && (
              <circle
                cx={cx}
                cy={midY}
                r={r + 4}
                fill="none"
                stroke={line.hue}
                strokeOpacity={0.55}
                strokeWidth={1.4}
                strokeDasharray="2.5 3"
              />
            )}
            {s.stale && (
              <circle
                cx={cx}
                cy={midY}
                r={r + 6.5}
                fill="none"
                stroke={AGENT_WARN}
                strokeOpacity={0.5}
                strokeWidth={1.2}
                strokeDasharray="1.5 3"
              />
            )}
            {s.state === 'front' && (
              <circle
                className="goal-line-pulse"
                cx={cx}
                cy={midY}
                r={r + 5.5}
                fill={humanGate ? AGENT_WARN : line.hue}
              />
            )}
            {s.kind === 'terminus' ? (
              <rect
                x={cx - r - 2}
                y={midY - r - 2}
                width={(r + 2) * 2}
                height={(r + 2) * 2}
                rx={3}
                transform={`rotate(45 ${cx} ${midY})`}
                fill={done ? line.hue : 'var(--color-surface)'}
                stroke={line.hue}
                strokeWidth={2.5}
              />
            ) : s.kind === 'gate' || s.kind === 'human' ? (
              <rect
                x={cx - r - 1}
                y={midY - r - 1}
                width={(r + 1) * 2}
                height={(r + 1) * 2}
                rx={2}
                fill={done && !hollow ? strokeColor : 'var(--color-surface)'}
                stroke={strokeColor}
                strokeWidth={2.5}
              />
            ) : (
              <circle
                cx={cx}
                cy={midY}
                r={r}
                fill={done && !hollow ? line.hue : 'var(--color-surface)'}
                stroke={line.hue}
                strokeWidth={2.5}
              />
            )}
            {hollow && <circle cx={cx} cy={midY} r={2.2} fill={line.hue} />}
            {(big || s.state !== 'fog') && (
              <text
                x={cx}
                y={labelY}
                textAnchor={labelAnchor}
                className="font-mono"
                fontSize={big ? 10 : 9}
                fill="#8a8a9c"
                letterSpacing="0.04em"
              >
                {truncate(s.label, big ? 22 : 14)}
              </text>
            )}
            {s.agentIds.map((agentId, i) => {
              const agent = agentsById.get(agentId);
              const ax = cx + (i - (s.agentIds.length - 1) / 2) * (big ? 16 : 12);
              const ay = midY - (big ? 22 : 18);
              const color = agentColor(agent);
              return (
                <g key={agentId} data-testid={`perched-agent-${agentId}`}>
                  <title>{agent ? agent.name : agentId}</title>
                  <circle cx={ax} cy={ay} r={big ? 5 : 4} fill={color} />
                  <circle
                    cx={ax}
                    cy={ay}
                    r={big ? 8 : 6.5}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.35}
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
