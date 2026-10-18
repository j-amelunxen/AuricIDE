'use client';

import type { MouseEvent, RefObject } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import {
  isSplit,
  paneLayout,
  zoneRect,
  type DropZone,
  type GridCells,
} from '@/lib/agents/terminalGrid';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { AgentXterm, type AgentXtermHandle } from './AgentXterm';
import type { TabGridDrag } from './useTabGridDrag';

const PANE_ACTION =
  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted transition-[transform,color,background-color] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-primary/60';

/** The active pane's frame is the full hue, the others a quiet version of it. */
const paneFrame = (accent: string, active: boolean) =>
  active ? accent : `color-mix(in srgb, ${accent} 35%, transparent)`;

const percent = (share: number) => `${share * 100}%`;

const DROP_HINT: Record<DropZone, string> = {
  left: 'Left half',
  right: 'Right half',
  top: 'Top half',
  bottom: 'Bottom half',
  tl: 'Top left',
  tr: 'Top right',
  bl: 'Bottom left',
  br: 'Bottom right',
  center: 'Show alone',
};

/** Where the dragged tab would land. Drawn over the terminals, never in their way. */
function DropPreview({ zone }: { zone: DropZone | null }) {
  const rect = zone ? zoneRect(zone) : null;
  return (
    <div
      data-testid="terminal-grid-drop-preview"
      data-zone={zone ?? 'none'}
      className="pointer-events-none absolute inset-2 z-40 rounded-lg bg-black/40"
    >
      <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
      <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
      {rect && zone && (
        <div
          style={{
            left: percent(rect.left),
            top: percent(rect.top),
            width: percent(rect.width),
            height: percent(rect.height),
          }}
          className="absolute flex items-center justify-center rounded-lg border-2 border-primary/60 bg-primary/15 transition-[left,top,width,height] duration-150 ease-out"
        >
          <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            {DROP_HINT[zone]}
          </span>
        </div>
      )}
    </div>
  );
}

interface TerminalGridProps {
  cells: GridCells;
  activeId: string;
  /** Names for the pane headers. An agent missing here is headed by its id. */
  agents: AgentInfo[];
  /** Project name per agent, printed before its name. An agent missing here gets none. */
  projects?: Record<string, string>;
  areaRef: RefObject<HTMLDivElement | null>;
  drag: TabGridDrag | null;
  onFocusPane: (agentId: string) => void;
  /** Identity colour per agent; the pane's frame and name wear it. Absent: the plain frame. */
  accents?: Record<string, string>;
  /** Pressing a pane's bar starts the same drag a tab does. */
  onDragPane?: (agentId: string, event: MouseEvent<HTMLElement>) => void;
  /** The pane laid over the whole area for a closer look. The layout underneath stays. */
  maximizedId?: string | null;
  onToggleMaximize?: (agentId: string) => void;
  /** Takes the pane out of the split. The agent keeps running. */
  onRemovePane: (agentId: string) => void;
  /** Whether a pane gets the end control — the same answer the tab strip uses. */
  canEndPane?: (agent: AgentInfo) => boolean;
  /** Ends the agent, exactly as its tab's X does. */
  onEndPane?: (agent: AgentInfo) => void;
  registerTerminal: (agentId: string, handle: AgentXtermHandle | null) => void;
  onSelectionSpawn?: (selection: string) => void;
}

/**
 * The terminal area: one agent, or up to four side by side. A lone terminal
 * is the same grid with one pane across it, so splitting does not rebuild the
 * terminal that was already open.
 */
export function TerminalGrid({
  cells,
  activeId,
  agents,
  projects,
  areaRef,
  drag,
  onFocusPane,
  onDragPane,
  maximizedId = null,
  onToggleMaximize,
  onRemovePane,
  accents,
  canEndPane,
  onEndPane,
  registerTerminal,
  onSelectionSpawn,
}: TerminalGridProps) {
  const split = isSplit(cells);
  return (
    <div ref={areaRef} data-testid="terminal-grid" className="relative flex-1 min-h-0 p-2">
      <div className={`relative grid h-full grid-cols-2 grid-rows-2 ${split ? 'gap-2' : ''}`}>
        {paneLayout(cells).map((pane) => {
          const isActive = pane.agentId === activeId;
          // Laid over the others rather than replacing them: the panes underneath
          // keep their size, so their terminals do not resize while one is looked at.
          const maximized = split && pane.agentId === maximizedId;
          const paneAgent = agents.find((a) => a.id === pane.agentId);
          const accent = accents?.[pane.agentId];
          const name = paneAgent?.name ?? pane.agentId;
          const project = projects?.[pane.agentId];
          const endLabel =
            paneAgent && isFinishedAgent(paneAgent) ? `Dismiss ${name}` : `Stop ${name}`;
          return (
            <div
              key={pane.agentId}
              data-testid={`terminal-pane-${pane.agentId}`}
              data-active={isActive}
              data-maximized={maximized}
              data-accent={accent}
              style={{
                ...(maximized
                  ? { position: 'absolute', inset: 0, zIndex: 30 }
                  : {
                      gridRow: `${pane.row} / span ${pane.rowSpan}`,
                      gridColumn: `${pane.col} / span ${pane.colSpan}`,
                    }),
                ...(split && accent ? { borderColor: paneFrame(accent, isActive) } : {}),
              }}
              onMouseDownCapture={() => {
                if (!isActive) onFocusPane(pane.agentId);
              }}
              className={`flex min-h-0 min-w-0 flex-col ${
                split
                  ? `overflow-hidden rounded-lg border transition-colors ${
                      maximized ? 'bg-background-dark shadow-2xl shadow-black/60' : ''
                    } ${accent ? '' : isActive ? 'border-primary/40' : 'border-white/10'}`
                  : ''
              }`}
            >
              {split && (
                <div
                  data-testid={`terminal-pane-bar-${pane.agentId}`}
                  title="Drag to move · double-click to maximize"
                  onMouseDown={(e) => onDragPane?.(pane.agentId, e)}
                  onDoubleClick={() => onToggleMaximize?.(pane.agentId)}
                  className={`flex flex-shrink-0 select-none items-center gap-2 border-b border-white/5 bg-black/40 py-1 pl-3 pr-1 ${
                    onDragPane ? 'cursor-grab active:cursor-grabbing' : ''
                  }`}
                >
                  {/* Agents started alike share a name; the project tells them apart.
                      It is context, so it reads quieter and gives way only after the name. */}
                  {project && (
                    <span
                      data-testid={`terminal-pane-project-${pane.agentId}`}
                      title={paneAgent?.repoPath}
                      className="min-w-0 max-w-[40%] flex-shrink truncate text-[10px] font-bold uppercase tracking-wider text-foreground-muted/60"
                    >
                      {project}
                    </span>
                  )}
                  {project && (
                    <span aria-hidden="true" className="flex-shrink-0 text-[10px] text-white/20">
                      ›
                    </span>
                  )}
                  <span
                    style={accent && isActive ? { color: accent } : undefined}
                    className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider ${
                      isActive ? 'text-foreground' : 'text-foreground-muted'
                    }`}
                  >
                    {name}
                  </span>
                  {onToggleMaximize && (
                    <button
                      type="button"
                      data-testid={`terminal-pane-maximize-${pane.agentId}`}
                      aria-label={maximized ? `Restore ${name}` : `Maximize ${name}`}
                      aria-pressed={maximized}
                      title={maximized ? 'Back to the split view' : 'Maximize'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onClick={() => onToggleMaximize(pane.agentId)}
                      className={`${PANE_ACTION} hover:bg-white/10 hover:text-foreground`}
                    >
                      <AuricIcon
                        name={maximized ? 'close_fullscreen' : 'open_in_full'}
                        aria-hidden="true"
                        className="text-[11px]"
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`terminal-pane-remove-${pane.agentId}`}
                    aria-label={`Take ${name} out of the split view`}
                    title="Take out of the split view (the agent keeps running)"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onRemovePane(pane.agentId)}
                    className={`${PANE_ACTION} hover:bg-white/10 hover:text-foreground`}
                  >
                    <AuricIcon
                      name="right_panel_close"
                      aria-hidden="true"
                      className="text-[11px]"
                    />
                  </button>
                  {paneAgent && onEndPane && (canEndPane?.(paneAgent) ?? true) && (
                    <button
                      type="button"
                      data-testid={`terminal-pane-end-${pane.agentId}`}
                      aria-label={endLabel}
                      title={endLabel}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onEndPane(paneAgent)}
                      className={`${PANE_ACTION} hover:bg-red-500/15 hover:text-red-400`}
                    >
                      <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
                    </button>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <AgentXterm
                  ref={(handle) => registerTerminal(pane.agentId, handle)}
                  agentId={pane.agentId}
                  role={paneAgent?.role}
                  autoFocus={isActive}
                  onSelectionSpawn={onSelectionSpawn}
                />
              </div>
            </div>
          );
        })}
      </div>
      {drag && <DropPreview zone={drag.zone} />}
    </div>
  );
}
