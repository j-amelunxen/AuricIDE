'use client';

interface SelectionMenuProps {
  x: number;
  y: number;
  selection: string;
  isAsciiArt: boolean;
  onSpawnAgent: (selection: string) => void;
  onFixAsciiArt: () => void;
}

export function SelectionMenu({
  x,
  y,
  selection,
  isAsciiArt,
  onSpawnAgent,
  onFixAsciiArt,
}: SelectionMenuProps) {
  return (
    <div
      className="absolute z-50 flex items-center gap-1 rounded bg-panel-bg border border-primary shadow-lg px-1 py-1 animate-in fade-in zoom-in duration-150"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        onClick={() => onSpawnAgent(selection)}
        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/10 rounded transition-colors"
      >
        <span className="material-symbols-outlined text-sm">bolt</span>
        SPAWN AGENT
      </button>

      {isAsciiArt && (
        <button
          onClick={onFixAsciiArt}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-accent hover:bg-accent/10 rounded transition-colors"
        >
          <span className="material-symbols-outlined text-sm">auto_fix_high</span>
          FIX ASCII-ART
        </button>
      )}
    </div>
  );
}
