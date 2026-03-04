import { getObsidianColor } from '@/lib/obsidian-canvas/canvasParser';
import type { ObsidianColor } from '@/lib/obsidian-canvas/types';

export function getNodeBorderStyle(_color?: ObsidianColor, selected?: boolean): string {
  const selectionRing = selected
    ? 'ring-2 ring-[#137fec] shadow-[0_0_15px_rgba(19,127,236,0.3)]'
    : '';
  return ['rounded-lg shadow-lg', selectionRing].filter(Boolean).join(' ');
}

export function getNodeBorderColor(color?: ObsidianColor): string {
  return getObsidianColor(color);
}

export function getEdgeColor(color?: ObsidianColor): string {
  return getObsidianColor(color);
}
