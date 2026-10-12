'use client';

import type { RefObject } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import {
  isSplit,
  paneLayout,
  zoneRect,
  type DropZone,
  type GridCells,
} from '@/lib/agents/terminalGrid';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { AgentXterm, type AgentXtermHandle } from './AgentXterm';
import type { TabGridDrag } from './useTabGridDrag';

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
  areaRef: RefObject<HTMLDivElement | null>;
  drag: TabGridDrag | null;
  onFocusPane: (agentId: string) => void;
  onRemovePane: (agentId: string) => void;
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
  areaRef,
  drag,
  onFocusPane,
  onRemovePane,
  registerTerminal,
  onSelectionSpawn,
}: TerminalGridProps) {
  const split = isSplit(cells);
  return (
    <div ref={areaRef} data-testid="terminal-grid" className="relative flex-1 min-h-0 p-2">
      <div className={`grid h-full grid-cols-2 grid-rows-2 ${split ? 'gap-2' : ''}`}>
        {paneLayout(cells).map((pane) => {
          const isActive = pane.agentId === activeId;
          const name = agents.find((a) => a.id === pane.agentId)?.name ?? pane.agentId;
          return (
            <div
              key={pane.agentId}
              data-testid={`terminal-pane-${pane.agentId}`}
              data-active={isActive}
              style={{
                gridRow: `${pane.row} / span ${pane.rowSpan}`,
                gridColumn: `${pane.col} / span ${pane.colSpan}`,
              }}
              onMouseDownCapture={() => {
                if (!isActive) onFocusPane(pane.agentId);
              }}
              className={`flex min-h-0 min-w-0 flex-col ${
                split
                  ? `overflow-hidden rounded-lg border transition-colors ${
                      isActive ? 'border-primary/40' : 'border-white/10'
                    }`
                  : ''
              }`}
            >
              {split && (
                <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/5 bg-black/40 py-1 pl-3 pr-1">
                  <span
                    className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider ${
                      isActive ? 'text-foreground' : 'text-foreground-muted'
                    }`}
                  >
                    {name}
                  </span>
                  <button
                    type="button"
                    data-testid={`terminal-pane-remove-${pane.agentId}`}
                    aria-label={`Take ${name} out of the split view`}
                    title="Take out of the split view (the agent keeps running)"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onRemovePane(pane.agentId)}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-foreground-muted transition-[transform,color,background-color] hover:bg-white/10 hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <AuricIcon name="close" aria-hidden="true" className="text-[11px]" />
                  </button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <AgentXterm
                  ref={(handle) => registerTerminal(pane.agentId, handle)}
                  agentId={pane.agentId}
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
