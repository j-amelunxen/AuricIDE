/**
 * Squarified treemap layout for the Agent Console fleet.
 *
 * Groups (projects) scale by agent count; agents inside a group share the
 * remaining area equally. Input order is preserved so an attention-sorted
 * project list keeps the urgent cluster in the first strip.
 */

export interface Weighted {
  id: string;
  weight: number;
}

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapAgentInput {
  id: string;
}

export interface TreemapGroupInput {
  id: string;
  agents: TreemapAgentInput[];
}

export interface TreemapAgentCell extends Rect {
  groupId: string;
}

export interface TreemapGroupCell extends Rect {
  headerH: number;
  agents: TreemapAgentCell[];
}

export const TREEMAP_DEFAULT_GAP = 6;
export const TREEMAP_DEFAULT_HEADER = 28;
/** jsdom has no layout; the console still has to paint cards in tests. */
export const TREEMAP_FALLBACK_SIZE = { w: 800, h: 400 };

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). Lays items out along the
 * shorter side of the remaining rectangle, flushing a row when adding the
 * next item would worsen the worst aspect ratio.
 */
export function squarify(items: Weighted[], x: number, y: number, w: number, h: number): Rect[] {
  const positive = items.filter((item) => item.weight > 0);
  if (positive.length === 0 || w <= 0 || h <= 0) return [];
  const total = positive.reduce((sum, item) => sum + item.weight, 0);
  return squarifyRec(positive, total, x, y, w, h);
}

function squarifyRec(
  items: Weighted[],
  totalWeight: number,
  x: number,
  y: number,
  w: number,
  h: number
): Rect[] {
  if (items.length === 0) return [];
  if (items.length === 1) {
    return [{ id: items[0].id, x, y, w, h }];
  }

  const totalArea = w * h;
  const side = Math.min(w, h);
  const row: Weighted[] = [];
  let rowWeight = 0;
  let taken = 0;

  for (let i = 0; i < items.length; i++) {
    const trial = [...row, items[i]];
    const trialWeight = rowWeight + items[i].weight;
    if (
      row.length === 0 ||
      worstAspect(row, rowWeight, side, totalWeight, totalArea) >=
        worstAspect(trial, trialWeight, side, totalWeight, totalArea)
    ) {
      row.push(items[i]);
      rowWeight = trialWeight;
      taken = i + 1;
    } else {
      break;
    }
  }

  const rowArea = (rowWeight / totalWeight) * totalArea;
  const laid = layoutRow(row, rowWeight, rowArea, x, y, w, h);
  const remaining = items.slice(taken);
  if (remaining.length === 0) return laid;

  const next = remainingRect(x, y, w, h, rowArea);
  return [
    ...laid,
    ...squarifyRec(remaining, totalWeight - rowWeight, next.x, next.y, next.w, next.h),
  ];
}

function worstAspect(
  row: Weighted[],
  rowWeight: number,
  side: number,
  totalWeight: number,
  totalArea: number
): number {
  const rowArea = (rowWeight / totalWeight) * totalArea;
  const thickness = rowArea / side;
  if (thickness <= 0) return Infinity;
  let worst = 0;
  for (const item of row) {
    const itemArea = (item.weight / totalWeight) * totalArea;
    const itemSide = itemArea / thickness;
    const aspect = Math.max(itemSide / thickness, thickness / itemSide);
    if (aspect > worst) worst = aspect;
  }
  return worst;
}

function layoutRow(
  row: Weighted[],
  rowWeight: number,
  rowArea: number,
  x: number,
  y: number,
  w: number,
  h: number
): Rect[] {
  const horizontal = w >= h;
  if (horizontal) {
    const thickness = rowArea / h;
    let cy = y;
    return row.map((item) => {
      const itemH = (item.weight / rowWeight) * h;
      const rect: Rect = { id: item.id, x, y: cy, w: thickness, h: itemH };
      cy += itemH;
      return rect;
    });
  }
  const thickness = rowArea / w;
  let cx = x;
  return row.map((item) => {
    const itemW = (item.weight / rowWeight) * w;
    const rect: Rect = { id: item.id, x: cx, y, w: itemW, h: thickness };
    cx += itemW;
    return rect;
  });
}

function remainingRect(
  x: number,
  y: number,
  w: number,
  h: number,
  rowArea: number
): { x: number; y: number; w: number; h: number } {
  if (w >= h) {
    const thickness = rowArea / h;
    return { x: x + thickness, y, w: Math.max(0, w - thickness), h };
  }
  const thickness = rowArea / w;
  return { x, y: y + thickness, w, h: Math.max(0, h - thickness) };
}

/** Inset a rect by `gap / 2` on every side, never inverting it. */
export function applyGap(rect: Rect, gap: number): Rect {
  const inset = gap / 2;
  const w = Math.max(1, rect.w - gap);
  const h = Math.max(1, rect.h - gap);
  const x = rect.x + Math.min(inset, (rect.w - w) / 2);
  const y = rect.y + Math.min(inset, (rect.h - h) / 2);
  return { id: rect.id, x, y, w, h };
}

export function layoutFleetTreemap(
  groups: TreemapGroupInput[],
  width: number,
  height: number,
  options?: { gap?: number; headerH?: number }
): TreemapGroupCell[] {
  const gap = options?.gap ?? TREEMAP_DEFAULT_GAP;
  const requestedHeader = options?.headerH ?? TREEMAP_DEFAULT_HEADER;
  const populated = groups.filter((group) => group.agents.length > 0);
  if (populated.length === 0 || width <= 0 || height <= 0) return [];

  const groupRects = squarify(
    populated.map((group) => ({ id: group.id, weight: group.agents.length })),
    0,
    0,
    width,
    height
  );
  const byId = new Map(populated.map((group) => [group.id, group]));

  return groupRects.map((raw) => {
    const gapped = applyGap(raw, gap);
    const group = byId.get(raw.id)!;
    const headerH = Math.min(requestedHeader, Math.max(0, gapped.h * 0.35));
    const body: Rect = {
      id: raw.id,
      x: gapped.x,
      y: gapped.y + headerH,
      w: gapped.w,
      h: Math.max(0, gapped.h - headerH),
    };
    const agentRects = squarify(
      group.agents.map((agent) => ({ id: agent.id, weight: 1 })),
      body.x,
      body.y,
      body.w,
      body.h
    );
    const agentGap = gap === 0 ? 0 : Math.max(2, gap - 2);
    return {
      id: raw.id,
      x: gapped.x,
      y: gapped.y,
      w: gapped.w,
      h: gapped.h,
      headerH,
      agents: agentRects.map((rect) => ({
        ...(agentGap > 0 ? applyGap(rect, agentGap) : rect),
        groupId: raw.id,
      })),
    };
  });
}
