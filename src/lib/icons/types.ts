/**
 * Data model for AuricIDE's in-house icon set ("Auric Line").
 *
 * Every glyph is a list of primitives drawn on a 24×24 grid with a ~2.5px
 * safe margin. Rendering rules live in one place (AuricIcon):
 *
 * - Default primitives are LINE WORK: stroke `currentColor`, width 1.5,
 *   round caps and joins, no fill. The icon inherits the text color of its
 *   surroundings, so status coloring (red error, amber warning) keeps working.
 * - `accent: true` primitives are the signature detail of the set: a single
 *   small filled shape per glyph painted with `var(--primary)`, so every icon
 *   follows the user's accent color live. At most ONE accent per glyph —
 *   enforced by tests. Utility glyphs (chevrons, arrows, close) carry none.
 * - `fill: true` primitives fill with `currentColor` (no stroke). Used for
 *   the inner mark of status glyphs, which must NEVER use the accent: status
 *   color semantics beat brand color (see CLAUDE.md, "Marker colours never
 *   touch the status slot").
 */
export type IconPrimitive =
  | { kind: 'path'; d: string; accent?: boolean; fill?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; accent?: boolean; fill?: boolean }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx?: number;
      accent?: boolean;
      fill?: boolean;
    }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; accent?: boolean };

export type IconGlyph = IconPrimitive[];

export type GlyphMap = Record<string, IconGlyph>;

/** Shorthand builders keeping glyph files terse and uniform. */
export const p = (d: string): IconPrimitive => ({ kind: 'path', d });
export const c = (cx: number, cy: number, r: number): IconPrimitive => ({
  kind: 'circle',
  cx,
  cy,
  r,
});
export const cFill = (cx: number, cy: number, r: number): IconPrimitive => ({
  kind: 'circle',
  cx,
  cy,
  r,
  fill: true,
});
export const dot = (cx: number, cy: number, r = 2): IconPrimitive => ({
  kind: 'circle',
  cx,
  cy,
  r,
  accent: true,
});
export const r = (x: number, y: number, w: number, h: number, rx = 1.5): IconPrimitive => ({
  kind: 'rect',
  x,
  y,
  w,
  h,
  rx,
});
export const l = (x1: number, y1: number, x2: number, y2: number): IconPrimitive => ({
  kind: 'line',
  x1,
  y1,
  x2,
  y2,
});
