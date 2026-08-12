/**
 * Deriving a tile's background from the mark it carries.
 *
 * A favicon arrives with its own brand colour, and the generated gradient
 * behind it is keyed to the project *path* — so a green logo lands on magenta
 * as often as not, and a row of tiles reads as noise. This module reads the
 * mark and gives the tile a surface that belongs to it.
 *
 * The surface keeps the mark's own hue rather than opposing it. A complement
 * would be the louder choice and the wrong one: two saturated colours at the
 * same size compete, and the thing that must win is the icon. Deep, quiet, and
 * the same hue reads as the icon's own shadow — which is what album-art
 * backgrounds have settled on for the same reason.
 */

export interface TileSurface {
  /** CSS `hsl(...)` gradient start. */
  from: string;
  /** CSS `hsl(...)` gradient end. */
  to: string;
}

/**
 * One saturation and one lightness for every hue. The family resemblance in
 * this app lives in those two numbers, not in the hue — holding them fixed is
 * what stops a row of icon-derived tiles from varying in visual weight.
 *
 * Both sit well below the generated palette's 46%/44%: those tiles carry white
 * initials and need the contrast, whereas an image tile already has something
 * bright and detailed on top and only needs to sit under it.
 */
const SURFACE_SATURATION = 34;
const SURFACE_LIGHTNESS = 24;
/** Matches the 14° drift the generated gradients use, so the sheen is shared. */
const GRADIENT_HUE_SHIFT = 14;
const GRADIENT_LIGHTNESS_SHIFT = 7;

/** Nothing colourful to read — a greyscale mark, or a file that would not decode. */
export const NEUTRAL_TILE_SURFACE: TileSurface = {
  from: `hsl(220, 8%, 22%)`,
  to: `hsl(220, 10%, 29%)`,
};

/** Below this, a pixel is a tint of grey and says nothing about the brand. */
const MIN_SATURATION = 0.22;
/** Outlines and drop shadows. */
const MIN_LIGHTNESS = 0.12;
/** Paper, plates and the white keyline logos are usually cut into. */
const MAX_LIGHTNESS = 0.94;
/** Alpha below this is antialiasing rather than mark. */
const MIN_ALPHA = 128;
/**
 * Hues are counted in buckets so that the thousands of near-identical shades in
 * a gradient logo add up to one answer instead of splitting the vote.
 */
const HUE_BUCKETS = 24;

function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  let hue: number;
  if (delta === 0) hue = 0;
  else if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

/**
 * The hue a mark is actually built from, or null when it has none.
 *
 * Pixels are weighted by saturation, not merely counted: a logo is often a
 * small coloured glyph on a large plain field, and counting alone would hand
 * the answer to the field. Grey, near-white, near-black and transparent pixels
 * are dropped outright — every one of them is packaging rather than brand.
 *
 * Returning null is a real answer, not a failure. A greyscale mark has no
 * colour to borrow, and inventing one would be worse than the neutral surface.
 */
export function dominantIconHue(data: Uint8ClampedArray): number | null {
  const weights = new Float64Array(HUE_BUCKETS);
  // Circular mean per bucket, so the reported hue is a real shade from the
  // image rather than the bucket's nominal centre.
  const sin = new Float64Array(HUE_BUCKETS);
  const cos = new Float64Array(HUE_BUCKETS);

  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < MIN_ALPHA) continue;

    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue;

    const delta = max - min;
    if (delta === 0) continue;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < MIN_SATURATION) continue;

    const hue = hueOf(r, g, b, max, delta);
    const bucket = Math.floor(hue / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    // Saturation as the weight: a vivid pixel speaks louder than a washed one.
    const weight = saturation;
    weights[bucket] += weight;
    const radians = (hue * Math.PI) / 180;
    sin[bucket] += Math.sin(radians) * weight;
    cos[bucket] += Math.cos(radians) * weight;
  }

  let best = -1;
  let bestWeight = 0;
  for (let bucket = 0; bucket < HUE_BUCKETS; bucket++) {
    if (weights[bucket] > bestWeight) {
      bestWeight = weights[bucket];
      best = bucket;
    }
  }
  if (best === -1) return null;

  const mean = (Math.atan2(sin[best], cos[best]) * 180) / Math.PI;
  return mean < 0 ? mean + 360 : mean;
}

/** The surface for a tile whose mark is built from `hue`. */
export function imageTileSurface(hue: number): TileSurface {
  const base = ((Math.round(hue) % 360) + 360) % 360;
  const drifted = (base + GRADIENT_HUE_SHIFT) % 360;
  return {
    from: `hsl(${base}, ${SURFACE_SATURATION}%, ${SURFACE_LIGHTNESS}%)`,
    to: `hsl(${drifted}, ${SURFACE_SATURATION}%, ${SURFACE_LIGHTNESS + GRADIENT_LIGHTNESS_SHIFT}%)`,
  };
}
